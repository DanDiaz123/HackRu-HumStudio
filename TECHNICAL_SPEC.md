# HumStudio - Technical Specification

**Status:** Implementation contract. Sections are marked **Implemented** (code exists in `src/`) or **Target** (agreed interface, not built yet). Implemented does not mean tested on a real microphone.
**Version:** 1.1 (multi-track revision) | **Date:** 2026-10-10
**Target:** HackRU MVP - Next.js 16 App Router + React 19 + TypeScript + Tone.js 15 + Pitchy + `@tonejs/midi`

This file tells implementers **what to build, which interfaces to share, what edge cases to handle, and how to prove it works**. For product rationale and scope, read [`SOFTWARE_DESIGN_DOCUMENT.md`](SOFTWARE_DESIGN_DOCUMENT.md) and [`PRODUCT.md`](PRODUCT.md). Coding agents must also read [`AGENTS.md`](AGENTS.md). Ownership of each module is in [`WORKLOAD_SPLIT.md`](WORKLOAD_SPLIT.md).

> **1.1 change:** the app is a **multi-track instrument editor** (five fixed tracks), not a single-track piano roll. Generation sits behind `generateTrack(...)` and is currently a mock. The `Note` contract is unchanged.

## 0. Implementation priorities

- **P0:** Five instrument tracks over 8 bars of 4/4 **(implemented)**; click-to-zoom **(implemented)**; BPM/play/pause/stop/rewind, mute/solo **(implemented)**; microphone acquisition, live spectrogram, loading state, animated reveal **(implemented)**; multi-track MIDI export **(implemented)**; clear errors and Demo hum fallback **(implemented)**; monophonic hum-to-notes for the selected instrument with Off/1/4/1/8/1/16 quantization *(mock; target in sections 6-7)*; note editing in the zoomed track *(target)*; local autosave and JSON import/export of all tracks *(target)*.
- **P1:** Four-beat playback count-in and metronome **(implemented; listening pending)**; recording count-in *(target)*; manual note creation/deletion; undo/redo; instrument sound polish; confirm before overwriting a generated part. Implement recording count-in early if live recording is hard to align to tempo.
- **P2:** Generation backend or ML model, Supabase, imported audio, effects, user-created tracks, collaboration.

**Integration milestone (implemented; listening pending):** sample `Note[]` (Keys, Drums) -> visible track clips -> Tone.js playback, with scheduling covered by regression fixtures. Next milestone: real hum -> `generateTrack` -> notes on the selected track.

## 1. Stack and environment

| Layer | Library/API | Notes |
|---|---|---|
| App | Next.js 16 (App Router) | React 19 + TypeScript; `src/` directory. Read `node_modules/next/dist/docs/` before using unfamiliar APIs. |
| Styling | Plain CSS (no framework) | Studio styles and tokens live in `src/app/globals.css`; see `DESIGN.md`. |
| Font | Archivo via `next/font/google` | `axes: ["wdth"]` for the condensed display width. |
| Audio playback | `tone` v15 | User-gesture audio start, transport, `PolySynth`/`MembraneSynth`/`NoiseSynth`. |
| Microphone | `getUserMedia`, Web Audio | HTTPS/localhost, mic permission, client-only. |
| Pitch | `pitchy` | `PitchDetector.forFloat32Array(4096)`. |
| MIDI | `@tonejs/midi` | Encode a Standard MIDI File in browser. |
| State | React state in `Studio.tsx` (implemented); `useReducer` when editing/persistence land | Canonical `Track[]`; no Zustand/Redux. |
| Persistence | `localStorage` + browser file download/upload | *Target.* No auth/backend in MVP. |
| Testing | TypeScript + Node's built-in test runner | Playback regression suite implemented; other algorithm fixtures remain targets. Manual browser checks remain required. |

Recommended: Node.js >= 20.9, npm, Chrome or Edge on desktop. Verify chosen package versions against the lockfile; do not rely on unverified snippets from a different Tone.js major version.

### Running the project

The app is already scaffolded. **Do not** run `create-next-app` in this repo.

```bash
npm ci
npm run dev        # http://localhost:3000
npm run lint
npx tsc --noEmit
npm run build
npm test
```

## 2. Repository layout

