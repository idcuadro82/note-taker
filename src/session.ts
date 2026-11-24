import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recorderPath } from "./paths.ts";
import { run } from "./process.ts";

/** Where meetings are stored: one folder per meeting. */
export const meetingsDir = process.env.NOTES_DIR ?? path.join(os.homedir(), "Meetings");

/** Remembers the recording in progress between `notes start` and `notes stop`. */
const stateFile = path.join(meetingsDir, ".recording.json");

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 20_000;

export interface Recording {
  pid: number;
  dir: string;
  startedAt: string;
}

/** Starts recording in the background and returns once audio is being captured. */
export async function startRecording(title: string, now = new Date()): Promise<Recording> {
  const previous = await readState();
  if (previous) {
    throw new Error(
      (await isRecorderAlive(previous.pid))
        ? `Already recording to ${previous.dir}\nRun "notes stop" first.`
        : `A previous recording was interrupted: ${previous.dir}\nRun "notes stop" to recover it first.`,
    );
  }
  if (!existsSync(recorderPath)) {
    throw new Error(`Recorder not built: ${recorderPath}\nRun ./scripts/setup.sh to build it.`);
  }

  const dir = path.join(meetingsDir, meetingDirName(now, title));
  await mkdir(dir, { recursive: true });
  const logFile = path.join(dir, "recorder.log");
  const logFd = openSync(logFile, "w");

  // Detached: the recording must survive this command and a closed terminal.
  const child = spawn(recorderPath, [dir], { detached: true, stdio: ["ignore", logFd, logFd] });
  child.unref();
  const pid = child.pid;
  if (pid === undefined) throw new Error("Could not start the recorder.");

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const output = await readFile(logFile, "utf8");
    if (output.includes("Recording to")) {
      const recording = { pid, dir, startedAt: now.toISOString() };
      await writeFile(stateFile, `${JSON.stringify(recording, null, 2)}\n`);
      return recording;
    }
    if (!(await isRecorderAlive(pid))) {
      await rm(dir, { recursive: true, force: true });
      throw new Error(output.trim() || "The recorder exited without recording.");
    }
    await sleep(200);
  }
  process.kill(pid, "SIGKILL");
  await rm(dir, { recursive: true, force: true });
  throw new Error("The recorder did not start in time. Check for a pending macOS permission dialog.");
}

/**
 * Stops the recording in progress and returns it. Also recovers a recording
 * whose recorder died: the audio written until then is still usable.
 */
export async function stopRecording(): Promise<Recording & { interrupted: boolean }> {
  const recording = await readState();
  if (!recording) throw new Error('Not recording. Run "notes start" first.');

  const wasAlive = await isRecorderAlive(recording.pid);
  if (wasAlive) {
    process.kill(recording.pid, "SIGINT");
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while ((await isRecorderAlive(recording.pid)) && Date.now() < deadline) await sleep(200);
    if (await isRecorderAlive(recording.pid)) process.kill(recording.pid, "SIGKILL");
  }
  await rm(stateFile, { force: true });
  return { ...recording, interrupted: !wasAlive };
}

/** The recording that was started and not stopped yet, and whether it is still running. */
export async function currentRecording(): Promise<(Recording & { interrupted: boolean }) | undefined> {
  const recording = await readState();
  return recording && { ...recording, interrupted: !(await isRecorderAlive(recording.pid)) };
}

/** Folder name for a meeting: local date and time, plus the title if given. */
export function meetingDirName(date: Date, title = ""): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const slug = slugify(title);
  return slug ? `${stamp}-${slug}` : stamp;
}

/** "Revisión Q4 / Planning" -> "revision-q4-planning" */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
}

async function readState(): Promise<Recording | undefined> {
  if (!existsSync(stateFile)) return undefined;
  return JSON.parse(await readFile(stateFile, "utf8")) as Recording;
}

/** True if `pid` is running and is the recorder (pids get reused). */
async function isRecorderAlive(pid: number): Promise<boolean> {
  try {
    const command = await run("ps", ["-o", "comm=", "-p", String(pid)]);
    return command.includes(path.basename(recorderPath));
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
