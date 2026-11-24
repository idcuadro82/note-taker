import { existsSync } from "node:fs";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "..");

const modelsDir = path.join(repoRoot, "models");
const whisperModelName = process.env.WHISPER_MODEL ?? "large-v3-turbo";

export const whisperModelPath = path.join(modelsDir, `ggml-${whisperModelName}.bin`);
export const vadModelPath = path.join(modelsDir, "ggml-silero-v5.1.2.bin");
/** Finds where each voice starts and stops. */
export const segmentationModelPath = path.join(modelsDir, "pyannote-segmentation-3.0.onnx");
/** Turns a voice into numbers that can be compared with other voices. */
export const embeddingModelPath = path.join(modelsDir, "3dspeaker-campplus-zh-en.onnx");

export const recorderPath = path.join(repoRoot, "recorder", ".build", "release", "audiocap");

/** Throws, saying how to fix it, if any of these models has not been downloaded. */
export function requireModels(...models: string[]): void {
  for (const model of models) {
    if (!existsSync(model)) {
      throw new Error(`Model not found: ${model}\nRun ./scripts/setup.sh to download it.`);
    }
  }
}
