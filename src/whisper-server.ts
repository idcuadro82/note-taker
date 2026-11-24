import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import net from "node:net";
import { requireModels, vadModelPath, whisperModelPath } from "./paths.ts";
import { waitUntilReady } from "./process.ts";
import { encodeWav, SAMPLE_RATE } from "./wav.ts";

const STARTUP_TIMEOUT_MS = 60_000;
/** The server needs at least a second of audio: shorter clips are padded with silence. */
const MIN_AUDIO_SECONDS = 1.2;

export interface ServerTranscription {
  text: string;
  /** The most likely language, when the request asked to detect it. */
  language?: string;
  languageProbability: number;
}

/** A whisper.cpp server that keeps the model loaded, so each request takes well under a second. */
export class WhisperServer {
  private readonly process: ChildProcess;
  private readonly url: string;

  private constructor(process: ChildProcess, url: string) {
    this.process = process;
    this.url = url;
  }

  static async start(): Promise<WhisperServer> {
    requireModels(whisperModelPath, vadModelPath);
    const port = await freePort();
    const child = spawn(
      "whisper-server",
      [
        "--model", whisperModelPath,
        // Voice detection makes noise come back as empty text instead of invented words.
        "--vad",
        "--vad-model", vadModelPath,
        "--suppress-nst",
        // One decoding attempt per request keeps the delay predictable.
        "--no-fallback",
        "--language", "auto",
        "--host", "127.0.0.1",
        "--port", String(port),
      ],
      { stdio: "ignore" },
    );

    const url = `http://127.0.0.1:${port}`;
    const answers = () =>
      fetch(url, { signal: AbortSignal.timeout(1000) }).then(
        () => true,
        () => false,
      );
    try {
      await waitUntilReady(child, "whisper-server", answers, STARTUP_TIMEOUT_MS);
    } catch (error) {
      child.kill();
      throw error;
    }
    return new WhisperServer(child, url);
  }

  /** Transcribes a clip. `language` is a code, or "auto" to also detect it. */
  async transcribe(samples: Int16Array, language: string): Promise<ServerTranscription> {
    const padded = new Int16Array(Math.max(samples.length, MIN_AUDIO_SECONDS * SAMPLE_RATE));
    padded.set(samples);
    const form = new FormData();
    form.set("file", new Blob([encodeWav(padded)], { type: "audio/wav" }), "audio.wav");
    form.set("language", language);
    form.set("temperature", "0.0");
    // Detecting the language costs an extra pass, so it is only asked for while unknown.
    form.set("response_format", language === "auto" ? "verbose_json" : "json");

    const response = await fetch(`${this.url}/inference`, { method: "POST", body: form });
    if (!response.ok) throw new Error(`whisper-server answered ${response.status}`);
    const json = (await response.json()) as { text?: string; language_probabilities?: Record<string, number> };
    const detected = Object.entries(json.language_probabilities ?? {}).sort((a, b) => b[1] - a[1])[0];
    return { text: cleanText(json.text ?? ""), language: detected?.[0], languageProbability: detected?.[1] ?? 0 };
  }

  stop(): void {
    this.process.kill();
  }
}

/** Joins the segments of a Whisper answer into one line of text. */
export function cleanText(text: string): string {
  // Segments are separated by newlines and can be split in the middle of a word.
  return text.replace(/\n/g, "").replace(/\s+/g, " ").trim();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
