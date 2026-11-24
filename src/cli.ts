import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { config, configFile } from "./config.ts";
import { CAPTIONS_FILE, runCaptions } from "./live.ts";
import type { CaptionEvent } from "./live.ts";
import { currentRecording, meetingsDir, startRecording, stopRecording } from "./session.ts";
import { renderNotes, summarize } from "./summarize.ts";
import { transcribeMeeting } from "./transcribe.ts";
import { formatTime, renderTranscript } from "./transcript.ts";
import type { Transcript } from "./transcript.ts";

const USAGE = `Usage:
  notes start [title]              Start recording a meeting
  notes start [title] --live       Start recording with live captions
  notes captions                   Show the live captions of the recording in progress
  notes stop                       Stop recording and write the notes
  notes status                     Show whether a recording is in progress

  notes process <meeting-dir>      Transcribe and summarize a recorded meeting
  notes transcribe <meeting-dir>   system.wav + mic.wav -> transcript.json, transcript.md
  notes summarize <meeting-dir>    transcript.json -> notes.md

Options:
  --language <code>   Spoken language (es, en..., or auto). Default: ${config.language}
  --model <name>      Ollama model for the notes. Default: ${config.model}
  --no-notes          With "stop": keep the recording but do not process it.
  --json              With "status": print the state as JSON.

Meetings are stored in ${meetingsDir}
Defaults can be changed in ${configFile}`;

const log = (message: string) => console.error(message);

interface Options {
  language: string;
  model: string;
}

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      language: { type: "string", default: config.language },
      model: { type: "string", default: config.model },
      "no-notes": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      live: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...rest] = positionals;

  if (values.help || command === undefined) {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "start":
      return start(rest.join(" "), values.live);
    case "captions":
      if (rest.length > 0) break;
      return followCaptions();
    case "_captions":
      // Internal: the background process started by "notes start --live".
      if (rest.length !== 2) break;
      return runCaptions(path.resolve(rest[0]), Number(rest[1]), values.language);
    case "stop":
      if (rest.length > 0) break;
      return stop(values, values["no-notes"]);
    case "status":
      if (rest.length > 0) break;
      return status(values.json);
    case "transcribe":
    case "summarize":
    case "process": {
      if (rest.length !== 1) break;
      const meetingDir = path.resolve(rest[0]);
      if (command === "transcribe") await transcribe(meetingDir, values.language);
      else if (command === "summarize") await writeNotes(meetingDir, await readTranscript(meetingDir), values.model);
      else await processMeeting(meetingDir, values);
      return;
    }
  }
  throw new Error(USAGE);
}

async function start(title: string, live: boolean): Promise<void> {
  const recording = await startRecording(title, live);
  log(`Recording to ${recording.dir}`);
  if (live) log('Live captions are on: run "notes captions" to read them here.');
  log('Run "notes stop" when the meeting ends.');
}

/** Prints each caption once it is complete, until the recording ends. */
async function followCaptions(): Promise<void> {
  const recording = await currentRecording();
  if (!recording || recording.interrupted) throw new Error("Not recording.");
  if (!recording.captionsPid) {
    throw new Error('This recording has no live captions. Start it with "notes start --live".');
  }
  const file = path.join(recording.dir, CAPTIONS_FILE);
  let printed = 0;
  for (;;) {
    const lines = existsSync(file) ? (await readFile(file, "utf8")).split("\n").filter(Boolean) : [];
    for (const line of lines.slice(printed)) {
      const event = JSON.parse(line) as CaptionEvent;
      if (event.final && event.text) console.log(`[${formatTime(event.start)}] ${event.label}: ${event.text}`);
    }
    printed = lines.length;
    const current = await currentRecording();
    if (!current || current.interrupted || current.dir !== recording.dir) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function stop(options: Options, skipNotes: boolean): Promise<void> {
  const recording = await stopRecording();
  if (recording.interrupted) {
    log("The recorder was no longer running; using the audio it saved before stopping.");
  }
  log(`Recording saved in ${recording.dir}`);
  if (skipNotes) {
    log(`Process it later with: notes process "${recording.dir}"`);
    return;
  }
  await processMeeting(recording.dir, options);
}

async function status(json: boolean): Promise<void> {
  const recording = await currentRecording();
  if (json) {
    // Read by the menu bar app.
    const state = !recording ? "idle" : recording.interrupted ? "interrupted" : "recording";
    console.log(
      JSON.stringify({
        state,
        meetingsDir,
        dir: recording?.dir,
        startedAt: recording?.startedAt,
        captions: recording?.captionsPid ? path.join(recording.dir, CAPTIONS_FILE) : undefined,
      }),
    );
    return;
  }
  if (!recording) {
    console.log("Not recording.");
    return;
  }
  if (recording.interrupted) {
    console.log(`A recording was interrupted: ${recording.dir}\nRun "notes stop" to recover it.`);
    return;
  }
  const elapsed = (Date.now() - new Date(recording.startedAt).getTime()) / 1000;
  console.log(`Recording for ${formatTime(elapsed)} to ${recording.dir}`);
}

async function processMeeting(meetingDir: string, options: Options): Promise<void> {
  await writeNotes(meetingDir, await transcribe(meetingDir, options.language), options.model);
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
