# HumStudio

**Turn a melody in your head into editable music.**

HumStudio is a proposed browser-based music sketchpad for **HackRU Fall 2026**. Hum or sing a simple tune, convert its pitches and rhythm into MIDI notes, adjust those notes on a piano roll, and play or export the result.

> **Current repository status:** This handoff contains **design and implementation documentation**. It does **not** contain a built or deployed application. The features below describe the planned HackRU MVP unless explicitly marked completed by the team.

## What are we building?

```text
Hum into your microphone
          |
          v
   Pitch + timing analysis
          |
          v
     MIDI Note[]
          |
          v
  Editable piano roll
          |
       +--+--+
       |     |
       v     v
     Play   Export
    synth   .mid
```

### Core MVP checklist

- [ ] **Record:** Capture a short (up to 15-second) solo hummed melody using the browser microphone.
- [ ] **Transcribe:** Estimate fundamental pitch and segment it into discrete notes.
- [ ] **Quantize:** Choose Off, quarter, eighth, or sixteenth notes at the selected tempo.
- [ ] **Edit:** Move notes in pitch/time and change note lengths in a piano roll.
- [ ] **Play:** Listen through a Tone.js synth, change BPM, pause, stop, and rewind.
- [ ] **Save/reopen:** Autosave locally and download/import `.humstudio.json` project files.
- [ ] **Export:** Download a standard `.mid` file for use in other music software.
- [ ] **Recover:** Handle denied microphone access, silence, and failed imports gracefully.

### If time remains

- [ ] Four-beat count-in and metronome
- [ ] Manual note insertion/deletion and extra synth presets
- [ ] Undo/redo, loops, and nicer note editing
- [ ] Multiple tracks, cloud projects, and optional ML-based enhancements (**stretch**, not MVP)

The demo targets **clear, one-note-at-a-time vocal melodies** in a reasonably quiet environment. It is **not** a full DAW and does not promise automatic transcription of chords, backing tracks, or complex singing.

## Architecture and technologies