```text
src/
  app/
    layout.tsx               # implemented: Archivo font, metadata
    page.tsx                 # implemented: renders <Studio />
    globals.css              # implemented: tokens + studio styles
  components/
    Studio.tsx               # implemented: shell, Track[] state, record/generate/reveal flow
    TrackRow.tsx             # implemented: arrangement row / zoomed lane
    Spectrogram.tsx          # implemented: halftone canvas
    icons.tsx                # implemented: SVG icons
    PianoRoll.tsx            # target (optional): note editing for the zoomed track
  lib/
    tracks.ts                # implemented: Instrument, Track, INSTRUMENTS, geometry
    hum.ts                   # implemented: mic + Pitchy + demo hum -> HumFrame
    generate.ts              # implemented as MOCK: generateTrack()
    playback.ts              # implemented: browser-only playback facade
    midi.ts                  # implemented: multi-track export
    music/
      types.ts               # implemented: Note, QuantizeDivision (Project, PitchFrame, NoteSegment, DetectorConfig: target)
      timing.ts              # target: frequencyToMidi, secondsToBeats, beatsToSeconds (mock uses generate.ts hzToMidi)
      quantize.ts            # target: getGridStep, snapBeat (mock uses tracks.ts QUANT_BEATS)
    audio/
      playback-engine.ts     # implemented: testable scheduling and lifecycle
      tone-backend.ts        # implemented: Tone.js adapter and instrument voices
      click-track.ts         # implemented: metronome and playback count-in
      segment-notes.ts       # target: segmentPitchFrames()
    persistence/
      local-project.ts       # target: multi-track save/load
  tests/                     # implemented: playback regression suite; other fixtures planned
```

The earlier plan's `StudioClient`/`TransportControls`/`RecordPanel`/`useRecorder` split was folded into `Studio.tsx` and `hum.ts`. The playback facade delegates to testable modules in `src/lib/audio/`. Extract smaller modules when a file gets in the way of parallel work, and coordinate with its owner first.

## 3. Shared TypeScript contracts

`src/lib/music/types.ts` exists and is the source of truth; `src/lib/tracks.ts` re-exports `Note` and `QuantizeDivision` from it. Import these types everywhere; do not define incompatible local `Note` copies.

```ts
export type QuantizeDivision = "off" | "1/4" | "1/8" | "1/16";

export interface Note {
  id: string;
  midi: number;          // Integer 0..127; 60 = C4, 69 = A4
  startBeat: number;     // Zero-based quarter-note beat position
  durationBeats: number; // Strictly positive
  velocity: number;      // Normalized 0..1
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  bpm: number;           // 60..180
  quantize: QuantizeDivision;
  notes: Note[];         // Flat; v1 predates multi-track (see 3.1)
  createdAt: string;
  updatedAt: string;
}

export interface PitchFrame {
  tSec: number;          // Seconds since actual recording began
  hz: number | null;     // Null = unvoiced or rejected frame
  clarity: number;      // 0..1
  rms: number;          // Frame amplitude, used as noise gate
}

export interface NoteSegment {
  midi: number;
  startSec: number;
  endSec: number;
  confidence: number;   // Diagnostic only, 0..1
}

export interface DetectorConfig {
  frameSize: 4096;
  hopMs: number;         // Initial: 20
  minClarity: number;    // Initial: 0.85
  minRms: number;        // Initial: 0.01
  minHz: number;         // Initial: 80
  maxHz: number;         // Initial: 1000
  medianWindow: number;  // Initial: 5 valid samples
  stableMs: number;      // Initial: 60
  silenceHoldMs: number; // Initial: 80
  mergeGapMs: number;    // Initial: 80
  minNoteMs: number;     // Initial: 100
}
```

### 3.1 Multi-track app contracts (implemented, `src/lib/tracks.ts`)

```ts
export interface Instrument {
  id: string;                 // "melody" | "bass" | "keys" | "drums" | "strings"
  name: string;
  color: string;              // flood color, e.g. "#f26b1d"
  lo: number;                 // lowest MIDI in the lane
  hi: number;                 // highest MIDI in the lane
  kind: "synth" | "drums";
  hint: string;               // prompt copy in the zoomed header
}

export interface Track {
  instrument: Instrument;
  notes: Note[];
  muted: boolean;
  solo: boolean;
  sample: boolean;            // true = preset part, shown labeled "Sample"
}

export const TOTAL_BEATS = 32;      // 8 bars of 4/4
export const MAX_RECORD_SEC = 15;
```

| Instrument | MIDI range | Notes |
|---|---|---|
| Melody | 60-84 (C4-C6) | sawtooth `PolySynth` |
| Bass | 28-52 (E1-E3) | square `PolySynth` |
| Keys | 48-72 (C3-C5) | triangle `PolySynth`; starts with a sample Am-F-C-G part |
| Drums | rows 49 crash, 46 open hat, 42 hat, 38 snare, 36 kick | `MembraneSynth` + `NoiseSynth`s; starts with a sample beat |
| Strings | 55-79 (G3-G5) | sine `PolySynth` |

Lane geometry is derived in percent: `beatX(beat) = beat / 32 * 100`, `noteY(midi, inst) = (hi - midi) / rows * 100`. Never store pixel coordinates.

