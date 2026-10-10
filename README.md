# HumStudio

**Turn a melody in your head into music.**

HumStudio is a browser-based music sketchpad for **HackRU Fall 2026**. It looks like a familiar multi-track editor: one track per instrument (Melody, Bass, Keys, Drums, Strings). Click a track to zoom into it, hum into your microphone while a live spectrogram prints your voice across the lane, and watch the track fill with generated notes. Then play the arrangement or export it as MIDI.

> **Current repository status:** The Next.js app and **studio UI are built**: arrangement view, track zoom, live hum spectrogram, loading state, animated note reveal, five-instrument Tone.js playback, and multi-track MIDI export. Playback includes separate pause/stop, rewind, mute/solo, a metronome, a four-beat playback count-in, and regression tests. **Melodic generation uses deterministic DSP segmentation** (`src/lib/audio/segment-notes.ts`) with harmony fitting and quantization; Drums still use simple RMS-onset heuristics. Note editing and project save/load remain separate workstreams. Real-microphone and audible playback verification remain open. See the [Person 2 handoff](WORKLOAD_SPLIT.md#person-2-implementation-handoff) for verification and limitations, and [`WORKLOAD_SPLIT.md`](WORKLOAD_SPLIT.md) for ownership.

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
- [x] **Generate:** stable pitch segmentation, harmony fitting, and Off/1/4/1/8/1/16 timing for melodic tracks, with a "Setting the session" loading state.
- [x] **Note sensitivity:** Low, Medium, and High in the top menu; Medium uses the original thresholds.
- [x] **Reveal:** notes wipe in left to right over a ghost of the hum; skipped under reduced motion.
- [x] **Play:** Tone.js playback of all tracks with mute/solo and BPM 60–180.
- [x] **Track sounds:** independent smplr preset dropdowns beneath expanded track titles, with lazy loading, retry, and the original synth fallback.
- [x] **Playback count-in / metronome:** optional four-beat count-in and beat clicks; listening verification remains open.
- [x] **Export:** multi-track `.mid` (drums on MIDI channel 10).
- [x] **Recover:** mic denial, insecure origin, missing device, and silent takes show a message plus a **Demo hum** fallback; failed takes never erase existing notes.
- [ ] **Real-device tuning:** validate the DSP generation with human humming on the demo microphone (Person 1).
- [ ] **Edit:** drag notes in pitch/time and resize them in the zoomed track (Person 3).
- [ ] **Save/reopen:** local autosave and project file import/export for all tracks (Person 4).
- [ ] **Recording count-in**, undo/redo, instrument polish (if time remains).

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
| Persistence | Not built yet (planned: local storage + JSON file) |
| Cloud / accounts | **None.** Audio never leaves the browser. |

**Important:** Nothing in this repo is a trained AI model. Pitch detection is DSP (Pitchy), and note generation uses deterministic heuristics. Describe it accurately when presenting.

Held notes tolerate short pitch wobbles and unvoiced gaps. Each take generates Low, Medium, and High note sets together. **Sensitivity** in the top menu switches the visible notes for every recorded track instantly, without another take. **Snap** immediately re-quantizes those visible notes to the selected grid; switching grids always starts from the take's unsnapped beat positions. Low needs large, sustained changes; Medium is the existing balanced response; High follows smaller/quicker changes and may capture more wobble. Sample tracks without recorded takes keep their existing notes. Drum onsets move to the selected grid while hit durations stay fixed; microphone volume/noise gates are unaffected.

### Fine-tuning note sensitivity

Edit the three `config` objects in [`src/lib/audio/note-sensitivity.ts`](src/lib/audio/note-sensitivity.ts). They are the single source of tuning values:

| Level | Pitch hold (semitones) | Stable change (ms) | Median window (voiced frames) | Minimum note (ms) |
|---|---|---|---|---|
| Low | 1.5 | 200 | 7 | 100 |
| Medium (default) | 0.7 | 120 | 5 | 100 |
| High | 0.5 | 60 | 3 | 60 |

A new pitch must exceed the hold distance from the held integer MIDI note and remain stable. Smaller `pitchToleranceSemitones` makes smaller changes count; smaller `stableMs`/`medianWindow` reacts faster. MIDI notes still use whole semitones, so High follows small shifts across a rounding boundary. Keep `minNoteMs` no larger than `stableMs` to avoid confirming a change that is then dropped as too short. Valid tolerance is 0.5..3 semitones, timing values are >0..1000 ms, and median windows are integers 1..31.

All profiles retain a 150 ms silence hold. Melody keeps its confirmed rounded pitches, including semitone changes, and defines the song's key/chords after the take. Bass, Keys, and Strings still fit those chords before merging, which can map detected changes to the same final pitch. Confirmed rests remain separate notes. Off preserves unsnapped beat timing. These are starting values for physical-microphone tuning; very fast repeated notes or rests of 150 ms or less can merge.

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

Open [http://localhost:3000](http://localhost:3000). Keys and Drums start with labeled sample notes. Press Play to unlock audio; Pause holds the position, Stop resets it, and Rewind returns to the start while preserving playback state. The **M** transport button toggles the metronome; **4** toggles a count-in before playback. Stop also cancels a pending count-in. A default tempo of 120 BPM and 1/16 snapping follow the shared contract.

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

`npm test` runs 77 tests for playback, preset loading/lifetimes, harmony, segmentation, generation, and sensitivity using TypeScript and Node's built-in test runner, without adding a testing dependency. Sensitivity fixtures verify small/normal/large changes in both directions, stability, spike rejection, real rests, the original Medium thresholds, preserved Melody semitone changes, every rhythm grid at 60/120/180 BPM, drum independence, input validation, and the async recording seam. Other fixtures cover sample switching/lifetimes, transcription continuity, and duplicate metronome ticks. Real browser listening and microphone tests are still necessary. The production build downloads the existing Archivo font from Google Fonts when it is not cached. Lint ignores the legacy generated `.test-build/` directory.

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

Planned, not yet created: note editing (`PianoRoll.tsx` or inside `TrackRow.tsx`) and persistence under `src/lib/persistence/`. Exact contracts are in [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md).

## Key design choices

- **One `Note` shape everywhere:** `midi`, `startBeat`, `durationBeats`, `velocity`, timed in **quarter-note beats** so BPM changes don't move notes. Defined in `src/lib/music/types.ts`.
- **Tracks per instrument:** app state is `Track[]` (`src/lib/tracks.ts`). Each track has an instrument (color, pitch range, synth/drums), its notes, and mute/solo flags.
- **One seam for generation:** the UI only calls `generateTrack(instrument, frames, bpm, quantize, harmony): Promise<Note[]>`. Swap the implementation; keep the signature (or coordinate a change).
- **Pitch is not an FFT peak:** Pitchy estimates the fundamental; the spectrogram is display only.
- **Honest samples:** Keys and Drums start with parts labeled **Sample**; the demo hum is labeled **Demo hum**. Never present a preset as live output.
- **Local processing:** no account, API key, or network inference. Sampled presets fetch upstream assets on demand; the synth fallback works without them.

## Suggested 90-second judge demo

1. **0–10 s:** The problem: getting a tune out of your head and into a DAW is slow if you can't play an instrument.
2. **10–20 s:** Show the arrangement (sample Keys and Drums) and press Play.
3. **20–45 s:** Click **Melody**, press **Record**, hum 4–8 clear notes, and point at the spectrogram printing live.
4. **45–60 s:** Stop. Show "Setting the session", then the notes setting in over the hum.
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

Microphone audio is analyzed in the browser and discarded after the take; only note data is kept, and only in memory today. Nothing is uploaded. Saved projects (once built) will store notes, never audio.

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
