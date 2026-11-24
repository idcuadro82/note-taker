import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { transcribeMeeting } from "./transcribe.ts";
import { renderTranscript } from "./transcript.ts";

const USAGE = `Usage:
  notes transcribe <meeting-dir> [--language <code>]

Commands:
  transcribe   Transcribe system.wav and mic.wav into transcript.json and transcript.md

Options:
  --language   Spoken language code (es, en...). Default: auto-detect.`;

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      language: { type: "string", default: "auto" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...rest] = positionals;

  if (values.help || command === undefined) {
    console.log(USAGE);
    return;
  }
  if (command === "transcribe" && rest.length === 1) {
    await transcribe(path.resolve(rest[0]), values.language);
    return;
  }
  throw new Error(USAGE);
}

async function transcribe(meetingDir: string, language: string): Promise<void> {
  const transcript = await transcribeMeeting(meetingDir, language, (message) => console.error(message));
  await writeFile(path.join(meetingDir, "transcript.json"), `${JSON.stringify(transcript, null, 2)}\n`);
  await writeFile(path.join(meetingDir, "transcript.md"), renderTranscript(transcript));
  console.error(`Wrote transcript.json and transcript.md (${transcript.turns.length} turns) to ${meetingDir}`);
}
