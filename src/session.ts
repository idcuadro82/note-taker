import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { recorderPath, repoRoot } from "./paths.ts";
import { run, sleep } from "./process.ts";

/** Remembers the recording in progress between `notes start` and `notes stop`. */
const STATE_FILE = ".recording.json";

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 20_000;

export interface Recording {
  pid: number;
  dir: string;
  startedAt: string;
  /** Process writing live captions, when the recording was started with them. */
  captionsPid?: number;
}

/**
 * Starts recording in the background and returns once audio is being captured.
 * The meeting gets its own folder inside `meetingsDir`. With `live`, a second
 * background process writes captions while it records.
 */
export async function startRecording(
  meetingsDir: string,
  title: string,
  live = false,
  now = new Date(),
): Promise<Recording> {
  const previous = await readState(meetingsDir);
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
      const recording: Recording = { pid, dir, startedAt: now.toISOString() };
      if (live) recording.captionsPid = startCaptions(dir, pid);
      await writeFile(stateFile(meetingsDir), `${JSON.stringify(recording, null, 2)}\n`);
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
export async function stopRecording(meetingsDir: string): Promise<Recording & { interrupted: boolean }> {
  const recording = await readState(meetingsDir);
  if (!recording) throw new Error('Not recording. Run "notes start" first.');

  // The captions are not needed any more, and the final transcription wants the GPU.
  if (recording.captionsPid) {
    try {
      process.kill(recording.captionsPid, "SIGTERM");
    } catch {
      // already gone
    }
  }

  const wasAlive = await isRecorderAlive(recording.pid);
  if (wasAlive) {
    process.kill(recording.pid, "SIGINT");
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while ((await isRecorderAlive(recording.pid)) && Date.now() < deadline) await sleep(200);
    if (await isRecorderAlive(recording.pid)) process.kill(recording.pid, "SIGKILL");
  }
  await rm(stateFile(meetingsDir), { force: true });
  return { ...recording, interrupted: !wasAlive };
}

/** The recording that was started and not stopped yet, and whether it is still running. */
export async function currentRecording(
  meetingsDir: string,
): Promise<(Recording & { interrupted: boolean }) | undefined> {
  const recording = await readState(meetingsDir);
  return recording && { ...recording, interrupted: !(await isRecorderAlive(recording.pid)) };
}

/** Starts the process that follows the recording and writes its captions. */
function startCaptions(dir: string, recorderPid: number): number | undefined {
  const logFd = openSync(path.join(dir, "captions.log"), "w");
  const child = spawn(
    process.execPath,
    [path.join(repoRoot, "bin", "notes.js"), "_captions", dir, String(recorderPid)],
    { detached: true, stdio: ["ignore", logFd, logFd] },
  );
  child.unref();
  return child.pid;
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

function stateFile(meetingsDir: string): string {
  return path.join(meetingsDir, STATE_FILE);
}

async function readState(meetingsDir: string): Promise<Recording | undefined> {
  const file = stateFile(meetingsDir);
  if (!existsSync(file)) return undefined;
  return JSON.parse(await readFile(file, "utf8")) as Recording;
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