**Saved format (target).** `Project` v1 cannot hold tracks. The multi-track save format must be a new version, for example:

```ts
interface ProjectV2 {
  schemaVersion: 2;
  id: string; name: string; bpm: number; quantize: QuantizeDivision;
  tracks: { instrumentId: string; notes: Note[]; muted: boolean; solo: boolean }[];
  createdAt: string; updatedAt: string;
}
```

Person 4 decides the final shape; add it to `types.ts` and notify the team rather than changing `Project` v1 in place. A v1 file should load as the Melody track.

### 3.2 Capture frame (implemented, `src/lib/hum.ts`)

```ts
export interface HumFrame {
  tSec: number;          // seconds since recording start
  bins: Float32Array;    // 48 log-spaced magnitudes, 80..1000 Hz, 0..1 (spectrogram display)
  hz: number | null;     // Pitchy fundamental, null when unvoiced/rejected
  rms: number;
}
```

`HumFrame` is a superset of the display needs plus pitch. It carries no `clarity` (it is gated inside `hum.ts`). When segmentation lands, either derive `PitchFrame[]` from it or add `clarity` to `HumFrame`; coordinate with Person 1.

### 3.3 Generation seam (implemented as mock, `src/lib/generate.ts`)

```ts
export async function generateTrack(
  inst: Instrument,
  frames: HumFrame[],
  bpm: number,
  quantize: QuantizeDivision,
): Promise<Note[]>;
```

The UI calls only this. The current mock waits ~2.4 s, groups voiced frames into same-semitone runs, octave-shifts the median into the instrument's range, snaps to the grid, and for Drums turns RMS onsets into kick/snare plus eighth-note hats. A real implementation (sections 6-7, or a backend) replaces the body and must: return valid notes (see invariants) inside the instrument's range, return `[]` or throw for unusable input (the UI shows an error and keeps existing notes), and keep the signature or coordinate a change.

### Invariant checks

```ts
function isValidNote(n: Note): boolean {
  return Number.isInteger(n.midi) && n.midi >= 0 && n.midi <= 127 &&
    Number.isFinite(n.startBeat) && n.startBeat >= 0 &&
    Number.isFinite(n.durationBeats) && n.durationBeats > 0 &&
    Number.isFinite(n.velocity) && n.velocity >= 0 && n.velocity <= 1;
}
```

Add similar checks for valid project name, array count, version, note IDs, timestamps and BPM. Limit imported note count (e.g., 10,000) and string lengths to avoid pathological files. Generate new IDs with `crypto.randomUUID()` in supported secure contexts or a tested fallback; do not use array indices as stable React keys.

## 4. Math and timing

### 4.1 Pitch to MIDI

```ts
export function frequencyToMidi(hz: number): number | null {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return midi >= 0 && midi <= 127 ? midi : null;
}
```

Known inputs: `440 Hz -> 69 (A4)`, `220 Hz -> 57 (A3)`, and approximately `261.626 Hz -> 60 (C4)`. Pitchy returns a fundamental estimate; **do not** substitute the strongest FFT peak as the main algorithm.

### 4.2 Seconds to beats

```ts
export function secondsToBeats(sec: number, bpm: number): number {
  return sec * bpm / 60;
}

export function beatsToSeconds(beats: number, bpm: number): number {
  return beats * 60 / bpm;
}
```

Only call with validated, finite, nonnegative seconds/beats and BPM in 60..180.

### 4.3 Quantization

A beat is a **quarter note**, not a bar. At 120 BPM, a quarter note lasts 0.5 s.

| Setting | Grid step in beats | Step at 120 BPM |
|---|---:|---:|
| Off | No snapping | N/A |
| 1/4 | 1.0 | 500 ms |
| 1/8 | 0.5 | 250 ms |
| 1/16 | 0.25 | 125 ms |

```ts
export function getGridStep(division: QuantizeDivision): number | null {
  return { off: null, "1/4": 1, "1/8": 0.5, "1/16": 0.25 }[division];
}

export function snapBeat(beat: number, division: QuantizeDivision): number {
  const step = getGridStep(division);
  if (step === null) return Math.max(0, beat);
  return Math.max(0, Math.round(beat / step) * step);
}
```

For each `NoteSegment`, calculate raw `startBeat`/`endBeat` and snap **boundaries** separately. Apply an end boundary at least one grid step beyond the start for quantized notes (for Off, minimum 0.1 beat), and keep values finite. For monophonic transcription, if grid rounding causes overlap with the next detected note, cap the earlier note at the next note's onset when a positive duration remains. **Do not shorten overlapping notes that the user edited manually.**

```ts
export function segmentsToNotes(
  segments: NoteSegment[],
  bpm: number,
  division: QuantizeDivision,
): Note[];
```

