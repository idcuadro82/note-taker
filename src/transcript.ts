import { labelsFor } from "./labels.ts";

export type Speaker = "me" | "others";

/** A stretch of speech, in seconds from the start of the recording. */
export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Turn extends Segment {
  speaker: Speaker;
}

export interface Transcript {
  language: string;
  turns: Turn[];
}

/** Segments from the same speaker closer than this are joined into one turn. */
const MAX_PAUSE_WITHIN_TURN = 2;

/**
 * Interleaves the per-track segments by start time and joins consecutive
 * segments from the same speaker into turns.
 */
export function mergeTracks(tracks: Record<Speaker, Segment[]>): Turn[] {
  const all: Turn[] = (Object.keys(tracks) as Speaker[])
    .flatMap((speaker) => tracks[speaker].map((segment) => ({ ...segment, speaker })))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const turns: Turn[] = [];
  for (const segment of all) {
    const last = turns.at(-1);
    if (last && last.speaker === segment.speaker && segment.start - last.end <= MAX_PAUSE_WITHIN_TURN) {
      last.text = `${last.text} ${segment.text}`;
      last.end = Math.max(last.end, segment.end);
    } else {
      turns.push({ ...segment });
    }
  }
  return turns;
}

/** Echo is searched among what the others said this close to the microphone segment. */
const ECHO_WINDOW_SECONDS = 2;
/** Share of a microphone segment's words that must repeat the others to count as echo. */
const ECHO_WORD_SHARE = 0.5;
/** Share of a microphone segment that must happen while the others are talking. */
const ECHO_TIME_SHARE = 0.5;

/**
 * Drops microphone segments that are the others' voices coming out of the
 * speakers: speech that happens while the others talk and repeats their words.
 * An answer that repeats a word of the question is kept, because it comes
 * after the others stop talking.
 *
 * `othersSpeech` is when the others were talking, from the audio; it is more
 * precise than the times of their transcribed segments.
 *
 * It works on the text because the audio is not reliable for this: in a noisy
 * room the echo and a different voice look alike. The cost is that a remark
 * made over the others using their same words is dropped too.
 */
export function dropEcho(
  me: Segment[],
  others: Segment[],
  othersSpeech: { start: number; end: number }[],
): Segment[] {
  return me.filter((segment) => {
    const duration = segment.end - segment.start;
    const overlap = othersSpeech.reduce(
      (total, range) =>
        total + Math.max(0, Math.min(segment.end, range.end) - Math.max(segment.start, range.start)),
      0,
    );
    if (duration <= 0 || overlap / duration < ECHO_TIME_SHARE) return true;

    const heard = new Set(
      others
        .filter(
          (other) =>
            other.start <= segment.end + ECHO_WINDOW_SECONDS &&
            other.end >= segment.start - ECHO_WINDOW_SECONDS,
        )
        .flatMap((other) => words(other.text)),
    );
    const said = words(segment.text);
    if (said.length === 0) return true;
    const repeated = said.filter((word) => heard.has(word)).length;
    return repeated / said.length < ECHO_WORD_SHARE;
  });
}

/** Lowercase words without accents or punctuation, for comparing transcriptions. */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The conversation as Markdown paragraphs, one per turn, without a heading. */
export function renderTurns(transcript: Transcript): string {
  const labels = labelsFor(transcript.language);
  return transcript.turns
    .map((turn) => `**[${formatTime(turn.start)}] ${labels[turn.speaker]}:** ${turn.text}`)
    .join("\n\n");
}

export function renderTranscript(transcript: Transcript): string {
  return `# ${labelsFor(transcript.language).transcript}\n\n${renderTurns(transcript)}\n`;
}

export function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
