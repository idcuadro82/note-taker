import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vadModelPath } from "./paths.ts";
import { dropEcho, mergeTracks } from "./transcript.ts";
import type { Segment, Speaker, Transcript } from "./transcript.ts";
import { detectSpeech, planClips } from "./vad.ts";
import type { Range } from "./vad.ts";
import { readWav, SAMPLE_RATE, writeWav } from "./wav.ts";
import { transcribeClips } from "./whisper.ts";

/** Which recorded file belongs to which speaker. */
export const TRACK_FILES: Record<Speaker, string> = { others: "system.wav", me: "mic.wav" };

/** whisper-cli refuses audio shorter than one second: pad short clips with silence. */
const MIN_CLIP_SECONDS = 1.2;

interface Clip extends Range {
  speaker: Speaker;
  file: string;
}

/**
 * Transcribes both tracks of a meeting into one conversation.
 *
 * Each track is cut into clips at its pauses, every clip is transcribed on
 * its own, and the results are placed back on the shared timeline.
 */
export async function transcribeMeeting(
  meetingDir: string,
  language: string,
  log: (message: string) => void = () => {},
): Promise<Transcript> {
  for (const file of Object.values(TRACK_FILES)) {
    if (!existsSync(path.join(meetingDir, file))) {
      throw new Error(`Missing ${file} in ${meetingDir}`);
    }
  }
  if (!existsSync(vadModelPath)) {
    throw new Error(`Model not found: ${vadModelPath}\nRun ./scripts/setup.sh to download it.`);
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), "note-taker-"));
  try {
    log("Finding speech...");
    const clips: Clip[] = [];
    for (const speaker of Object.keys(TRACK_FILES) as Speaker[]) {
      clips.push(...(await cutClips(path.join(meetingDir, TRACK_FILES[speaker]), speaker, workDir)));
    }
    if (clips.length === 0) {
      return { language: language === "auto" ? "unknown" : language, turns: [] };
    }

    // Short clips are easy to misdetect ("ok", "sí"), so the language of the
    // whole meeting is taken from its longest clip.
    if (language === "auto") {
      const longest = clips.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
      [{ language }] = await transcribeClips([longest.file], "auto");
      log(`Detected language: ${language}`);
    }

    log(`Transcribing ${clips.length} clips...`);
    const results = await transcribeClips(
      clips.map((clip) => clip.file),
      language,
      (done, total) => log(`  ${done}/${total}`),
    );

    const tracks: Record<Speaker, Segment[]> = { others: [], me: [] };
    clips.forEach((clip, index) => {
      for (const segment of results[index].segments) {
        tracks[clip.speaker].push({
          start: round(clip.start + segment.start),
          end: round(Math.min(clip.start + segment.end, clip.end)),
          text: segment.text,
        });
      }
    });
    const mine = dropEcho(
      tracks.me,
      tracks.others,
      clips.filter((clip) => clip.speaker === "others"),
    );
    if (mine.length < tracks.me.length) {
      log(`Dropped ${tracks.me.length - mine.length} microphone segments that echoed the speakers.`);
    }
    return { language, turns: mergeTracks({ others: tracks.others, me: mine }) };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function cutClips(wavPath: string, speaker: Speaker, workDir: string): Promise<Clip[]> {
  const samples = await readWav(wavPath);
  const ranges = planClips(await detectSpeech(wavPath), samples.length / SAMPLE_RATE);

  const clips: Clip[] = [];
  for (const [index, range] of ranges.entries()) {
    const audio = samples.subarray(
      Math.floor(range.start * SAMPLE_RATE),
      Math.ceil(range.end * SAMPLE_RATE),
    );
    const padded = new Int16Array(Math.max(audio.length, MIN_CLIP_SECONDS * SAMPLE_RATE));
    padded.set(audio);
    const file = path.join(workDir, `${speaker}-${String(index).padStart(5, "0")}.wav`);
    await writeWav(file, padded);
    clips.push({ ...range, speaker, file });
  }
  return clips;
}

function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