## 5. Browser capture protocol

### 5.1 Recorder phases (implemented in `Studio.tsx` / `TrackRow.tsx`)

```ts
type Phase = "idle" | "requesting" | "recording" | "generating" | "revealing" | "done" | "error";
```

Path: `idle -> requesting -> recording -> generating -> revealing -> done`. The Demo hum skips `requesting`. Errors can occur at `requesting` (mic), after stop (fewer than 10 voiced frames), or in `generating` (no notes / throw); every error keeps existing notes and offers Try again and Demo hum. Recording auto-stops at `min(15 s, the end of the 8-bar timeline at the current BPM)`. While `requesting`/`recording`/`generating`/`revealing`, zoom changes, BPM, snap, play, and export are disabled. A count-in phase (`counting-in`) is a P1 target. Only one session exists at a time.

### 5.2 Acquisition and analysis (implemented in `startMic`, `src/lib/hum.ts`)

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
});

const context = new AudioContext();
const source = context.createMediaStreamSource(stream);
const analyser = context.createAnalyser();
analyser.fftSize = 4096;
source.connect(analyser); // Do NOT connect microphone to destination.
const samples = new Float32Array(analyser.fftSize);
```

Implementation steps:

1. Check secure context and `navigator.mediaDevices` availability before requesting mic.
2. Request the stream from a click handler. A denied request sets an actionable error state, preserving existing notes.
3. If enabled, play a four-beat count-in **after** permission; set `recordingStartAudioTime` only at the beginning of active capture.
4. Every roughly 20 ms (using `requestAnimationFrame` with gating), fill `samples` from the analyser and pass the current buffer and actual sample rate to Pitchy.
5. Append **compact** `PitchFrame` objects, not copied PCM waveforms, to the recording session. Up to 15 seconds of frames is sufficient for demo.
6. On Stop (or 15-second maximum), stop the loop, close/cleanup the analysis graph and tracks, run segmentation + quantization, then dispatch `ADD_NOTES`/`REPLACE_NOTES` as intentionally chosen by UI policy.
7. On unmount/error/permission change, always run cleanup in `finally`. Never leave the browser mic active after Stop.

**Time origin:** Every frame's `tSec` must be measured relative to active capture, excluding permission and count-in. If the analysis window duration creates a constant offset, apply the same correction to all frames and test it; do not independently invent beat alignment from the audio file.

**Concurrency:** Guard against a second click while a session is active. Use a session token/ref so a stale permission promise or frame callback cannot append to a later recording. Cancelling must invalidate the session even if permission resolves afterward.

## 6. Pitch detection contract

**Implemented today:** `hum.ts` creates one `PitchDetector.forFloat32Array(4096)` per session and gates each frame on clarity >= 0.85, RMS >= 0.01, and 80-1000 Hz, emitting `HumFrame.hz`. **Target:** extract the pure function below so it can be unit-tested.

### Target API

```ts
export function detectPitchFrame(
  samples: Float32Array,
  sampleRate: number,
  elapsedSeconds: number,
  config: DetectorConfig,
): PitchFrame;
```

A detector object can be created once per session and reused (recommended); do not instantiate a 4096-sample detector every 20 ms. The samples buffer length must match the length given to `PitchDetector.forFloat32Array`.

### Pseudocode

```ts
const detector = PitchDetector.forFloat32Array(4096);
const [hz, clarity] = detector.findPitch(samples, sampleRate);
const rms = Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length);
const voiced = clarity >= cfg.minClarity && rms >= cfg.minRms &&
  Number.isFinite(hz) && hz >= cfg.minHz && hz <= cfg.maxHz;
