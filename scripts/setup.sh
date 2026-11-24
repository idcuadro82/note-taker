#!/usr/bin/env bash
# Sets up a new Mac: dependencies, models and the recorder build.
# Safe to run more than once; it skips whatever is already done.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$REPO_DIR/models"
WHISPER_MODEL="${WHISPER_MODEL:-large-v3-turbo}"
OLLAMA_MODEL="${OLLAMA_MODEL:-gemma3:12b}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This project requires a Mac with Apple Silicon." >&2
  exit 1
fi

if ! command -v brew >/dev/null; then
  echo "Homebrew is missing. Install it from https://brew.sh and run this again." >&2
  exit 1
fi

if ! command -v node >/dev/null; then
  echo "Node was not found. Install Node 24 or later and run this again." >&2
  exit 1
fi

# The notes are written with Ollama: with "notes": "off" in config.local.json
# neither Ollama nor its model, the largest download, is installed.
NOTES="$(cd "$REPO_DIR" && node --input-type=module \
  -e 'const { loadConfig } = await import("./src/config.ts"); console.log(loadConfig().notes);')"

echo "==> Homebrew dependencies"
brew bundle --file="$REPO_DIR/Brewfile"
if [[ "$NOTES" == "on" ]]; then
  brew list ollama >/dev/null 2>&1 || brew install ollama
fi

# download <file-name> <url>: fetches into models/ unless it is already there.
download() {
  local target="$MODELS_DIR/$1"
  if [[ -f "$target" ]]; then
    echo "Already downloaded: $target"
    return
  fi
  curl -L --fail --progress-bar -o "$target.part" "$2"
  mv "$target.part" "$target"
}

mkdir -p "$MODELS_DIR"

echo "==> Whisper model ($WHISPER_MODEL)"
download "ggml-$WHISPER_MODEL.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$WHISPER_MODEL.bin"

echo "==> Voice activity detection model"
download "ggml-silero-v5.1.2.bin" \
  "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin"

echo "==> Speaker separation models"
download "3dspeaker-campplus-zh-en.onnx" \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
if [[ ! -f "$MODELS_DIR/pyannote-segmentation-3.0.onnx" ]]; then
  # Published as an archive: only the model file inside it is needed.
  SEGMENTATION_TMP="$(mktemp -d)"
  curl -L --fail --progress-bar -o "$SEGMENTATION_TMP/model.tar.bz2" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
  tar -xjf "$SEGMENTATION_TMP/model.tar.bz2" -C "$SEGMENTATION_TMP" \
    sherpa-onnx-pyannote-segmentation-3-0/model.onnx
  mv "$SEGMENTATION_TMP/sherpa-onnx-pyannote-segmentation-3-0/model.onnx" \
    "$MODELS_DIR/pyannote-segmentation-3.0.onnx"
  rm -rf "$SEGMENTATION_TMP"
else
  echo "Already downloaded: $MODELS_DIR/pyannote-segmentation-3.0.onnx"
fi

echo "==> Node dependencies"
(cd "$REPO_DIR" && npm ci --no-audit --no-fund)

if [[ "$NOTES" == "on" ]]; then
  echo "==> Ollama model ($OLLAMA_MODEL)"
  if ! curl -s --max-time 2 http://localhost:11434/api/version >/dev/null; then
    brew services start ollama
    for _ in {1..30}; do
      curl -s --max-time 2 http://localhost:11434/api/version >/dev/null && break
      sleep 1
    done
  fi
  ollama pull "$OLLAMA_MODEL"
else
  echo "==> Ollama skipped: the notes are off in config.local.json"
fi

if [[ -f "$REPO_DIR/recorder/Package.swift" ]]; then
  echo "==> Building the recorder"
  swift build -c release --package-path "$REPO_DIR/recorder"
fi

echo "==> Building the menu bar app"
"$REPO_DIR/scripts/build-menubar.sh"
# Restart it so the icon in the menu bar is the version just built.
pkill -f "NoteTaker.app/Contents/MacOS/NoteTaker" 2>/dev/null || true
open "$REPO_DIR/build/NoteTaker.app"

echo
echo "Done. Whisper models are in: $MODELS_DIR"
echo "NoteTaker is now in the menu bar (microphone icon)."
if [[ "$NOTES" != "on" ]]; then
  echo "Meetings stop at the transcript. For the notes, set \"notes\": \"on\" in config.local.json and run this again."
fi
