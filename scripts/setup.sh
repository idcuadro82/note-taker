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

echo "==> Homebrew dependencies"
brew bundle --file="$REPO_DIR/Brewfile"

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
echo "Done. Whisper models are in: $MODELS_DIR"
