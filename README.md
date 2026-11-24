# note-taker

Takes meeting notes (Slack, Teams, Google Meet, Zoom…) locally and for free:
it records system audio and the microphone, transcribes with Whisper and summarizes with Ollama.
Nothing leaves your machine.

## Requirements

- Mac with Apple Silicon and macOS 15 or later
- [Homebrew](https://brew.sh)
- Xcode Command Line Tools (`xcode-select --install`)
- Node 24 or later
- About 10 GB of free disk space for the models

## Setup on a new Mac

```bash
git clone https://github.com/idcuadro82/note-taker.git
cd note-taker
./scripts/setup.sh
```

The script installs `whisper.cpp` and `ollama`, downloads the models and builds the recorder.
Models can be changed with environment variables:

```bash
WHISPER_MODEL=medium OLLAMA_MODEL=qwen2.5:14b ./scripts/setup.sh
```

## Usage

```bash
bin/notes.js start "Weekly sync"   # when the meeting begins (the title is optional)
bin/notes.js stop                  # when it ends: transcribes and writes the notes
```

Run `npm link` once in this folder to use `notes` instead of `bin/notes.js`.

Each meeting gets its own folder in `~/Meetings`,
named after the date, time and title, for example `2026-11-23-0930-weekly-sync/`:

| File | Content |
|---|---|
| `notes.md` | Title, summary, key points, decisions, action items, open questions and the full transcript, in the language of the meeting |
| `transcript.md`, `transcript.json` | The conversation in order, each turn labelled as you or the other participants |
| `system.wav`, `mic.wav` | The audio: the other participants and your microphone (16 kHz, mono) |

The recording runs in the background, so the terminal can be used or closed
meanwhile. It works with any app (Slack, Teams, Google Meet, Zoom...) because it
captures the audio of the whole system. Headphones give the cleanest result: with
speakers the microphone also picks up the other participants, and although
that echo is removed from the transcript, some of it can slip through.

The first run needs two permissions for your terminal app, under
System Settings > Privacy & Security: **Microphone** and
**Screen & System Audio Recording**. Restart the terminal after granting them.

Other commands:

| Command | |
|---|---|
| `notes status` | Shows whether a recording is in progress |
| `notes stop --no-notes` | Stops and keeps the audio without processing it |
| `notes process <folder>` | Transcribes and summarizes a recorded meeting |
| `notes transcribe <folder>` | Only writes the transcript |
| `notes summarize <folder>` | Only rewrites the notes from the transcript |

## Settings

To change the defaults on this Mac, copy `config.example.json` to `config.local.json`
(not committed) and edit it:

| Setting | Default | Option for one run | |
|---|---|---|---|
| `meetingsDir` | `~/Meetings` | | Folder where meetings are stored |
| `language` | `auto` | `--language es` | Spoken language; `auto` detects it |
| `model` | `gemma3:12b` | `--model qwen2.5:14b` | Ollama model that writes the notes |

Ollama does not need to be running: it is started for the summary and stopped
afterwards. The notes are written by a small local model, so check names, owners
and dates against the transcript before relying on them.

If the recorder dies mid-meeting, `notes stop` recovers the audio saved until then.

Run the tests with `npm test`.

## Where things live

| What | Where | In git? |
|---|---|---|
| Code | this repository | Yes |
| Whisper models | `models/` in this repository (contents ignored by git) | No |
| Ollama model | Ollama's own store (`~/.ollama/models`) | No |
| Recordings and notes | `~/Meetings/` | No |