| Concern | Choice |
|---|---|
| App / UI | Next.js App Router, React, TypeScript |
| Styling | Tailwind CSS |
| Browser microphone | `navigator.mediaDevices.getUserMedia`, Web Audio API |
| Fundamental pitch estimation | [Pitchy](https://github.com/ianprime0509/pitchy) |
| Pitch smoothing, rhythm, quantization | Small custom TypeScript DSP functions |
| Synth and musical transport | [Tone.js](https://tonejs.github.io/) |
| Standard MIDI export | [`@tonejs/midi`](https://github.com/Tonejs/Midi) |
| Project state | React reducer / context |
| Project persistence | Local browser storage + JSON file import/export |
| Cloud accounts | **Not required**; Supabase is a later option |

**Important:** The baseline pitch detector is **DSP**, not a trained generative AI model. We should describe the technology accurately when presenting the project.

## Getting started

The commands below describe **how to create and run the planned app**. They are not runnable inside this documentation-only bundle, because no `package.json` or source code is included yet.

### Requirements

- Node.js **20.9+** and npm
- Desktop Chrome or Edge for primary testing
- Microphone (headset recommended for avoiding metronome/audio bleed)
- A secure browser origin: `http://localhost:3000` in development, **HTTPS** when deployed

### 1. Create the Next.js application (if no app exists)

From an empty parent directory:

```bash
npx create-next-app@latest humstudio --typescript --eslint --tailwind --app --src-dir --use-npm
cd humstudio
```

Copy these documentation files to the project root, preserving the filenames:

```text
README.md
SOFTWARE_DESIGN_DOCUMENT.md
TECHNICAL_SPEC.md
AGENTS.md
```

If the scaffold generated its own `AGENTS.md`, compare and reconcile it with the project-specific guidance rather than losing either set of important instructions. **If your team already has a Next.js repository, skip scaffolding and add the documentation there.**

### 2. Install core dependencies

```bash
npm install tone pitchy @tonejs/midi
```

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Until the team implements the editor, the page will be the ordinary Next.js scaffold, **not** HumStudio's finished UI.

### 4. Check the implementation

After writing the app, use:

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test --if-present
```

Pure pitch/timing/quantization tests should be added with Vitest if the team has time; a real browser microphone test is still necessary.

## Planned file structure

```text
src/
  app/                         # Next.js page/layout/styles
  components/
    StudioClient.tsx           # Main interactive studio
    PianoRoll.tsx              # Note grid and drag interactions
    TransportControls.tsx     # BPM / play / pause / stop / rewind
    RecordPanel.tsx           # Mic permission and capture controls
    QuantizeSelector.tsx
  hooks/
    useRecorder.ts
  state/
    project-reducer.ts
  lib/
    music/
      types.ts                # Note / Project data contracts
      timing.ts               # Hz, MIDI, seconds and beats
      quantize.ts
      note-utils.ts
    audio/
      mic.ts
      pitch-detector.ts
      segment-notes.ts
      tone-engine.ts
    midi/
      export-midi.ts
    persistence/
      local-project.ts
  tests/
```

This structure is a **plan**, not a generated project scaffold. For exact TypeScript types, public functions and module ownership, read [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md).

## Key design choices

- **One canonical `Note[]`:** Each note has `midi`, `startBeat`, `durationBeats`, and `velocity`. Note timing is in **quarter-note beats** rather than seconds, so changing BPM does not relocate notes.
- **Pitch is not just an FFT peak:** Voice has harmonics. Pitchy helps estimate the fundamental; our own confidence gating and smoothing turn noisy readings into usable notes.
- **One voice in, one track out:** No automatic chord transcription in the MVP. The editing synth can still play overlapping manually edited notes.
- **Offline first:** Microphone/audio analysis is performed in the browser. No account, API key, cloud function, or network inference required.
- **Two export types:** `.humstudio.json` retains editable project information; `.mid` is for sharing notes with other music applications.

## Suggested HackRU build order

1. **Contract:** Agree on `Note`/`Project` types; scaffold and load a sample C-major melody.
2. **Editor:** Show `Note[]` in the piano roll and support pitch/time editing.
3. **Sound:** Play the exact note data with Tone.js at variable BPM.
4. **Voice:** Capture mic frames; display the current estimated pitch using Pitchy.
5. **Transcription:** Smooth pitch, segment notes, convert timestamps to beats, and quantize.
6. **Integrate:** Insert recognized `Note[]` into the editor, listen, and fix mistakes.
7. **Finish:** Save/open JSON, export MIDI, catch error cases, rehearse, and deploy over HTTPS.

Team ownership can be split into **Editor**, **Audio playback**, **Transcription**, and **Integration/export**. Parallel work should use the exact interfaces in the technical spec to avoid merge headaches.

## Suggested 90-second judge demo

1. **0-10 seconds:** State the problem: getting a tune out of your head and into a DAW is slow if you cannot play an instrument.
2. **10-30 seconds:** Show empty piano roll, 120 BPM, hit Record, and hum 4-8 clear notes.
3. **30-45 seconds:** Stop; show the generated notes and play them through the synth.
4. **45-60 seconds:** Drag one pitch or move a note; replay to hear the correction.
5. **60-75 seconds:** Show quantization and save/export MIDI.
6. **75-90 seconds:** Describe how the audio-to-editable-MIDI workflow opens up music creation for beginners and producers.

For a safe backup, include a **clearly labeled sample melody**. Never pretend a preset was transcribed live.

## Troubleshooting (once implemented)

| Symptom | Check |
|---|---|
| Mic button unavailable | Use localhost or HTTPS; check browser device permissions. |
| Permission denied | Enable microphone access in browser settings and reload. |
| No sound | Click Play/Enable Audio first to unlock browser AudioContext; check output device. |
| Empty/incorrect notes | Try clean solo humming in a quiet room, slower notes, closer mic, headphones. |
| Octave jumps | Check Pitchy clarity/range thresholds and reject harmonics/outliers. |
| Rhythm drifts | Confirm BPM, record-start zero point, segmentation and grid size. |
| Old notes play twice | Clear previous Tone transport event IDs before rescheduling. |
| Saved data missing | Browser local storage can be cleared or blocked; export a JSON file. |

## Privacy and data

Microphone permission is requested only for recording. The planned app analyzes raw audio locally and discards recording buffers afterward. It stores detected note/project data locally, or in a file only when the user exports it. No voice samples are uploaded or stored on a server in the MVP. Browser permissions and storage behavior still depend on browser settings.

## Documentation

- [**Software Design Document**](SOFTWARE_DESIGN_DOCUMENT.md) - product goals, architecture, system boundaries, risks, and acceptance criteria.
- [**Technical Specification**](TECHNICAL_SPEC.md) - exact note/project types, functions, audio pipeline, edge cases, and testing contract.
- [**Agent Instructions**](AGENTS.md) - constraints, development workflow, ownership, and verification rules for coding agents.

## Project metadata

- **Event:** HackRU Fall 2026
- **Project name:** HumStudio (working title)
- **License:** Not yet selected by the team. Add a `LICENSE` file before declaring an open-source license.
- **Contributions:** Coordinate changes to shared data types first, then follow `AGENTS.md`.

## References

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Pitchy - pitch detection](https://github.com/ianprime0509/pitchy)
- [Tone.js - Web Audio music toolkit](https://tonejs.github.io/)
- [`@tonejs/midi` - MIDI encoding](https://github.com/Tonejs/Midi)
- [MDN - microphone permission and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
