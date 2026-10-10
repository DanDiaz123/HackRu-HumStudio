# HumStudio

**Turn a melody in your head into music.**

HumStudio is a browser-based music sketchpad for **HackRU Fall 2026**. It looks like a familiar multi-track editor: one track per instrument (Melody, Bass, Keys, Drums, Strings). Click a track to zoom into it, hum into your microphone while a live spectrogram prints your voice across the lane, and watch the track fill with generated notes. Then play the arrangement or export it as MIDI.

> **Current repository status (2026-10-10):** The Next.js studio includes arrangement view, track zoom, live hum spectrogram, animated reveal, five-instrument playback, collision-aware note editing, and MIDI export. Low/Medium/High sensitivity profiles are generated and cached per take for immediate switching; Snap rebuilds from capture tempo and updates notes immediately. The zoomed Drums tab has five rhythm-only parts (Kick, Snare, Closed hat, Open hat, Crash) in a dropdown; recording and editing target the selected lane while playback/export retain all lanes. Undo/redo, Clear/Repeat, keyboard shortcuts, strict ProjectV2 save/open, autosave, and v1 migration are built. The merged branch passes 170 tests, lint, TypeScript, production build, and automated Edge checks. Generation uses deterministic DSP and instrument roles; no trained model is implemented. Physical-microphone tuning, listening, deployment, and demo rehearsal remain open. See [`WORKLOAD_SPLIT.md`](WORKLOAD_SPLIT.md) for ownership.

## What are we building?

```text
Pick an instrument track
          |
          v
   Hum into the mic  ──>  live halftone spectrogram on the lane
          |
          v
 Generate notes for that instrument   (local DSP: src/lib/generate.ts)
          |
          v
  Notes revealed on the track (Note[] in beats)
          |
       +--+--+
       |     |
       v     v
     Play   Export
  (Tone.js) (.mid, one track per instrument)
```

### Feature checklist

- [x] **Arrangement view:** five instrument tracks over 8 bars of 4/4, with a transport bar (play/pause/stop, rewind, position, metronome, playback count-in, BPM, snap, Export MIDI).
- [x] **Zoom:** clicking a track floods it with its color and collapses the others; Escape or "All tracks" returns.
- [x] **Record:** microphone capture (up to 15 s or the end of the timeline) with Pitchy pitch estimation and a live spectrogram.
- [x] **Generate:** stable pitch segmentation, harmony fitting, and Off/1/4/1/8/1/16 timing for melodic tracks.
- [x] **Reveal:** shows the pipeline's real stages: detected notes print in, timing snaps when enabled, and the key/chords appear. Melody keeps confirmed pitches; other roles fit harmony. Skipped under reduced motion.
- [x] **Learn:** chord names and roman numerals on the zoomed lane's bar grid (the current chord lights during playback), key and part role in the track panel, do-re-mi on notes, and a live pitch readout (note, degree, cents) while recording.
- [x] **Note sensitivity:** Low, Medium, and High in the top menu; all three profiles are generated per take and swap immediately. Snap updates existing notes immediately. Hand edits opt a part out of automatic profile switching.
- [x] **Play:** Tone.js playback of all tracks with mute/solo and BPM 60–180.
- [x] **Track sounds:** independent smplr preset dropdowns beneath expanded track titles, with lazy loading, retry, and the original synth fallback.
- [x] **Playback count-in / metronome:** optional four-beat count-in and beat clicks; listening verification remains open.
- [x] **Export:** multi-track `.mid` (drums on MIDI channel 10).
- [x] **Recover:** mic denial, insecure origin, missing device, and silent takes show a message plus a **Demo hum** fallback; failed takes never erase existing notes.
- [ ] **Real-device tuning:** validate the DSP generation with human humming on the demo microphone (Person 1).
- [x] **Edit:** in the zoomed track, drag to move, drag either edge to stretch, click empty space to add, double-click or Delete to remove, arrows to nudge (Shift+arrows stretch). Edits snap to the Snap grid. Notes on one pitch never overlap: a move onto another note slides to the nearest free spot (or stays put), a stretch stops at the neighbour, and a new note fits the gap.
- [x] **Undo / redo:** buttons and Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) for edits, takes, key changes, Sensitivity/Snap regeneration, Clear/Repeat, and Open (100 steps, this session).
- [x] **Part actions:** Clear a part, or Repeat bars 1–4 onto 5–8. Re-recording a part you recorded or edited asks first.
- [x] **Save/reopen:** autosaves to this browser and restores on reload; Save downloads a `.humstudio.json` (all tracks, sounds, key/chords, BPM, Snap, Sensitivity); Open validates the whole file before replacing anything. v1 files load as the Melody track.
- [x] **Drum parts:** select Kick, Snare, Closed hat, Open hat, or Crash in the zoomed Drums tab; each part uses onset rhythm only and can be recorded, edited, cleared, repeated, saved, and exported with the other lanes intact.
- [x] **Keyboard:** Space play/pause, R record/stop, 1–5 open a track, Esc back, M/S mute/solo, K metronome, L Learn, Ctrl+S save, ? for the list.
- [x] **Recording count-in** (four clicks, then the click continues under the take).

