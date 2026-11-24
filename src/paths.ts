import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "..");

const modelsDir = path.join(repoRoot, "models");
const whisperModelName = process.env.WHISPER_MODEL ?? "large-v3-turbo";

export const whisperModelPath = path.join(modelsDir, `ggml-${whisperModelName}.bin`);
export const vadModelPath = path.join(modelsDir, "ggml-silero-v5.1.2.bin");

export const recorderPath = path.join(repoRoot, "recorder", ".build", "release", "audiocap");