return { tSec, hz: voiced ? hz : null, clarity, rms };
```

Allocation/CPU notes: reuse buffers, avoid rendering every frame into React, and optionally compute RMS in a basic `for` loop. The frame stream should not become component state on each iteration; emit a throttled UI preview (approximately 5-10 updates/sec) if desired.

## 7. Note segmentation algorithm

**Status: target.** The mock in `generate.ts` uses a much simpler run-grouping; replace it with this algorithm (Person 1).

### Required API

```ts
export function segmentPitchFrames(
  frames: readonly PitchFrame[],
  config: DetectorConfig,
): NoteSegment[];
```

### Baseline strategy

1. Treat rejected or invalid pitch frames as unvoiced.
2. Map valid `hz` to *continuous* MIDI (`69 + 12 log2(hz/440)`), then apply a rolling median over recent valid frames; avoid prematurely rounding each noisy observation.
3. Round the smoothed value to an integer MIDI note.
4. Start a **candidate** when a pitch appears; confirm only after it stays within the same note region for `stableMs` (initially 60 ms). On confirmation, use the candidate's first timestamp as onset.
5. A candidate that changes before confirmation is replaced, not emitted.
6. During an active note, treat a short change as pitch jitter. If a different MIDI pitch remains stable for `stableMs`, close the prior segment and start another at the new candidate's first timestamp.
7. If unvoiced frames persist for `silenceHoldMs` (initially 80 ms), close the note at the **last voiced timestamp** rather than at the delayed timeout.
8. Merge adjacent, same-pitch segments separated by a short gap <= `mergeGapMs` (initially 80 ms), except when future onset detection explicitly marks repeated notes.
9. Drop segments below `minNoteMs` (initially 100 ms), reject negative/NaN timestamps, clamp end to the recording duration, and sort by start time.

### Known limitations

- Fast trills, slides, vibrato across semitone boundaries, breathy tones and very low notes may require tuning.
- Two identical notes without a gap may merge into one sustained note. Solving that robustly requires onset/envelope detection beyond P0.
- AnalyserNode plus animation-frame polling is approximate; moving to an AudioWorklet is a later performance improvement.
- Noise gating may reject quiet singing; thresholds are configurable, not universal.

### Expected example

```text
Frames:  C4 C4 C4 [one noisy C#4] C4 C4 --silence-- D4 D4 D4
Output: [{midi:60, startSec:..., endSec:...}, {midi:62, ...}]
```

Do **not** label a DSP pitch detector as a trained neural model unless a model is actually integrated.

## 8. UI specifications

### 8.1 Track lanes (implemented) and note editing (target)

- **Layout:** transport bar 56 px, ruler 28 px, then five rows sharing the remaining height (min 56 px). Each row is a 232 px header (104 px at <= 720 px) plus a lane. Zooming animates `grid-template-rows` so the selected row takes the space and the others collapse to 36 px.
- 4/4 time, 8 bars (beats 0..32), fitted to the lane width.
- Vertical rows: one per semitone of the instrument's range (`Instrument.lo..hi`), or five named drum rows. C rows are labeled in the zoomed lane; the ruler corner shows the range (e.g. "C4-C6").
- Coordinate mapping in percent of the lane: `x = beat / 32` and `y = (inst.hi - midi) / rows`.
- Strong lines every bar, light lines each beat.
- The spectrogram canvas shares the lane's pitch axis (same octave shift as the generator), so revealed notes land on their dots.

**Editing (target, Person 3):**
- Note drag body: change start and MIDI pitch. Right-edge handle: change duration. Selection outline distinct from drag.
- Horizontal drag snaps to active grid. "Off" can round at 0.05 beat solely to avoid floating-point noise (do not present it as musical quantization).
- Clamp pitch to MIDI 0..127 and start to beat >= 0; minimum duration is selected grid step (or 0.1 beat when Off).
- Pointer capture prevents losing drag when pointer leaves rectangle. Support `pointercancel` and `Escape` to abandon a drag without committing partial changes.
- P0 fallback when drag-resize is difficult: a selected-note duration input plus drag for pitch/time.

### 8.2 Transport and recording controls

- **Transport bar (implemented):** wordmark, Rewind, Play/Pause toggle (pause preserves position), separate Stop (resets to zero), metronome toggle, four-beat playback count-in toggle, position readout `bar.beat.sixteenth`, BPM number input (60-180), Snap select (Off, 1/4, 1/8, 1/16), Export MIDI. *Target:* Save Project, Open Project.
- **Zoomed header (implemented):** All tracks (back), instrument name, hint, Record / Stop / Re-record, Demo hum, and a status line with a filled-or-hollow mark plus text (e.g. "Demo hum 0:05.2", "Generating", "8 notes").
- A first Play click awaits `Tone.start()` before audio. Recording uses its own `AudioContext` and does not need Tone.
- **Defaults (implemented):** BPM = 120, quantization = 1/16, matching `Studio.tsx` and the shared defaults.
- **Replace rule (implemented):** a successful take **replaces that track's notes** after the reveal; a failed or empty take changes nothing. The button reads "Re-record" when the track already holds a generated part. *P1:* confirm before overwriting a non-sample part.

### 8.3 Keyboard/accessibility

- Buttons and inputs have explicit labels and visible focus indicators.
- Provide status changes as text (not color only).
- Implemented: `Escape` returns from a zoomed track to all tracks (ignored while recording/generating). Mute/solo use `aria-pressed` and filled vs hollow marks. Generation status uses `aria-live`. Reduced motion disables the zoom and reveal animations.
- Target: `Space` toggles play/pause only when focus is not inside a text input; `Escape` also cancels a note drag.

## 9. Tone.js playback service

**Implemented playback scope (2026-10-10):** The current studio plays the five
`Track[]` instruments in `src/lib/tracks.ts`, following `PRODUCT.md` and the
Person 2 assignment. Playback does not change the canonical `Note` fields or
store audio resources in tracks. The versioned multi-track persistence contract
in section 3.1 remains an integration-owner task.

### Public interface (implemented, `src/lib/playback.ts`)

```ts
// Public functions exported by src/lib/playback.ts:
export function ensureAudio(): Promise<void>;
export function schedule(tracks: readonly Track[], bpm: number): void;
export function play(): void;
export function pause(): void;
export function stop(): void;
export function rewind(): void;
export function positionBeats(): number;
export function state(): "started" | "paused" | "stopped";
export function setMetronome(enabled: boolean): void;
export function countIn(bpm: number, onBeat?: (remaining: number) => void): Promise<boolean>;
export function dispose(): void;
```

`playback.ts` exposes `ensureAudio()` (resolves to the engine), `getEngine()` (null until a Play click) and `dispose()`. `Studio.tsx` re-calls `engine.schedule()` whenever `tracks` or `bpm` change (once an engine exists), reads `positionBeats()` in a `requestAnimationFrame` loop, and uses `state()` to keep the controls aligned with the transport. It calls `dispose()` on unmount and shows an error if audio startup or scheduling fails.

Contract and lifecycle:

- Use `Tone.start()` in the user-gesture initialization path and await its promise.
- Import Tone only during browser initialization after a Play gesture. Use a shared `Tone.getTransport()` and simple `Tone.PolySynth`; use synthesized percussion rather than downloaded samples.
- Convert `startBeat` to transport ticks (`Math.round(startBeat * transport.PPQ)`) and use supported tick/musical-time scheduling; this avoids hard-coding an absolute seconds timeline that becomes wrong when BPM changes.
- Use the transport callback's scheduled `time` parameter for synth attacks/releases, not `Date.now()`/`setTimeout()`.
- Schedule melodic note releases in ticks as well as attacks, so note lengths remain aligned to beats after tempo changes. Release boundary notes through the transport's `loopEnd` event because the loop resets before processing beat 32.
- Track every scheduled callback ID. `schedule` clears old owned events before replacement. On live edits/tempo changes, restart at the audible beat and recover sustained notes; a brief re-attack is an intentional tradeoff for cancelling lookahead audio reliably.
- `pause` preserves transport position and disposes pending/sounding voices; `stop` halts playback and resets to zero; `rewind` resets to zero while preserving running/paused state. On unmount, clear owned events, count-in timers, listeners, and synths. Do not close Tone's shared AudioContext.
- Validate BPM 60..180 before replacing the existing schedule. `Track[]` is typed app state and is not re-validated here; untrusted note data is validated once at JSON import (section 10). Playback covers the visible 32-beat loop; later onsets are silent and note ends are clipped at its boundary.
- Muted tracks are silent even when soloed. Multiple solo tracks play together. Independent synth lanes preserve durations of overlapping notes at the same pitch. Synthesized drums support MIDI 36, 38, 42, 46, and 49 with fixed percussive envelopes rather than sustained pitched-note durations.
- `positionBeats` reads transport ticks at the current audible AudioContext time, excluding Tone's lookahead. Before initialization `getEngine()` returns `null`.
- The optional metronome accents every four beats. `countIn` schedules four clicks on the audio clock without advancing the arrangement, and resolves `false` on pause/stop/rewind/reschedule/disposal. Count-in currently precedes playback; recording count-in remains a Person 1/4 integration decision, and must start microphone-relative timestamps only after counting completes.
- MIDI pitch is numeric in state. At synth boundary convert to note name/frequency with Tone helpers or verified pitch conversion; never change canonical note format.
- The editor is the canonical state. Tone.js scheduling is a **derived side effect**, never the only copy of the arrangement.

## 10. Project persistence

**Status: target (Person 4).** Must save **every track** (instrument id, notes, mute/solo) plus BPM and quantize, using the versioned format from 3.1. The v1 contract below remains the baseline and must stay loadable.

### Storage contract

```ts
const STORAGE_KEY = "humstudio:project:v1";

export function saveProjectLocal(project: Project): void;
export function loadProjectLocal(): Project | null;
export function downloadProjectJson(project: Project): void;
export function parseProjectJson(text: string): Project; // validates or throws
```

- `saveProjectLocal` serializes a validated object and traps `QuotaExceededError` and security restrictions; report nonfatal failures.
- Debounce autosave approximately 300-500 ms after document changes; never reserialize PCM/raw mic streams.
- File export uses a Blob with `application/json` and a short-lived object URL. Revoke the URL after download.
- File import uses a user-selected file and validates all fields/limits before changing state; preserve current project if invalid.
- Reject unknown `schemaVersion`, duplicate IDs, malformed notes, extreme values, and oversized files.
- `createdAt` is retained; `updatedAt` changes on saved mutations. Include no personally identifying data by default.

### Example document

```json
{
  "schemaVersion": 1,
  "id": "sample-project",
  "name": "First idea",
  "bpm": 120,
  "quantize": "1/16",
  "notes": [
    { "id": "n1", "midi": 60, "startBeat": 0, "durationBeats": 1, "velocity": 0.8 },
    { "id": "n2", "midi": 64, "startBeat": 1, "durationBeats": 1, "velocity": 0.8 },
    { "id": "n3", "midi": 67, "startBeat": 2, "durationBeats": 2, "velocity": 0.8 }
  ],
  "createdAt": "2026-10-09T00:00:00.000Z",
  "updatedAt": "2026-10-09T00:00:00.000Z"
}
```

This is a sample **data fixture**, not a generated user recording.

## 11. MIDI export

### Public interface (implemented, `src/lib/midi.ts`)

```ts
export function exportMidi(tracks: Track[], bpm: number): void; // downloads humstudio.mid
```

One MIDI track per non-empty instrument track, named after the instrument; Drums use channel index 9 (General MIDI channel 10); tempo set from BPM; beats converted with `seconds = beats * 60 / bpm`. *Target:* split out a pure `createMidiBytes(tracks, bpm): Uint8Array` so T-10 can run without a DOM.

### Reference mapping (v1, single track)

```ts
import { Midi } from "@tonejs/midi";

export function createMidiBytes(project: Project): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(project.bpm);
  const track = midi.addTrack();
  for (const note of project.notes) {
    track.addNote({
      midi: note.midi,
      time: note.startBeat * 60 / project.bpm,
      duration: note.durationBeats * 60 / project.bpm,
      velocity: note.velocity,
    });
  }
  return midi.toArray();
}
```

Validate first; sort note order; make a `.mid` Blob from the bytes (be mindful of typed-array/Blob TypeScript compatibility). Save tempo metadata and one note track. External MIDI players may select a different instrument from the in-app synth; the **pitches and timing** should still match. The `.mid` export is not the same as the editable `.humstudio.json` project.

## 12. State mutations and concurrency

**Today:** `Studio.tsx` keeps `Track[]`, `bpm`, `quantize` in `useState` and replaces arrays immutably (`setTracks(ts => ts.map(...))`). **Target** reducer once editing and persistence land, scoped by track:

```ts
type ProjectAction =
  | { type: "SET_BPM"; bpm: number }
  | { type: "SET_QUANTIZE"; division: QuantizeDivision }
  | { type: "REPLACE_TRACK_NOTES"; trackId: string; notes: Note[] }
  | { type: "UPDATE_NOTE"; trackId: string; id: string; patch: Partial<Pick<Note, "midi" | "startBeat" | "durationBeats" | "velocity">> }
  | { type: "DELETE_NOTE"; trackId: string; id: string }
  | { type: "TOGGLE_MUTE" | "TOGGLE_SOLO"; trackId: string }
  | { type: "LOAD_PROJECT"; project: ProjectV2 };
