# note-taker

Takes meeting notes (Slack, Teams, Google Meet, Zoom…) locally and for free:
it records system audio and the microphone, transcribes with Whisper and summarizes with Ollama.
Nothing leaves your machine.

## Requirements

- Mac with Apple Silicon and macOS 15 or later
- [Homebrew](https://brew.sh)
- Xcode Command Line Tools (`xcode-select --install`)
- Node 24 or later
- About 11 GB of free disk space for the models

## Setup on a new Mac

```bash
git clone https://github.com/idcuadro82/note-taker.git
cd note-taker
./scripts/setup.sh
```

The script installs `whisper.cpp` and `ollama`, downloads the models and builds the recorder.
Models can be changed with environment variables:

```bash
WHISPER_MODEL=medium OLLAMA_MODEL=gemma3:12b ./scripts/setup.sh
```

## Recording audio

```bash
recorder/.build/release/audiocap ~/Meetings/test
```

Records until you press Ctrl+C and writes two aligned files (16 kHz, mono):
`system.wav` (what the other participants say) and `mic.wav` (your microphone).

The first run needs two permissions for your terminal app, under
System Settings > Privacy & Security: **Microphone** and
**Screen & System Audio Recording**. Restart the terminal after granting them.

## Transcribing a recording

```bash
bin/notes.js transcribe ~/Meetings/test
```

Reads `system.wav` and `mic.wav` from the folder and writes `transcript.json` and
`transcript.md`: one conversation in order, with each turn labelled **Others** or **Me**.
The language is detected automatically; force it with `--language es`.

Run the tests with `npm test`.

## Where things live

| What | Where | In git? |
|---|---|---|
| Code | this repository | Yes |
| Whisper models | `models/` in this repository (contents ignored by git) | No |
| Ollama model | Ollama's own store (`~/.ollama/models`) | No |
| Recordings and notes | `~/Meetings/` | No |

## Status

Work in progress. Planned steps:

1. Environment setup (`scripts/setup.sh`)
2. Audio recorder in Swift (`recorder/`)
3. Transcription with Whisper
4. Summarization with Ollama
5. `notes start` / `notes stop` CLI
6. Robustness and configuration
