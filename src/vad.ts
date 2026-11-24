import { vadModelPath } from "./paths.ts";
import { run } from "./process.ts";

/** A time range in seconds from the start of the recording. */
export interface Range {
  start: number;
  end: number;
  /** Who is talking, when the people in the track have been told apart. */
  person?: number;
}

/** Speech separated by a pause shorter than this stays in the same clip. */
const MAX_PAUSE_WITHIN_CLIP = 0.8;
/** Whisper works on 30-second windows: longer clips would be split blindly. */
const MAX_CLIP_SECONDS = 28;
/** Silence kept around a clip so words are not cut at the edges. */
const CLIP_PADDING = 0.15;

/** Finds the stretches of a WAV file that contain speech. */
export async function detectSpeech(wavPath: string): Promise<Range[]> {
  const output = await run("whisper-vad-speech-segments", [
    "--vad-model", vadModelPath,
    "--vad-max-speech-duration-s", String(MAX_CLIP_SECONDS),
    "--no-prints",
    "--file", wavPath,
  ]);
  return parseSpeechSegments(output);
}

/** Parses lines like "Speech segment 0: start = 199.00, end = 269.00" (centiseconds). */
export function parseSpeechSegments(output: string): Range[] {
  const pattern = /^Speech segment \d+: start = ([\d.]+), end = ([\d.]+)/gm;
  return [...output.matchAll(pattern)].map((match) => ({
    start: Number(match[1]) / 100,
    end: Number(match[2]) / 100,
  }));
}

/**
 * Groups speech ranges into the clips that are sent to Whisper.
 *
 * Whisper's own timestamps drift by seconds around silence, which scrambles
 * the order of the conversation. Cutting at every real pause means each clip
 * starts at a known time, so the error is bounded by the pauses inside a clip.
 * A clip never mixes two people.
 */
export function planClips(speech: Range[], duration: number): Range[] {
  const groups: Range[] = [];
  for (const range of speech) {
    // Defensive: split anything longer than one Whisper window.
    for (let start = range.start; start < range.end; start += MAX_CLIP_SECONDS) {
      const piece: Range = { ...range, start, end: Math.min(range.end, start + MAX_CLIP_SECONDS) };
      const last = groups.at(-1);
      if (
        last &&
        last.person === piece.person &&
        piece.start - last.end <= MAX_PAUSE_WITHIN_CLIP &&
        piece.end - last.start <= MAX_CLIP_SECONDS
      ) {
        last.end = piece.end;
      } else {
        groups.push(piece);
      }
    }
  }

  // Pad into the surrounding silence without overlapping the neighbours.
  return groups.map((group, index) => {
    const previousEnd = index > 0 ? groups[index - 1].end : 0;
    const nextStart = index < groups.length - 1 ? groups[index + 1].start : duration;
    return {
      ...group,
      start: Math.max(group.start - Math.min(CLIP_PADDING, (group.start - previousEnd) / 2), 0),
      end: Math.min(group.end + Math.min(CLIP_PADDING, (nextStart - group.end) / 2), duration),
    };
  });
}