```

- All actions validate/clamp values and preserve structural sharing when sensible.
- Import, recording, and editing must funnel through this store. Never mutate `project.notes` in place.
- Recorder frames live in a plain array owned by the take (not React state) until the user stops; the spectrogram reads it in its own animation loop. Only the elapsed time updates React, at ~10 Hz.
- Don't wipe existing notes on `PermissionDeniedError` or an empty transcription.
- Side effects (Tone schedule, local autosave) observe **committed** store changes; avoid duplicate scheduling during dragging by throttling or scheduling on pointerup.

## 13. Test matrix and acceptance criteria

### Unit tests (use synthetic fixtures)

`npm test` runs 19 playback regression tests in `src/tests/playback.test.ts`, including repeated scheduling, five-track timing, tempo changes, mute/solo, overlapping notes, transport lifecycle, invalid inputs, teardown, and metronome/count-in timing and cancellation. The remaining algorithm, persistence, MIDI, and microphone fixtures below are targets.

| ID | Input | Expected result |
|---|---|---|
| T-01 | Hz 440, 220, 261.626 | MIDI 69, 57, 60 |
| T-02 | Hz 0, `NaN`, negative | `null` (no crash) |
| T-03 | 0.5 s at 120 BPM | 1 beat |
| T-04 | 0.26 beat at 1/16 | 0.25 beat |
| T-05 | 0.26 beat with Off | 0.26 beat |
| T-06 | C4 with single C#4 spike | One C4 segment after smoothing |
| T-07 | Two different stable note regions separated by silence | Two valid segments in chronological order |
| T-08 | Valid project -> stringify -> parse | Same BPM and notes |
| T-09 | Invalid imported note: negative duration | Reject without overwriting UI state |
| T-10 | MIDI C4 at beat 2, duration 1, 120 BPM | Note start=1.0 s, duration=0.5 s |
| T-11 | Consecutive `schedule()` calls | No duplicated playback events |
| T-12 | Start/stop mic twice | No orphaned media tracks or loops |
| T-13 | `generateTrack` with synthetic C4-E4-G4 frames for Bass | Notes inside 28..52, same contour |
| T-14 | `generateTrack` with all-unvoiced frames | `[]` (UI keeps existing notes) |
| T-15 | `exportMidi` bytes for Keys + Drums | Two MIDI tracks; drums on channel index 9 |

### Manual browser acceptance

- [x] `npm run dev` displays the studio without hydration errors.
- [x] Sample Keys and Drums parts render at the right beats and pitches (verified in screenshots).
- [ ] Sample parts play in time (listen on the demo laptop; not verified by ear yet).
- [x] Clicking a track zooms it; Escape returns; demo-hum take shows spectrogram, loading state, and reveal (screenshots in `.impeccable/review/`).
- [ ] Pause preserves position; Stop resets to zero; Rewind preserves running state; edit while stopped and replay produces no layered duplicate notes.
- [ ] Mute/solo combinations sound correct with two or more tracks.
- [ ] Microphone request works on localhost and approved HTTPS deployment.
- [ ] Deny permission: error message appears, app stays usable.
- [ ] Hum a clear melody; it becomes at least several correct-looking notes and can be replayed.
- [ ] Edit note pitch/time/duration; synth reflects changes.
- [ ] Save JSON, refresh, reopen JSON; every track, BPM, and mute/solo survive.
- [ ] MIDI export opens in a MIDI application with one track per instrument, correct pitches and tempo.
- [ ] Stop/cancel/unmount releases mic; browser recording indicator clears.
- [x] `npm test` (19 tests), `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass (re-run during the documentation merge on 2026-10-10).