The demo targets **clear, one-note-at-a-time humming** in a reasonably quiet room. It is **not** a full DAW and does not promise transcription of chords or complex singing.

## Architecture and technologies

| Concern | Choice |
|---|---|
| App / UI | Next.js 16 App Router, React 19, TypeScript |
| Styling | Plain CSS in `src/app/globals.css` (see [`DESIGN.md`](DESIGN.md)) |
| Type | Archivo variable font (`next/font/google`, `wdth` axis) |
| Browser microphone | `navigator.mediaDevices.getUserMedia`, Web Audio `AnalyserNode` |
| Fundamental pitch estimation | [Pitchy](https://github.com/ianprime0509/pitchy) |
| Spectrogram | `<canvas>` halftone drawn from 48 log-spaced bins (80–1000 Hz) |
| Note generation | `generateTrack(...)` in `src/lib/generate.ts`: local DSP segmentation, harmony fitting, then quantization |
| Sampled sounds | [smplr](https://github.com/danigb/smplr) 1.1.0; selected assets load on demand |
| Transport / synth fallback | [Tone.js](https://tonejs.github.io/) v15; same underlying audio context as smplr |
| MIDI export | [`@tonejs/midi`](https://github.com/Tonejs/Midi) |
| State | React state in `src/components/Studio.tsx` (`Track[]`) |
| Persistence | `localStorage` autosave + `.humstudio.json` files, schema v2 (`src/lib/persistence/project.ts`) |
| Cloud / accounts | **None.** Audio never leaves the browser. |

**Important:** Nothing in this repo is a trained AI model. Pitch detection is DSP (Pitchy), and note generation uses deterministic heuristics. Describe it accurately when presenting.

Held notes tolerate short pitch wobbles and unvoiced gaps: Medium uses 120 ms of stable pitch before a change, 150 ms of silence hold, a five-frame median, and a 0.7-semitone hold region. Confirmed rests still separate notes. Off preserves unsnapped timing. Voiced repeated syllables split on a level dip; recovery after a bridged dropout waits through the 100 ms re-attack window so it does not break a continuous note. Short octave slips are folded back. Repeated notes separated only by near-silence of 150 ms or less can still merge.

### Fine-tuning note sensitivity

Edit the three `config` objects in [`src/lib/audio/note-sensitivity.ts`](src/lib/audio/note-sensitivity.ts), the single source of segmentation tuning values (`SEGMENTATION_DEFAULTS` is Medium):

| Level | Pitch hold (semitones) | Stable change (ms) | Median window (voiced frames) | Minimum note (ms) |
|---|---|---|---|---|
| Low | 1.5 | 200 | 7 | 100 |
| Medium (default) | 0.7 | 120 | 5 | 100 |
| High | 0.5 | 60 | 3 | 60 |

Smaller `pitchToleranceSemitones` makes smaller changes count; smaller `stableMs`/`medianWindow` reacts faster. Keep `minNoteMs` no larger than `stableMs`. Valid tolerance is 0.5..3 semitones. Silence hold, re-attack ratio and octave hold are shared by all profiles. Melody retains confirmed pitches at every level. Studio caches all three profiles plus analysis frames and the capture BPM in memory. **Sensitivity** swaps profiles; **Snap** rebuilds timing at the original BPM, so later tempo changes do not move notes. Off restores original timing. A selected key survives both settings until a new Melody take. A hand edit drops that part's take; Snap still works on edited/sample notes without discarding deliberate overlaps.

## Getting started

The app already exists. Install the locked dependencies with `npm ci`, then run `npm run dev`. On Windows PowerShell, use `npm.cmd`/`npx.cmd` if script execution policy blocks the `.ps1` wrappers. Do not scaffold over the existing app.

### Requirements

- Node.js **20.9+** and npm
- Desktop Chrome or Edge (primary target)
- A microphone (a headset avoids playback bleeding into the mic)
- A secure origin: `http://localhost:3000` in development, **HTTPS** when deployed

### Run locally

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Keys and Drums start with labeled sample notes. Press Play to unlock audio; Pause holds the position, Stop resets it, and Rewind returns to the start while preserving playback state. The **M** transport button toggles the metronome; **4** toggles a count-in before playback. Stop also cancels a pending count-in. Studio defaults to 120 BPM, 1/4 snapping, and Medium sensitivity.

No microphone handy? Open a track and press **Demo hum**: it feeds a synthetic, clearly labeled hum through the same pipeline.

Open any track and choose **Sound** beneath its title. Each track retains its own choice and MIDI notes. Defaults are Flute, Fingered Electric Bass, Splendid Grand Piano, String Ensemble, and TR-808. Play preloads audible tracks; switching loads only the chosen sound. On a download failure, the previous working sound or original synth keeps playing; Retry sound retries that choice. The installed catalog has no TR-909, so Drums offer TR-808, LinnDrum LM-2, and Casio RZ-1. CP80 is excluded: two upstream OGG files are missing and its M4A files failed to decode in Edge. See [the integration handoff](SMPLR_INTEGRATION.md) for the full verified catalog and checks.

Samples need an initial network download from the upstream hosts. No audio is uploaded, and MIDI exports retain note data rather than sampled audio. See [sound credits and licenses](public/sound-credits.txt).

### Check your changes

```bash
npm run lint
npx tsc --noEmit
npm run build
npm test
```

`npm test` runs the 170 playback, preset, harmony, segmentation, capture, generation, persistence, editing, and MIDI regression tests using TypeScript and Node's built-in test runner, without adding a testing dependency. Fixtures cover held-note wobbles, short dropouts across frame rates and tempos, genuine rests, all sensitivity profiles, rhythm-only Drum parts, harmony merging, Off timing, sample switching, stale loads, fallback/retry, strict project validation and v1 migration, collision-aware edits, velocity conversion, and independent note stops. Automated Edge checks cover sensitivity/Snap switching, Drum part selection, Save/Open/autosave, undo/redo, invalid-file preservation, responsive controls, and synthetic microphone capture. Real browser listening and physical microphone tests are still necessary. The production build downloads the existing Archivo font from Google Fonts when it is not cached. Lint ignores the legacy generated `.test-build/` directory.

## File structure

```text
src/
  app/
    layout.tsx           # Archivo font, metadata
    page.tsx             # renders <Studio />
    globals.css          # design tokens + all studio styles
  components/
    Studio.tsx           # app shell: transport, ruler, rows, Track[] state, record/generate flow
    TrackRow.tsx         # one track: arrangement row or zoomed lane (prompt, phases, reveal)
    Spectrogram.tsx      # live halftone canvas on the lane's pitch axis
    icons.tsx            # inline SVG icons
  lib/
    tracks.ts            # Instrument, Track, INSTRUMENTS, sample parts, lane geometry
    hum.ts               # startMic (Pitchy) / startDemoHum -> HumFrame stream; mic error messages
    generate.ts          # generateTrack() async facade / generateNotes() pure DSP pipeline
    playback.ts          # browser-only playback facade: schedule, play/pause/stop, position, count-in
    midi.ts              # exportMidi(Track[], bpm) -> humstudio.mid
    music/               # shared contracts: types.ts (Note, QuantizeDivision)
    audio/               # note segmenter, playback engine, Tone/smplr adapters, presets, click track
  tests/                 # playback, presets, harmony, segmentation, generation + synthetic fixtures
```

Note editing lives in `TrackRow.tsx` with pure rules in `src/lib/note-edit.ts`; settings updates use `src/lib/music/arrangement-settings.ts`, and persistence is `src/lib/persistence/project.ts`. Exact contracts are in [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md).

## Key design choices

- **One `Note` shape everywhere:** `midi`, `startBeat`, `durationBeats`, `velocity`, timed in **quarter-note beats** so BPM changes don't move notes. Defined in `src/lib/music/types.ts`.
- **Tracks per instrument:** app state is `Track[]` (`src/lib/tracks.ts`). Each track has an instrument (color, pitch range, synth/drums), its notes, and mute/solo flags. The Drums track also stores the selected `drumPart`; all five rhythm lanes remain in its notes for playback/export.
- **Generation boundary:** `generateTrack(...)` remains the async single-profile facade; `generateTrackVariants(...)` computes all three profiles for the UI. Pure settings helpers preserve capture tempo, manual edits, and harmony decisions.
- **Pitch is not an FFT peak:** Pitchy estimates the fundamental; the spectrogram is display only.
- **Honest samples:** Keys and Drums start with parts labeled **Sample**; the demo hum is labeled **Demo hum**. Never present a preset as live output.
- **Local processing:** no account, API key, or network inference. Sampled presets fetch upstream assets on demand; the synth fallback works without them.

## Suggested 90-second judge demo

1. **0–10 s:** The problem: getting a tune out of your head and into a DAW is slow if you can't play an instrument.
2. **10–20 s:** Show the arrangement (sample Keys and Drums) and press Play.
3. **20–45 s:** Click **Melody**, press **Record**, hum 4–8 clear notes, and point at the spectrogram printing live.
4. **45–60 s:** Stop. Walk through the reveal: notes found, snapped into the key, chords. Fix one note by dragging it.
5. **60–75 s:** Back to all tracks; play the full arrangement; mute/solo a track.
6. **75–90 s:** Export MIDI and describe where this goes next.

If the room or mic fails, use **Demo hum** and say it is a demo hum.

## Troubleshooting

| Symptom | Check |
|---|---|
| "The microphone needs a secure page" | Use localhost or HTTPS. |
| "Microphone access was blocked" | Allow the mic in the address bar, reload, or use Demo hum. |
| No sound | Press Play first (browsers need a click to start audio); check the output device; check mute/solo. |
| "We didn't catch a hum" | Hum louder and closer, in a quieter room; fewer than 10 pitched frames counts as empty. |
| Wrong octave / jumpy notes | Check microphone input and tune Pitchy gates in `hum.ts` or the stability/hold thresholds in `audio/segment-notes.ts`. |
| Notes play twice | `schedule()` must clear previous Transport event IDs (it does; check new callers). |

## Privacy and data

Microphone samples are analyzed locally and discarded. Latest-take analysis features and sensitivity caches remain in memory only; hand edits remove that part's take cache. Saved projects and autosave contain notes and settings, never audio or analysis frames. Nothing is uploaded.

## Documentation

- [**Product**](PRODUCT.md): who it's for, what it must do, product principles.
- [**Design system**](DESIGN.md): palette, type, layout, motion, and the rules behind the look.
- [**Workload split**](WORKLOAD_SPLIT.md): four-person ownership, file boundaries, checkpoints.
- [**Software Design Document**](SOFTWARE_DESIGN_DOCUMENT.md): scope, architecture, risks, acceptance.
- [**Technical Specification**](TECHNICAL_SPEC.md): types, function contracts, audio pipeline, tests.
- [**Agent Instructions**](AGENTS.md): rules for coding agents and contributors.

## Project metadata

- **Event:** HackRU Fall 2026
- **Project name:** HumStudio (working title)
- **License:** Not yet selected. Add a `LICENSE` file before declaring one.
- **Contributions:** Coordinate changes to shared contracts (`src/lib/music/types.ts`, `src/lib/tracks.ts`) first, then follow `AGENTS.md`.

## References

- [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation)
- [Pitchy: pitch detection](https://github.com/ianprime0509/pitchy)
- [Tone.js: Web Audio music toolkit](https://tonejs.github.io/)
- [`@tonejs/midi`: MIDI encoding](https://github.com/Tonejs/Midi)
- [MDN: getUserMedia and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
