import { existsSync } from "node:fs";
import { appendFile, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { labelsFor } from "./labels.ts";
import { isAlive, sleep } from "./process.ts";
import { dropEcho, TRACK_FILES } from "./transcript.ts";
import type { Segment, Speaker } from "./transcript.ts";
import { UtteranceTracker } from "./utterances.ts";
import type { Utterance } from "./utterances.ts";
import { SAMPLE_RATE } from "./wav.ts";
import { isNotSpeech } from "./whisper.ts";
import { WhisperServer } from "./whisper-server.ts";

/** One line of the captions file. A later event with the same id replaces the earlier one. */
export interface CaptionEvent {
  id: string;
  speaker: Speaker;
  /** The speaker's name as shown to the user. */
  label: string;
  /** Seconds from the start of the recording. */
  start: number;
  /** Empty to remove a caption that turned out not to be speech. */
  text: string;
  /** False while the speaker is still talking and the text may change. */
  final: boolean;
}

export const CAPTIONS_FILE = "live.jsonl";

const WAV_HEADER_BYTES = 44;
const IDLE_SLEEP_MS = 200;
/** A caption in progress is refreshed once it has this much new audio. */
const PARTIAL_STEP_SECONDS = 1;
/** Shorter than this there is rarely a whole word to show yet. */
const MIN_PARTIAL_SECONDS = 0.8;
/** The meeting language is fixed from the first audio at least this long... */
const MIN_SECONDS_TO_DETECT_LANGUAGE = 2.5;
/** ...in which the model is this sure of the language. */
const MIN_LANGUAGE_PROBABILITY = 0.8;
/** Captions of the others kept to recognise their echo in the microphone. */
const ECHO_MEMORY = 20;

/**
 * Writes live captions for a recording in progress until its recorder exits.
 *
 * The recorder keeps appending to the two WAV files; this follows them, sends
 * each stretch of speech to a local Whisper server while it is being said, and
 * appends the text to live.jsonl for the caption window to display.
 */
export async function runCaptions(meetingDir: string, recorderPid: number, language: string): Promise<void> {
  const server = await WhisperServer.start();
  const stop = () => {
    server.stop();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  const captionsFile = path.join(meetingDir, CAPTIONS_FILE);
  const speakers: Speaker[] = ["others", "me"]; // the others first: their text is needed to spot echo
  const tracks = Object.fromEntries(
    speakers.map((speaker) => [speaker, new Track(path.join(meetingDir, TRACK_FILES[speaker]))]),
  ) as Record<Speaker, Track>;
  const pendingFinals: { speaker: Speaker; utterance: Utterance }[] = [];
  const othersSaid: Segment[] = [];

  const caption = async (speaker: Speaker, utterance: Utterance): Promise<void> => {
    const track = tracks[speaker];
    const seconds = utterance.samples.length / SAMPLE_RATE;
    const result = await server.transcribe(utterance.samples, language);
    if (
      language === "auto" &&
      result.language &&
      result.languageProbability >= MIN_LANGUAGE_PROBABILITY &&
      seconds >= MIN_SECONDS_TO_DETECT_LANGUAGE
    ) {
      // Fixed as early as possible: requests that also detect it take twice as long.
      language = result.language;
      console.error(`Detected language: ${language}`);
    }

    const segment: Segment = { start: utterance.start, end: utterance.start + seconds, text: result.text };
    let text = isNotSpeech(result.text) ? "" : result.text;
    if (speaker === "others") {
      const known = othersSaid.findIndex((said) => said.start === segment.start);
      if (known >= 0) othersSaid[known] = segment;
      else othersSaid.push(segment);
      if (othersSaid.length > ECHO_MEMORY) othersSaid.shift();
    } else if (text !== "" && dropEcho([segment], othersSaid, othersSaid).length === 0) {
      text = ""; // the microphone picked up the speakers
    }

    // Nothing to show, and nothing shown before that needs removing.
    if (text === "" && !track.shown.has(utterance.index)) return;
    if (text === "") track.shown.delete(utterance.index);
    else track.shown.add(utterance.index);
    const event: CaptionEvent = {
      id: `${speaker}-${utterance.index}`,
      speaker,
      label: labelsFor(language)[speaker],
      start: Math.round(utterance.start * 100) / 100,
      text,
      final: utterance.closed,
    };
    await appendFile(captionsFile, `${JSON.stringify(event)}\n`);
  };

  try {
    for (let recording = true; recording || pendingFinals.length > 0; ) {
      if (recording && !isAlive(recorderPid)) {
        recording = false; // read what is left and close the open utterances
      }
      for (const speaker of speakers) {
        const track = tracks[speaker];
        track.tracker.feed(await track.read());
        if (!recording) track.tracker.flush();
        for (const utterance of track.tracker.takeClosed()) pendingFinals.push({ speaker, utterance });
      }

      // Finished utterances first, then a refresh of whoever is talking now.
      const next = pendingFinals.shift() ?? (recording ? nextPartial(tracks, speakers) : undefined);
      if (next) await caption(next.speaker, next.utterance);
      else if (recording) await sleep(IDLE_SLEEP_MS);
    }
  } finally {
    server.stop();
    await Promise.all(speakers.map((speaker) => tracks[speaker].close()));
  }
}

/** The utterance in progress that most needs its caption refreshed, if any. */
function nextPartial(
  tracks: Record<Speaker, Track>,
  speakers: Speaker[],
): { speaker: Speaker; utterance: Utterance } | undefined {
  for (const speaker of speakers) {
    const track = tracks[speaker];
    const utterance = track.tracker.current;
    if (!utterance) continue;
    const seconds = utterance.samples.length / SAMPLE_RATE;
    const shownSeconds = track.partial.index === utterance.index ? track.partial.seconds : 0;
    if (seconds >= MIN_PARTIAL_SECONDS && seconds - shownSeconds >= PARTIAL_STEP_SECONDS) {
      track.partial = { index: utterance.index, seconds };
      return { speaker, utterance };
    }
  }
  return undefined;
}

/** One audio file that is still being written, and the speech found in it so far. */
class Track {
  readonly tracker = new UtteranceTracker();
  /** Utterances that currently have a caption on screen. */
  readonly shown = new Set<number>();
  /** How much of the utterance in progress was last sent for captioning. */
  partial = { index: 0, seconds: 0 };
  private handle?: FileHandle;
  private position = WAV_HEADER_BYTES;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** The samples appended to the file since the last call. */
  async read(): Promise<Int16Array> {
    if (!this.handle) {
      if (!existsSync(this.filePath)) return new Int16Array(0);
      this.handle = await open(this.filePath, "r");
    }
    const { size } = await this.handle.stat();
    const bytes = size - this.position - ((size - this.position) % 2);
    if (bytes <= 0) return new Int16Array(0);
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await this.handle.read(buffer, 0, bytes, this.position);
    const sampleCount = Math.floor(bytesRead / 2);
    this.position += sampleCount * 2;
    const samples = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) samples[i] = buffer.readInt16LE(i * 2);
    return samples;
  }

  async close(): Promise<void> {
    await this.handle?.close();
  }
}