### Benchmarks, explicitly aspirational

For a clean 5-10 second single-voice melody, target >= 80% correct stable-note pitches, a perceptually useful quantized rhythm, and < 2 seconds from Stop to editable notes on a typical laptop. Measure empirically; do not claim compliance without testing.

## 14. Failure handling and demo preparation

| Failure | User message / system action |
|---|---|
| Permission denied | "Microphone access was blocked. Allow it in the address bar, or use the demo hum." **(implemented)** |
| No audio device | "No microphone was found on this device." **(implemented)** |
| Mic busy | "Another app is using the microphone." **(implemented)** |
| Insecure origin | "The microphone needs a secure page. Open this over https or localhost." **(implemented)** |
| Silence/no voiced pitch | "We didn't catch a hum. Get closer to the mic and try again." Existing notes kept. **(implemented)** |
| Generator returns nothing | "No notes came out of that take. Try a longer, steadier hum." Existing notes kept. **(implemented)** |
| Recording too long | Auto-stop at 15 s or the end of the timeline; process accumulated frames. **(implemented)** |
| Bad JSON | "This is not a valid HumStudio v1 project." Preserve previous project. |
| Audio context suspended | Prompt user to click Play/Enable Audio and retry `Tone.start()`. |
| Storage blocked | Warn that autosave is unavailable and offer Download Project. |

