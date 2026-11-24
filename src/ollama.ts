import { spawn } from "node:child_process";
import { waitUntilReady } from "./process.ts";

const BASE_URL = "http://127.0.0.1:11434";
const STARTUP_TIMEOUT_MS = 30_000;

export interface JsonRequest {
  model: string;
  system: string;
  user: string;
  /** JSON schema the answer must follow. */
  schema: object;
  /** Context window in tokens. Ollama silently truncates prompts that do not fit. */
  contextSize: number;
}

export interface JsonResponse<T> {
  value: T;
  promptTokens: number;
  outputTokens: number;
}

/**
 * Runs `task` with an Ollama server available. If none is running, one is
 * started for the duration of the task and stopped afterwards, so the model
 * does not stay in memory between meetings.
 */
export async function withOllama<T>(task: () => Promise<T>): Promise<T> {
  if (await isRunning()) return task();

  const server = spawn("ollama", ["serve"], { stdio: "ignore" });
  const stop = () => server.kill();
  process.once("exit", stop);
  try {
    await waitUntilReady(server, "ollama", isRunning, STARTUP_TIMEOUT_MS);
    return await task();
  } finally {
    stop();
    process.off("exit", stop);
  }
}

/** Asks the model for an answer that follows `schema`. */
export async function generateJson<T>(request: JsonRequest): Promise<JsonResponse<T>> {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: request.model,
      // Streaming keeps the connection active during long generations.
      stream: true,
      format: request.schema,
      options: { num_ctx: request.contextSize, temperature: 0.2 },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    if (response.status === 404) {
      throw new Error(`Ollama model "${request.model}" is not installed. Run: ollama pull ${request.model}`);
    }
    throw new Error(`Ollama request failed (${response.status}): ${detail}`);
  }

  let content = "";
  let promptTokens = 0;
  let outputTokens = 0;
  let pending = "";
  const decoder = new TextDecoder();
  const readLine = (line: string) => {
    if (line.trim() === "") return;
    const event = JSON.parse(line);
    if (event.error) throw new Error(`Ollama error: ${event.error}`);
    content += event.message?.content ?? "";
    if (event.done) {
      promptTokens = event.prompt_eval_count ?? 0;
      outputTokens = event.eval_count ?? 0;
    }
  };
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    lines.forEach(readLine);
  }
  readLine(pending);

  try {
    return { value: JSON.parse(content) as T, promptTokens, outputTokens };
  } catch {
    throw new Error(`Ollama returned invalid JSON (the answer was probably cut short):\n${content.slice(0, 500)}`);
  }
}

async function isRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}
