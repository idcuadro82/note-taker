# Memory needed by each mode

How much memory the tool needs depends on what it is doing. Recording is nearly
free; writing the notes is the only heavy step, and it lasts a few minutes.

## Summary

| You want to... | Free memory needed |
|---|---|
| Record a meeting | Almost none (under 0.1 GB) |
| Record with live captions | About 2 GB |
| Get the transcript, without notes | About 2 GB |
| Get the notes | About 10 GB |

"Free memory needed" is what keeps the Mac fluid. With less, everything still
works: macOS moves other apps to disk to make room, and the Mac feels slow until
the step ends.

## By mode

| Mode | What runs | Memory | For how long |
|---|---|---|---|
| Menu bar icon, idle | NoteTaker | 18 MB | Always |
| Recording | Recorder | 28 MB | The whole meeting |
| Recording with live captions | Recorder, Whisper server | 1.85 GB | The whole meeting |
| Stop without Processing | Nothing else | — | — |
| Stop and Transcribe Only | Voice separation, then Whisper | 1.8 GB at most | About 11 min per hour of meeting |
| Stop and Write Notes | The same, then the notes model | 10 GB at most | About 15 min per hour of meeting |

## The steps after stopping

The steps run one after another, so their memory does not add up: the peak is
the largest step, not the sum.

| Step | Memory | Time per hour of meeting |
|---|---|---|
| Telling the speakers apart | 0.1 GB (2 min meeting) to 0.5 GB (1 hour) | 3 min |
| Transcribing (Whisper `large-v3-turbo`) | 1.8 GB | 7 to 8 min |
| Writing the notes (Ollama `gemma3:12b`) | 9.3 GB (2 min meeting) to 10.2 GB (1 hour) | 4 min |

The memory is released when each step ends: Ollama is started for the notes and
stopped afterwards, so nothing stays loaded between meetings.

## Which Mac

| Memory of the Mac | What to expect |
|---|---|
| 24 GB or more | Everything works. Close heavy apps before stopping to keep the Mac fluid while the notes are written. |
| 16 GB | Recording, captions and transcript are comfortable. The notes should fit but leave little room for anything else. Not tested. |
| 8 GB | Recording and the transcript work. The notes do not fit with the default model. |

## Using less memory

- **Skip the notes.** Use **Stop and Transcribe Only** in the menu,
  `notes stop --transcript-only`, or set `"notes": "off"` in `config.local.json`.
  The peak drops from 10 GB to 1.8 GB. The notes can be written later, when the
  Mac is free, with `notes summarize <folder>`.
- **Record now, process later.** **Stop without Processing** (`notes stop --no-notes`)
  keeps only the audio; run `notes process <folder>` afterwards.
- **Record without live captions.** Saves 1.8 GB during the meeting.
- **A smaller notes model.** `gemma3:4b` (`"model": "gemma3:4b"`) needs 4.7 GB
  instead of 10 GB and is about three times faster, but in the test below it
  found only 3 or 4 of the 6 tasks that `gemma3:12b` found.

## How this was measured

- MacBook with Apple M4 Pro and 24 GB of memory, macOS 27.2, whisper.cpp 1.9.6,
  Ollama 0.40.17.
- Simulated meetings of 2, 21 and 63 minutes, in Spanish, with synthetic voices:
  a 2-minute conversation between four people, repeated to make the longer ones.
- Memory is the peak resident memory of each process, sampled once per second.
  Times are from pressing stop until the file is written.
- No real meeting has been measured. Times depend on how much people talk, and
  memory on the model and on the length of the meeting, as shown above.