The app ships labeled **Sample** parts (Keys, Drums) and a labeled **Demo hum**. Present them honestly as samples, never as live transcription.

## 15. Integration checklist and delivery order

1. ~~Merge types, timing helpers, and fixture notes.~~ Done.
2. ~~Show fixture notes on tracks; verify beat/pitch mapping.~~ Done (multi-track lanes).
3. ~~Tone playback service with BPM and event cleanup.~~ Done; verify by ear.
4. ~~Mic session, timestamps, Pitchy readout, spectrogram.~~ Done; verify with a real mic.
5. Test segmentation with fixture frames independently of the microphone (Person 1).
6. Replace the mock body of `generateTrack` with segment -> quantize -> fit-to-instrument (Person 1).
7. Note editing in the zoomed track, wired to state and playback (Person 3).
8. Multi-track JSON autosave + file round trip (Person 4).
9. Exercise denied permissions, silence, repeated recordings, and bad import.
10. Rehearse the exact 90-second demo and freeze nonessential features.

## 16. Sources / API references

- Next.js installation and App Router: https://nextjs.org/docs/app/getting-started/installation
- Next.js Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Pitchy usage: https://github.com/ianprime0509/pitchy
- Tone.js documentation: https://tonejs.github.io/
- Tone.js package usage/audio-start guidance: https://www.npmjs.com/package/tone
- `@tonejs/midi` usage: https://github.com/Tonejs/Midi
- Microphone security and permissions: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
