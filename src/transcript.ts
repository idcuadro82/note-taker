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

const SPEAKER_LABELS: Record<Speaker, string> = { me: "Me", others: "Others" };

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

export function renderTranscript(transcript: Transcript): string {
  const lines = transcript.turns.map(
    (turn) => `**[${formatTime(turn.start)}] ${SPEAKER_LABELS[turn.speaker]}:** ${turn.text}`,
  );
  return `# Transcript\n\n${lines.join("\n\n")}\n`;
}

export function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
