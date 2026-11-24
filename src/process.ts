import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

const READY_POLL_MS = 250;

/** Runs a command and resolves with its stdout; rejects with the tail of stderr on failure. */
export function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (error) => {
      reject(spawnError(command, error));
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with code ${code}\n${stderr.trim()}`));
    });
  });
}

/**
 * Waits until a server that was just spawned answers. Rejects if it cannot be
 * started, exits, or is not ready in time; stopping it is up to the caller.
 */
export async function waitUntilReady(
  server: ChildProcess,
  command: string,
  isReady: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  let failure: Error | undefined;
  server.once("error", (error) => {
    failure = spawnError(command, error);
  });
  server.once("exit", (code) => {
    failure ??= new Error(`${command} exited with code ${code}`);
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    if (await isReady()) return;
    await sleep(READY_POLL_MS);
  }
  throw new Error(`${command} did not start in time.`);
}

/** True if a process with this pid is running. Pids get reused: it may be another program. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The command is not installed. */
export class CommandNotFoundError extends Error {}

/** Says how to fix it when the command is not installed. */
function spawnError(command: string, error: NodeJS.ErrnoException): Error {
  return error.code === "ENOENT"
    ? new CommandNotFoundError(`${command} not found. Run ./scripts/setup.sh to install it.`)
    : error;
}
