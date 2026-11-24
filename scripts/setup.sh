#!/usr/bin/env bash
# Sets up a new Mac: dependencies, models and the recorder build.
# Safe to run more than once; it skips whatever is already done.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$REPO_DIR/models"
WHISPER_MODEL="${WHISPER_MODEL:-large-v3-turbo}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:14b}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This project requires a Mac with Apple Silicon." >&2
  exit 1
fi

if ! command -v brew >/dev/null; then
  echo "Homebrew is missing. Install it from https://brew.sh and run this again." >&2
  exit 1
fi

echo "==> Homebrew dependencies"
brew bundle --file="$REPO_DIR/Brewfile"

echo "==> Whisper model ($WHISPER_MODEL)"
mkdir -p "$MODELS_DIR"
MODEL_FILE="$MODELS_DIR/ggml-$WHISPER_MODEL.bin"
if [[ ! -f "$MODEL_FILE" ]]; then
  curl -L --fail --progress-bar \
    -o "$MODEL_FILE.part" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$WHISPER_MODEL.bin"
  mv "$MODEL_FILE.part" "$MODEL_FILE"
else
  echo "Already downloaded: $MODEL_FILE"
fi

echo "==> Ollama model ($OLLAMA_MODEL)"
if ! curl -s --max-time 2 http://localhost:11434/api/version >/dev/null; then
  brew services start ollama
  for _ in {1..30}; do
    curl -s --max-time 2 http://localhost:11434/api/version >/dev/null && break
    sleep 1
  done
fi
ollama pull "$OLLAMA_MODEL"

if [[ -f "$REPO_DIR/recorder/Package.swift" ]]; then
  echo "==> Building the recorder"
  swift build -c release --package-path "$REPO_DIR/recorder"
fi

echo
echo "Done. Whisper model is in: $MODELS_DIR"
