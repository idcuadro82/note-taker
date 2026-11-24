import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderNotes, summarize } from "./summarize.ts";
import { transcribeMeeting } from "./transcribe.ts";
import { renderTranscript } from "./transcript.ts";
import type { Transcript } from "./transcript.ts";

type Log = (message: string) => void;

export interface TranscriptOptions {
  /** Spoken language code, or "auto" to detect it. */
  language: string;
  /** Tell the other participants apart by their voices. */
  separateSpeakers: boolean;
  log: Log;
}

export interface NotesOptions {
  /** Ollama model that writes the notes. */
  model: string;
  log: Log;
}

export interface ProcessOptions extends TranscriptOptions, NotesOptions {
  /** False to stop at the transcript. */
  notes: boolean;
}

/** Turns the audio of a recorded meeting into its transcript and, unless turned off, its notes. */
export async function processMeeting(meetingDir: string, options: ProcessOptions): Promise<void> {
  const transcript = await writeTranscript(meetingDir, options);
  if (!options.notes) {
    // The notes need far more memory and time than the transcript.
    options.log(`Notes skipped. Write them later with: notes summarize "${meetingDir}"`);
    return;
  }
  await writeNotes(meetingDir, transcript, options);
}

/** system.wav + mic.wav -> transcript.json, transcript.md */
export async function writeTranscript(meetingDir: string, options: TranscriptOptions): Promise<Transcript> {
  const transcript = await transcribeMeeting(meetingDir, options.language, options.log, options.separateSpeakers);
  await writeFile(path.join(meetingDir, "transcript.json"), `${JSON.stringify(transcript, null, 2)}\n`);
  await writeFile(path.join(meetingDir, "transcript.md"), renderTranscript(transcript));
  options.log(`Wrote transcript.json and transcript.md (${transcript.turns.length} turns)`);
  return transcript;
}

/** The transcript written earlier by `writeTranscript`. */
export async function readTranscript(meetingDir: string): Promise<Transcript> {
  const file = path.join(meetingDir, "transcript.json");
  if (!existsSync(file)) {
    throw new Error(`Missing transcript.json in ${meetingDir}. Run "notes transcribe" first.`);
  }
  return JSON.parse(await readFile(file, "utf8")) as Transcript;
}

/** transcript -> notes.md */
export async function writeNotes(meetingDir: string, transcript: Transcript, options: NotesOptions): Promise<void> {
  if (transcript.turns.length === 0) {
    options.log("No speech found in the recording: nothing to summarize.");
    return;
  }
  const notes = await summarize(transcript, options);
  const file = path.join(meetingDir, "notes.md");
  await writeFile(file, renderNotes(notes, transcript));
  options.log(`Wrote ${file}`);
}
