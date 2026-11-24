import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { whisperModelPath } from "./paths.ts";
import { run } from "./process.ts";
import type { Segment } from "./transcript.ts";

export interface ClipTranscription {
  language: string;
  /** Times are relative to the start of the clip. */
  segments: Segment[];
}

interface WhisperJson {
  result?: { language?: string };
  transcription?: { offsets: { from: number; to: number }; text: string }[];
}

// Whisper marks non-speech as "[BLANK_AUDIO]", "(music)", "*laughs*"...
const NON_SPEECH = /^[\[(*].*[\])*]$/;

// On noise, Whisper tends to emit the video-subtitle credits it saw in training.
// Token confidence does not tell these apart from real short answers, so only
// the well-known phrases are dropped.
const HALLUCINATIONS = [
  /^[¡!]*gracias por ver( el v[ií]deo)?[.!]*$/i,
  /^subt[ií]tulos (realizados|creados|por)\b/i,
  /amara\.org/i,
  /^cc por\b/i,
  /^thanks?( you)? for watching[.!]*$/i,
  /^subtitles by\b/i,
];

/** True for Whisper output that is not something a participant said. */
export function isNotSpeech(text: string): boolean {
  return text === "" || NON_SPEECH.test(text) || HALLUCINATIONS.some((pattern) => pattern.test(text));
}

/** Files per whisper-cli run: the model loads once per run, but argv is finite. */
const BATCH_SIZE = 200;

/**
 * Transcribes short WAV clips with whisper.cpp, loading the model once per batch.
 * Returns one result per input file, in the same order.
 */
export async function transcribeClips(
  wavPaths: string[],
  language: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ClipTranscription[]> {
  if (!existsSync(whisperModelPath)) {
    throw new Error(`Model not found: ${whisperModelPath}\nRun ./scripts/setup.sh to download it.`);
  }

  const results: ClipTranscription[] = [];
  for (let offset = 0; offset < wavPaths.length; offset += BATCH_SIZE) {
    const batch = wavPaths.slice(offset, offset + BATCH_SIZE);
    await run("whisper-cli", [
      "--model", whisperModelPath,
      "--language", language,
      "--suppress-nst",
      "--no-prints",
      "--output-json",
      ...batch,
    ]);
    for (const wavPath of batch) {
      results.push(await readResult(`${wavPath}.json`, language));
    }
    onProgress?.(results.length, wavPaths.length);
  }
  return results;
}

async function readResult(jsonPath: string, language: string): Promise<ClipTranscription> {
  if (!existsSync(jsonPath)) {
    // whisper-cli skips a clip it cannot decode; treat it as silence.
    return { language, segments: [] };
  }
  const json = JSON.parse(await readFile(jsonPath, "utf8")) as WhisperJson;
  const segments = (json.transcription ?? [])
    .map((item) => ({
      start: item.offsets.from / 1000,
      end: item.offsets.to / 1000,
      text: item.text.trim(),
    }))
    .filter((segment) => !isNotSpeech(segment.text));
  return { language: json.result?.language ?? language, segments };
}
