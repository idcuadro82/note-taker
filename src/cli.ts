import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { configFile, loadConfig } from "./config.ts";
import { CAPTIONS_FILE, runCaptions } from "./live.ts";
import type { CaptionEvent } from "./live.ts";
import { processMeeting, readTranscript, writeNotes, writeTranscript } from "./meeting.ts";
import type { ProcessOptions } from "./meeting.ts";
import { sleep } from "./process.ts";
import { currentRecording, startRecording, stopRecording } from "./session.ts";
import { formatTime } from "./transcript.ts";

// The only place the settings are read: everything else is handed what it needs.
const config = loadConfig();
/** Where meetings are stored: one folder per meeting. */
const meetingsDir = config.meetingsDir;

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
  --transcript-only   With "stop" and "process": transcribe but do not write the notes.
  --no-notes          With "stop": keep the recording but do not process it.
  --no-speakers       Group the other participants instead of telling them apart.
  --json              With "status": print the state as JSON.

Meetings are stored in ${meetingsDir}
Defaults can be changed in ${configFile}`;

const log = (message: string) => console.error(message);

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      language: { type: "string", default: config.language },
      model: { type: "string", default: config.model },
      "no-notes": { type: "boolean", default: false },
      "no-speakers": { type: "boolean", default: false },
      "transcript-only": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      live: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...rest] = positionals;
  const options: ProcessOptions = {
    language: values.language,
    model: values.model,
    separateSpeakers: config.separateSpeakers === "on" && !values["no-speakers"],
    notes: config.notes === "on" && !values["transcript-only"],
    log,
  };

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
      return stop(options, values["no-notes"]);
    case "status":
      if (rest.length > 0) break;
      return status(values.json);
    case "transcribe":
    case "summarize":
    case "process": {
      if (rest.length !== 1) break;
      const meetingDir = path.resolve(rest[0]);
      if (command === "transcribe") await writeTranscript(meetingDir, options);
      else if (command === "summarize") await writeNotes(meetingDir, await readTranscript(meetingDir), options);
      else await processMeeting(meetingDir, options);
      return;
    }
  }
  throw new Error(USAGE);
}

async function start(title: string, live: boolean): Promise<void> {
  const recording = await startRecording(meetingsDir, title, live);
  log(`Recording to ${recording.dir}`);
  if (live) log('Live captions are on: run "notes captions" to read them here.');
  log('Run "notes stop" when the meeting ends.');
}

/** Prints each caption once it is complete, until the recording ends. */
async function followCaptions(): Promise<void> {
  const recording = await currentRecording(meetingsDir);
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
    const current = await currentRecording(meetingsDir);
    if (!current || current.interrupted || current.dir !== recording.dir) return;
    await sleep(500);
  }
}

async function stop(options: ProcessOptions, skipNotes: boolean): Promise<void> {
  const recording = await stopRecording(meetingsDir);
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
  const recording = await currentRecording(meetingsDir);
  if (json) {
    // Read by the menu bar app.
    const state = !recording ? "idle" : recording.interrupted ? "interrupted" : "recording";
    console.log(
      JSON.stringify({
        state,
        meetingsDir,
        notes: config.notes === "on",
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
