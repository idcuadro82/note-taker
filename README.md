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

The script installs `whisper.cpp`, `ollama` and the Node dependencies, downloads the
models, builds the recorder and the menu bar app, and opens the app.
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

## Telling the participants apart

The other participants are told apart by their voices and appear in the
transcript as `Speaker 1`, `Speaker 2`... When someone says their name ("I am
Ana"), the notes use it for their tasks, and a **Participants** section lists who
is who. Two names next to one speaker mean two similar voices were confused.

It only applies to the notes written when the recording stops, not to the live
captions, and it never changes your own microphone: that is always you.

Voices can be confused, mostly similar ones or people who say very little. Turn it
off with `"separateSpeakers": "off"` in `config.local.json`, or with
`--no-speakers` for one run.

## Live captions

```bash
bin/notes.js start "Weekly sync" --live
```

Shows what is being said while the meeting happens, two to three seconds behind:
in a floating window if the menu bar app is open, or in the terminal with
`notes captions`. The text of whoever is talking appears dimmed and is corrected as
they go on. The window is hidden from screen sharing and screenshots.

The captions are a quick draft. When the recording stops, the whole meeting is
transcribed again more carefully for the notes.

Whisper works during the whole meeting, so expect more battery and CPU use than
a plain recording.

## Menu bar app

```bash
open build/NoteTaker.app
```

Adds a microphone icon to the menu bar to start and stop recordings without a
terminal, with or without live captions, and to stop them with the notes, with
only the transcript, or keeping just the audio. While recording it shows a red dot and
the elapsed time; while the notes are being written, the menu shows the progress.
From the menu you can also open the last notes, open the meetings folder and make
the app start at login.

It runs the same `notes` commands, so the terminal and the icon can be mixed.

The app needs its own **Microphone** and **Screen & System Audio Recording**
permissions (the ones given to the terminal do not apply to it): macOS asks the
first time you start a recording from the icon. Quit and reopen the app after
granting them.

`scripts/setup.sh` builds and opens the app. Rebuild it with `scripts/build-menubar.sh` after
upgrading Node or moving this folder; macOS may ask for the permissions again.

## Other commands


| Command | |
|---|---|
| `notes status` | Shows whether a recording is in progress |
| `notes captions` | Follows the live captions of the recording in progress |
| `notes stop --transcript-only` | Stops and writes the transcript, without the notes |
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
| `separateSpeakers` | `on` | `--no-speakers` | Tell the other participants apart by their voices |
| `notes` | `on` | `--transcript-only` | Write the notes; `off` stops at the transcript |

Writing the notes is the heavy step: the model needs about 10 GB of memory, the
transcript about 2 GB. With `"notes": "off"`, or **Stop and Transcribe Only** in
the menu, you get `transcript.md` (who said what) and Ollama is never started.
Write the notes later with `notes summarize <folder>`.

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
