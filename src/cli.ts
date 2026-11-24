import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_MODEL, renderNotes, summarize } from "./summarize.ts";
import { transcribeMeeting } from "./transcribe.ts";
import { renderTranscript } from "./transcript.ts";
import type { Transcript } from "./transcript.ts";

const USAGE = `Usage:
  notes process <meeting-dir>      Transcribe and summarize a recorded meeting
  notes transcribe <meeting-dir>   system.wav + mic.wav -> transcript.json, transcript.md
  notes summarize <meeting-dir>    transcript.json -> notes.md

Options:
  --language <code>   Spoken language (es, en...). Default: auto-detect.
  --model <name>      Ollama model for the notes. Default: ${DEFAULT_MODEL}`;

const log = (message: string) => console.error(message);

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      language: { type: "string", default: "auto" },
      model: { type: "string", default: DEFAULT_MODEL },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...rest] = positionals;

  if (values.help || command === undefined) {
    console.log(USAGE);
    return;
  }
  if (rest.length !== 1) throw new Error(USAGE);
  const meetingDir = path.resolve(rest[0]);

  switch (command) {
    case "transcribe":
      await transcribe(meetingDir, values.language);
      return;
    case "summarize":
      await writeNotes(meetingDir, await readTranscript(meetingDir), values.model);
      return;
    case "process":
      await writeNotes(meetingDir, await transcribe(meetingDir, values.language), values.model);
      return;
    default:
      throw new Error(USAGE);
  }
}

async function transcribe(meetingDir: string, language: string): Promise<Transcript> {
  const transcript = await transcribeMeeting(meetingDir, language, log);
  await writeFile(path.join(meetingDir, "transcript.json"), `${JSON.stringify(transcript, null, 2)}\n`);
  await writeFile(path.join(meetingDir, "transcript.md"), renderTranscript(transcript));
  log(`Wrote transcript.json and transcript.md (${transcript.turns.length} turns)`);
  return transcript;
}

async function readTranscript(meetingDir: string): Promise<Transcript> {
  const file = path.join(meetingDir, "transcript.json");
  if (!existsSync(file)) {
    throw new Error(`Missing transcript.json in ${meetingDir}. Run "notes transcribe" first.`);
  }
  return JSON.parse(await readFile(file, "utf8")) as Transcript;
}

async function writeNotes(meetingDir: string, transcript: Transcript, model: string): Promise<void> {
  if (transcript.turns.length === 0) {
    log("No speech found in the recording: nothing to summarize.");
    return;
  }
  const notes = await summarize(transcript, { model, log });
  const file = path.join(meetingDir, "notes.md");
  await writeFile(file, renderNotes(notes, transcript));
  log(`Wrote ${file}`);
}
