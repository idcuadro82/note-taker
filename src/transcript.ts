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
