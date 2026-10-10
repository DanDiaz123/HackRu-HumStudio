# HumStudio - Technical Specification

**Status:** Implementation contract. Sections are marked **Implemented** (code exists in `src/`) or **Target** (agreed interface, not built yet). Implemented does not mean tested on a real microphone.
**Version:** 1.1 (multi-track revision) | **Date:** 2026-10-10
**Target:** HackRU MVP - Next.js 16 App Router + React 19 + TypeScript + Tone.js 15 + Pitchy + `@tonejs/midi`

This file tells implementers **what to build, which interfaces to share, what edge cases to handle, and how to prove it works**. For product rationale and scope, read [`SOFTWARE_DESIGN_DOCUMENT.md`](SOFTWARE_DESIGN_DOCUMENT.md) and [`PRODUCT.md`](PRODUCT.md). Coding agents must also read [`AGENTS.md`](AGENTS.md). Ownership of each module is in [`WORKLOAD_SPLIT.md`](WORKLOAD_SPLIT.md).

> The app is a **multi-track instrument editor** (five fixed tracks). Generation sits behind `generateTrack(...)` and now uses deterministic melodic segmentation, harmony fitting, and quantization. The `Note` contract is unchanged; real-microphone tuning remains open.

## 0. Implementation priorities

- **P0:** Five instrument tracks over 8 bars of 4/4 **(implemented)**; click-to-zoom **(implemented)**; BPM/play/pause/stop/rewind, mute/solo **(implemented)**; microphone acquisition, live spectrogram, loading state, animated reveal **(implemented)**; multi-track MIDI export **(implemented)**; clear errors and Demo hum fallback **(implemented)**; monophonic hum-to-notes for the selected instrument with Off/1/4/1/8/1/16 quantization **(implemented; real-microphone tuning pending)**; note editing in the zoomed track *(target)*; local autosave and JSON import/export of all tracks *(target)*.
- **P1:** Four-beat playback count-in and metronome **(implemented; listening pending)**; recording count-in with click **(implemented; listening pending)**; manual note creation/deletion; undo/redo; instrument sound polish; confirm before overwriting a generated part.
- **P2:** Generation backend or ML model, Supabase, imported audio, effects, user-created tracks, collaboration.

**Integration milestone (implemented; listening pending):** sample `Note[]` (Keys, Drums) -> visible track clips -> Tone.js playback, with scheduling covered by regression fixtures. Next milestone: real hum -> `generateTrack` -> notes on the selected track.

## 1. Stack and environment

| Layer | Library/API | Notes |
|---|---|---|
| App | Next.js 16 (App Router) | React 19 + TypeScript; `src/` directory. Read `node_modules/next/dist/docs/` before using unfamiliar APIs. |
| Styling | Plain CSS (no framework) | Studio styles and tokens live in `src/app/globals.css`; see `DESIGN.md`. |
| Font | Archivo via `next/font/google` | `axes: ["wdth"]` for the condensed display width. |
| Audio playback | `tone` v15 | User-gesture audio start, transport, `PolySynth`/`MembraneSynth`/`NoiseSynth`. |
| Sampled sounds | `smplr` 1.1.0 | Lazy per-track sounds on Tone's underlying context; original synth fallback. |
| Microphone | `getUserMedia`, Web Audio | HTTPS/localhost, mic permission, client-only. |
| Pitch | `pitchy` | `PitchDetector.forFloat32Array(4096)`. |
| MIDI | `@tonejs/midi` | Encode a Standard MIDI File in browser. |
| State | React state in `Studio.tsx` (implemented); `useReducer` when editing/persistence land | Canonical `Track[]`; no Zustand/Redux. |
| Persistence | `localStorage` + browser file download/upload | *Target.* No auth/backend in MVP. |
| Testing | TypeScript + Node's built-in test runner | Playback, harmony, segmentation, and generation fixtures implemented. Manual browser checks remain required. |

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
    generate.ts              # implemented: generateTrack() / pure generateNotes()
    playback.ts              # implemented: browser-only playback facade
    midi.ts                  # implemented: multi-track export
    music/
      types.ts               # implemented: Note, QuantizeDivision (Project, PitchFrame, NoteSegment, DetectorConfig: target)
      timing.ts              # target: shared helpers (generate.ts has Hz/beat conversion)
      quantize.ts            # target: shared helpers (generate.ts uses tracks.ts QUANT_BEATS)
    audio/
      playback-engine.ts     # implemented: testable scheduling and lifecycle
      tone-backend.ts        # implemented: Tone.js adapter and instrument voices
      instrument-presets.ts  # implemented: stable IDs, defaults, catalog and drum mapping
      smplr-backend.ts        # implemented: browser-only sampled instrument factory
      preset-manager.ts      # implemented: async loading, fallback, resource leases
      sampled-voice.ts       # implemented: per-note sample stop handles and velocity adapter
      click-track.ts         # implemented: metronome and playback count-in
      segment-notes.ts       # implemented: segmentPitchFrames(), tunable configuration
      note-sensitivity.ts    # implemented: centralized Low/Medium/High tuning profiles
    persistence/
      local-project.ts       # target: multi-track save/load
  tests/                     # implemented: playback, harmony, segmentation, generation fixtures
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
  stableMs: number;      // Current segmentation default: 120
  silenceHoldMs: number; // Current segmentation default: 150
  mergeGapMs: number;    // Generation merge gap: 150, only within a phrase
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
  presetId: string;           // Stable category-specific sound ID; never an audio node or URL
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
| Melody | 60-84 (C4-C6) | `melody.flute`; sawtooth `PolySynth` fallback |
| Bass | 28-52 (E1-E3) | `bass.finger`; square `PolySynth` fallback |
| Keys | 48-72 (C3-C5) | `keys.grand`; triangle `PolySynth` fallback; sample Am-F-C-G part |
| Drums | rows 49 crash, 46 open hat, 42 hat, 38 snare, 36 kick | `drums.tr808`; `MembraneSynth`/`NoiseSynth` fallback; sample beat |
| Strings | 55-79 (G3-G5) | `strings.ensemble`; sine `PolySynth` fallback |

Lane geometry is derived in percent: `beatX(beat) = beat / 32 * 100`, `noteY(midi, inst) = (hi - midi) / rows * 100`. Never store pixel coordinates.

**Saved format (target).** `Project` v1 cannot hold tracks. The multi-track save format must be a new version, for example:

```ts
interface ProjectV2 {
  schemaVersion: 2;
  id: string; name: string; bpm: number; quantize: QuantizeDivision;
  tracks: { instrumentId: string; presetId: string; notes: Note[]; muted: boolean; solo: boolean }[];
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
  zcrHz?: number;        // zero crossings as a frequency; drums use it for hat vs snare (absent on demo frames)
}
```

`HumFrame` is a superset of the display needs plus pitch. It carries no `clarity` (it is gated inside `hum.ts`). The segmenter consumes only `tSec`, `hz`, and `rms`, without changing the capture contract. `PitchFrame`, `NoteSegment`, and `DetectorConfig` above remain target types; the implemented segmentation types are in section 7.

### 3.3 Generation seam (implemented, `src/lib/generate.ts`)

```ts
export async function generateTrack(
  inst: Instrument,
  frames: HumFrame[],
  bpm: number,
  quantize: QuantizeDivision,
  harmony: Harmony,
  sensitivity?: NoteSensitivity, // "low" | "medium" | "high"; omitted = "medium"
): Promise<Note[]>;
```

The UI calls only this. It delegates to the pure `generateNotes(inst, frames, bpm, quantize, harmony, sensitivity?, trace?): Note[]`; `sensitivity` (`NoteSensitivity`, default Medium) picks the segmentation profile and does not affect drums. Melodic generation segments frames in seconds, octave-fits the instrument, corrects harmony, merges identical pitches within the same phrase, then converts/snaps beat boundaries into one hummed line. Off preserves raw beat timing. A confirmed rest changes the phrase ID so later correction or snapping cannot merge separate attacks. The line is then shaped by instrument role (`src/tests/roles.test.ts`):

- **Melody:** on Low sensitivity, snapped to its own detected scale; on Medium/High the hummed integer pitches are kept so confirmed chromatic steps survive. Either way a short note 10+ semitones from both neighbours in the same direction is an octave error and folds back; velocity accents beat 1 > beat 3 > other beats > off-beats.
- **Bass:** root/fifth of each bar's chord; notes are split at barlines so a held note re-strikes on the new root, and a bar's first note within beat 1 is pulled onto the downbeat as the root.
- **Keys:** the hum is snapped to the song's scale and picks the chords: per bar, `pickChords` takes the diatonic triad covering the hummed notes best (+0.5 toward the current chord; unhummed bars keep theirs). Each hummed note becomes that triad, hummed pitch on top, the other tones within the octave below.
- **Strings:** a pad. Each note is held into the next (through breaths up to 2 beats, otherwise to its barline), split at barlines and re-fitted to chord tones, and doubled by the next chord tone below.
- **Drums:** onset = RMS above 0.02 and at least double its recent floor, at most one per 80 ms. In the next 60 ms, low pitch (<160 Hz) or a low spectral centroid is a kick; otherwise a mean `zcrHz` >= 3000 is a hat ("ts" hiss) and lower is a snare. Frames without `zcrHz` fall back to loudness (>= 60% of the take's loudest = snare). Eighth-note hats are added only when no hats were beatboxed.
- **Timing (all tracks):** before snapping, the take is shifted by the constant offset (within +/-80 ms, 5 ms steps, smallest on ties) that puts its onsets closest to the grid (`alignmentSec`; needs 3+ onsets, skipped for Off). This absorbs unmeasured mic latency and singing consistently ahead of or behind the click. It can only resolve offsets under half a grid step.

 Tempo outside 60..180, unknown grid values, and more than 10,000 frames throw; unusable melodic input returns `[]` (the UI keeps existing notes). Unknown sensitivity values throw. Canonical note contracts are unchanged; `generateTrack` gained only the optional trailing `sensitivity` argument.

`Studio.tsx` keeps each part's latest take (`HumFrame[]` in a ref, never audio, never persisted). Changing Sensitivity or Snap re-runs `generateNotes` for every cached take: Melody first (re-infers harmony), then Keys (re-picks chords), then the rest; parts without a take are refitted if harmony changed. Implicit refits (after a take or regeneration) never move Melody; only the explicit Key pick below does. A hand edit drops that part's take. An empty regeneration keeps the existing notes.

### 3.4 Shared harmony (implemented, `src/lib/music/harmony.ts`)

Tracks are hummed separately, so they must agree on a key and chords or they clash. The song has one `Harmony`, owned by `Studio.tsx` next to `Track[]`:

```ts
export interface Harmony { tonic: number; mode: "major" | "minor"; bars: number[][] } // 8 triads, pitch classes, root first
export const DEFAULT_HARMONY: Harmony; // C major, Am F C G x2 (the Keys sample)
```

- **Melody sets it.** A Melody take is snapped to its own detected key (Krumhansl-Schmuckler, `detectKey`), then `inferHarmony` picks one diatonic triad per bar (chord tones weighted by duration, x2 on beats 1 and 3, small priors for I/IV/V/vi and a tonic first bar; empty bars repeat the previous chord). `detectKey` gives a one-beat bonus each to the last and the longest note. Bars are chosen together by Viterbi with small bonuses for progression moves (V-I, IV-V, ii-V and similar), so a bar the melody fits about equally to two chords follows the progression.
- **The user can override the key.** The transport's Key select calls `withKey`: chords are re-picked from the Melody in that key (or the sample progression moves to it), and every pitched part, Melody included, is refitted.
- **Everything else fits it.** `fitToHarmony` moves pitches, never deletes notes: Bass to the nearest root/fifth of the bar's chord, Keys and Strings to the nearest chord tone, Melody to the scale, Drums untouched, all kept in the instrument's range.
- **Keys re-picks the chords.** A Keys take keeps the key but sets each hummed bar's chord to the triad it plays (`chordsFromVoicing` reads it back from the notes).
- After a Melody or Keys take, Studio re-voices a Sample Keys part (`voiceChords`) and re-fits every other generated pitched part to the new harmony.
- The multi-track `Project` schema must store `harmony`.

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

Path: `idle -> requesting -> recording -> generating -> revealing -> done`. The Demo hum skips `requesting`. Errors can occur at `requesting` (mic), after stop (fewer than 10 voiced frames), or in `generating` (no notes / throw); every error keeps existing notes and offers Try again and Demo hum. Recording auto-stops at `min(15 s, the end of the 8-bar timeline at the current BPM)`. While `requesting`/`recording`/`generating`/`revealing`, zoom changes, BPM, snap, play, and export are disabled. A recording count-in (four clicks, then the click continues) runs between `requesting` and `recording`; the Demo hum skips it. Only one session exists at a time.

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
3. **(implemented)** After permission, play a four-beat count-in, then keep the metronome clicking (no backing tracks; the mic has echo cancellation off) while capturing. The mic runs on Tone's AudioContext (`playback.micContext()`), so frames are stamped on the click's clock; `tSec` is rebased to the moment the first post-count-in click is heard (`engine.nowSec()` at `play()` plus output latency) and earlier frames are dropped. Demo hum skips the count-in. The arrangement and metronome setting are restored on finish/error/unmount.
4. **(implemented)** An `AudioWorkletNode` (`public/hum-worklet.js`, no outputs) forwards every mic sample to the main thread in 20 ms hops (`HOPS_PER_SEC = 50` at the actual sample rate). `hum.ts` keeps a 4096-sample sliding window, runs Pitchy on it each hop (`analyzeWindow`), and stamps the frame with the window centre on the audio clock (`windowCenterSec`). Hops queue rather than drop while the page is busy, and capture continues in a background tab. The AnalyserNode remains only for the spectrogram bins.
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

**Status: implemented** in `src/lib/audio/segment-notes.ts`, used by melodic `generateNotes`. Thresholds require real-device tuning (Person 1).

### Implemented API

```ts
export type SegmentationFrame = Pick<HumFrame, "tSec" | "hz" | "rms">;
export interface SegmentedNote {
  midi: number;
  startSec: number;
  endSec: number;
  phraseId: number; // Internal rest boundary; never stored in canonical Note[]
}
export interface SegmentationConfig {
  stableMs: number;
  silenceHoldMs: number;
  minNoteMs: number;
  medianWindow: number;
  pitchToleranceSemitones: number;
  reattackRatio: number; // default 1.8
  octaveHoldMs: number;  // default 250
}
export function segmentPitchFrames(
  frames: readonly SegmentationFrame[],
  options?: Partial<SegmentationConfig>,
): SegmentedNote[];
```

### Baseline strategy

1. Treat rejected or invalid pitch frames as unvoiced.
2. Map valid `hz` to *continuous* MIDI (`69 + 12 log2(hz/440)`), then apply a rolling median over recent valid frames; avoid prematurely rounding each noisy observation.
3. Retain the active/candidate pitch while the smoothed value stays within the selected `pitchToleranceSemitones` (Medium 0.7); otherwise round to a new integer MIDI pitch. This hysteresis suppresses boundary-crossing vibrato.
4. Start a **candidate** when a pitch appears; confirm only after it stays within the same note region for `stableMs` (default 120 ms). On confirmation, the onset is the earliest frame in the median window already within tolerance of the new pitch (the median notices a change about two frames late). The first note of a phrase starts at the phrase's first voiced frame when the unconfirmed lead-in (a scoop) is at most `stableMs`.
5. A candidate that changes before confirmation is replaced, not emitted.
6. During an active note, treat a short change as pitch jitter. If a different MIDI pitch remains stable for `stableMs`, close the prior segment and start another at the new candidate's first timestamp.
7. Keep the active note and median history across unvoiced gaps of at most `silenceHoldMs` (default 150 ms), measured from the first unvoiced frame. Longer silence or a missing-frame gap closes the note at the **last voiced timestamp**, clears history, and advances `phraseId`. All timing thresholds use seconds independently of BPM.
8. After instrument/harmony fitting, generation merges adjacent identical pitches only within the same phrase and a gap <= 150 ms. Quantization follows merging and caps overlaps; a confirmed rest cannot be undone by either step.
9. **Re-attack:** on the same pitch, a frame whose RMS is at least `reattackRatio` (1.8) times the quietest frame of the last 100 ms (itself >= 0.01, so dropouts are still bridged by step 7) closes the note at the dip and starts a new one at this frame with a new `phraseId`, once the held note is at least `minNoteMs` old. This separates "da-da-da".
10. **Octave slips:** a frame about an octave (+/-2 semitones) off the active note is folded back for up to `octaveHoldMs` (250 ms); a jump that lasts longer is a sung leap and becomes a note starting where the jump began. Octave leaps held for less than 250 ms are folded.
11. Drop segments below `minNoteMs` (default 100 ms), skip invalid/non-increasing timestamps, and limit input to 10,000 frames. Configuration timing must be finite and >0..1000 ms, medianWindow an integer 1..31, and pitchToleranceSemitones finite 0.5..3. Generation clips notes at beat 32. Neither function mutates input frames.

### Sensitivity profiles

`src/lib/audio/note-sensitivity.ts` is the single source of tunable segmentation values and exports `NoteSensitivity`, the option list, descriptions, and a validated `noteSensitivityConfig()` resolver. `SEGMENTATION_DEFAULTS` is its Medium configuration. Unknown, cross-type, and prototype names reject.

| Level | Pitch hold (semitones) | Stable change (ms) | Median (frames) | Minimum note (ms) |
|---|---|---|---|---|
| Low | 1.5 | 200 | 7 | 100 |
| Medium (default) | 0.7 | 120 | 5 | 100 |
| High | 0.5 | 60 | 3 | 60 |

Silence hold (150 ms), re-attack ratio (1.8) and octave hold (250 ms) are shared by all profiles. Melody snaps to its detected key only on Low; Medium and High keep hummed pitches (team decision 2026-10-10).

### Known limitations

- Fast trills, slides, vibrato across semitone boundaries, breathy tones and very low notes may require tuning.
- Repeated same-pitch syllables split on a level dip (step 9), but a near-silent gap of 150 ms or less is still bridged as a dropout, and a dip shallower than the 1.8 ratio merges. Stable pitch changes shorter than 120 ms can be suppressed.
- Mic input latency is not measurable in the browser; the grid alignment absorbs it when it is under half a grid step.
- Noise gating may reject quiet singing; thresholds are configurable, not universal.

### Expected example

```text
Frames:  C4 C4 C4 [one noisy C#4] C4 C4 --silence-- D4 D4 D4
Output: [{midi:60, startSec:..., endSec:...}, {midi:62, ...}]
```

Do **not** label a DSP pitch detector as a trained neural model unless a model is actually integrated.

## 8. UI specifications

### 8.1 Track lanes (implemented) and note editing (target)

- **Layout:** transport bar at least 56 px (groups wrap when needed), ruler 28 px, then five rows sharing the remaining height (min 56 px). Each row is a 232 px header (104 px at <= 720 px) plus a lane. Zoomed names fit the header even with the fallback font; the Key label/readout remains visible in compact layouts. Zooming animates `grid-template-rows` so the selected row takes the space and the others collapse to 36 px.
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

- **Transport bar (implemented):** wordmark, Rewind, Play/Pause toggle (pause preserves position), separate Stop (resets to zero), metronome toggle, four-beat playback count-in toggle, position readout `bar.beat.sixteenth`, BPM number input (60-180), Key select (24 keys) with the first four bars' chords, Snap select (Off, 1/4, 1/8, 1/16), Export MIDI. *Target:* Save Project, Open Project.
- **Zoomed header (implemented):** All tracks (back), instrument name, hint, Record / Stop / Re-record, Demo hum, and a status line with a filled-or-hollow mark plus text (e.g. "Demo hum 0:05.2", "Generating", "8 notes").
- A first Play click awaits `Tone.start()` before audio. Recording uses its own `AudioContext` and does not need Tone.
- **Defaults (implemented):** BPM = 120, quantization = 1/4, matching `Studio.tsx` and the shared defaults.
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

### Public interface (implemented, `src/lib/playback.ts` and engine)

```ts
// Public functions exported by src/lib/playback.ts:
export function ensureAudio(): Promise<PlaybackEngine>;
export function getEngine(): PlaybackEngine | null;
export function dispose(): void;

// Methods of the returned PlaybackEngine:
interface PlaybackEngine {
schedule(tracks: readonly Track[], bpm: number): void;
prepare(tracks: readonly Track[], retry?: boolean): Promise<void>;
subscribePresets(listener: (status: PresetStatus) => void): () => void;
play(): void;
pause(): void;
stop(): void;
rewind(): void;
positionBeats(): number;
state(): "started" | "paused" | "stopped";
setMetronome(enabled: boolean): void;
countIn(bpm: number, onBeat?: (remaining: number) => void): Promise<boolean>;
dispose(): void;
}
```

`playback.ts` exposes `ensureAudio()` (resolves to the engine), `getEngine()` (null until a Play click) and `dispose()`. `Studio.tsx` re-calls `engine.schedule()` whenever `tracks` or `bpm` change (once an engine exists), reads `positionBeats()` in a `requestAnimationFrame` loop, and uses `state()` to keep the controls aligned with the transport. It calls `dispose()` on unmount and shows an error if audio startup fails.

Contract and lifecycle:

- Use `Tone.start()` in the user-gesture initialization path and await its promise.
- Import Tone and smplr only during browser initialization after a Play, Record, or Sound-selection gesture. Use a shared `Tone.getTransport()` and `Tone.getContext().rawContext`; never introduce smplr's sequencer or a second playback clock. Original synths remain the fallback and supply the metronome.
- Convert `startBeat` to transport ticks (`Math.round(startBeat * transport.PPQ)`) and use supported tick/musical-time scheduling; this avoids hard-coding an absolute seconds timeline that becomes wrong when BPM changes.
- Use the transport callback's scheduled `time` parameter for synth attacks/releases, not `Date.now()`/`setTimeout()`.
- Schedule melodic note releases in ticks as well as attacks, so note lengths remain aligned to beats after tempo changes. Release boundary notes through the transport's `loopEnd` event because the loop resets before processing beat 32.
- Track every scheduled callback ID. `schedule` clears old owned events before replacement. On live edits/tempo changes, restart at the audible beat and recover sustained notes; a brief re-attack is an intentional tradeoff for cancelling lookahead audio reliably.
- `pause` preserves transport position and disposes pending/sounding voices; `stop` halts playback and resets to zero; `rewind` resets to zero while preserving running/paused state. On unmount, clear owned events, count-in timers, listeners, and synths. Do not close Tone's shared AudioContext.
- Validate BPM 60..180 before replacing the existing schedule. `Track[]` is typed app state and is not re-validated here; untrusted note data is validated once at JSON import (section 10). Playback covers the visible 32-beat loop; later onsets are silent and note ends are clipped at its boundary.
- Muted tracks are silent even when soloed. Multiple solo tracks play together. Independent synth lanes preserve durations of overlapping notes at the same pitch. Synthesized drums support MIDI 36, 38, 42, 46, and 49 with fixed percussive envelopes rather than sustained pitched-note durations.
- `positionBeats` reads transport ticks at the current audible AudioContext time, excluding Tone's lookahead. Before initialization `getEngine()` returns `null`.
- The optional metronome accents every four beats. `countIn` schedules four clicks on the audio clock without advancing the arrangement, and resolves `false` on pause/stop/rewind/reschedule/disposal. Count-in precedes playback when toggled, and always precedes a mic recording; microphone-relative timestamps start only after counting completes (§5). Background sample readiness while paused/stopped must not cancel this count-in.
- MIDI pitch is numeric in state. At synth boundary convert to note name/frequency with Tone helpers or verified pitch conversion; never change canonical note format.
- The editor is the canonical state. Tone.js scheduling is a **derived side effect**, never the only copy of the arrangement.

### Per-track sample selection and lifecycle

`instrument-presets.ts` holds 20 options (Melody 5, Bass 4, Keys 4, Strings 4, Drums 3), validated against installed smplr catalogs. The full catalog, exclusions, and verification are in [`SMPLR_INTEGRATION.md`](SMPLR_INTEGRATION.md). `presetForTrack(category, undefined)` supplies a missing legacy field's default; unknown/cross-category IDs reject before any schedule changes. Future JSON import must apply this migration and validation. Persistence itself is still unimplemented.

The labeled native selector sits directly beneath each expanded title. Changing it updates only that track's `presetId`; note arrays, IDs, pitch/timing, mute/solo, and category remain unchanged. Loading and fallback status stay outside serializable state. Play awaits audible selections; an explicit choice preloads even an empty track. Audio starts only on a user gesture.

`preset-manager.ts` deduplicates loads, ignores stale completions, retains the previous working sound on failure, and times out after 20 seconds. `smplr-backend.ts` caches decoded buffers, loads the category's pitch range/all velocity layers, rejects missing samples, and fetches only HTTPS assets from fixed sources without credentials. Asset sources/licenses are listed in [`public/sound-credits.txt`](public/sound-credits.txt), also linked from the selector. Raw microphone data is never sent to those hosts.

Sample resources are leased by independent voices and disposed only after their last lease ends. Each attack has a unique stop ID and owned stop handle. Absolute start/release times come from Tone callbacks; normalized velocity is clamped and rounded to 0..127. Pause immediately cancels even lookahead attacks and scheduled release tails. GM drum 36/38/42/46/49 maps to each loaded kit's verified group/sample aliases; melodic note-off does not choke one-shot drums, while pause/loop-end/disposal still stops them. A ready sound reschedules active playback at the same beat; paused/stopped playback has no voices to replace.

## 10. Project persistence

**Status: target (Person 4).** Must save **every track** (instrument id, preset id, notes, mute/solo) plus BPM and quantize, using the versioned format from 3.1. Missing legacy preset IDs receive defaults; unknown/cross-category IDs reject. The v1 contract below remains the baseline and must stay loadable.

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

`npm test` runs 100 tests: playback (incl. duplicate metronome ticks), 11 sensitivity, 10 harmony, 16 segmentation, 11 generation, 7 per-instrument role, 3 capture (sliding window, window-centre timestamps, synthetic mic path), 2 scoring tests, and the preset loading/voice suite, plus one test per real take in `src/tests/takes/*.json`. Real takes are captured in `npm run dev` with `copy(__humTake)` in the console (analysis frames only, no audio), given hand-written `expected` notes, and scored by note F1 (pitch equal, onset within 50 ms); an optional `minF1` makes a take a regression gate. Transcription fixtures cover 100 ms pitch wobbles, vibrato, 120 ms dropouts at 10/20/40 ms frame hops, the 150 ms silence boundary, genuine pitch changes/rests, harmony merging, all grids across 60/120/180 BPM, Off timing, instrument ranges, invalid input, immutability, and the async UI seam. Playback covers repeated scheduling, five-track timing, tempo changes, mute/solo, overlapping notes, transport lifecycle, invalid inputs, teardown, metronome/count-in cancellation, and preset selection. Preset fixtures cover catalog/defaults, GM aliases, stale loads, failure/timeout/retry, shared leases, velocity conversion, and individual stop handles. Persistence, MIDI, and real-microphone checks below remain targets; browser MIDI byte preservation is documented in [`SMPLR_INTEGRATION.md`](SMPLR_INTEGRATION.md).

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
| T-13 | `generateTrack` with synthetic C4-E4-G4 frames for Bass | Notes inside 28..52, each a root or fifth of its bar's chord |
| T-14 | `generateTrack` with all-unvoiced frames | `[]` (UI keeps existing notes) |
| T-15 | `exportMidi` bytes for Keys + Drums | Two MIDI tracks; drums on channel index 9 |
| T-16 | `detectKey` on C-E-G-C... / A-C-E-A... | C major / A minor **(implemented)** |
| T-17 | `snapToScale(61)` in C major | 60 (ties go down) **(implemented)** |
| T-18 | `inferHarmony` on a melody outlining C, F, G, C | C F G C, then C repeated into empty bars **(implemented)** |
| T-19 | `fitToHarmony` Bass over Am; Drums | Only A/E inside 28..52; Drums unchanged **(implemented)** |

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
- [x] Synthetic WAV through Edge's simulated microphone -> Pitchy -> generation -> note reveal: a held pitch with 100 ms semitone wobbles and 120 ms silent gaps produces one note; stable changes produce three notes at two pitches. Both takes stop their media tracks with no browser errors. This verifies the browser integration, not human-microphone accuracy or listening quality.
- [x] Sensitivity browser regression (pre-merge branch build): nine generated-WAV recording cases (0.6, 1, and 2 semitone changes at all three levels). Low changes only on the 2-semitone fixture; Medium also changes on 1; High also changes on 0.6. Default/keyboard selection, navigation, busy-state disabling, unchanged existing notes, microphone teardown, and 1280/390/320 px menu layouts pass with no browser errors (2026-10-10). Not re-run after the merge into main's role pipeline; physical-microphone tuning remains open.
- [ ] Edit note pitch/time/duration; synth reflects changes.
- [ ] Save JSON, refresh, reopen JSON; every track, BPM, and mute/solo survive.
- [ ] MIDI export opens in a MIDI application with one track per instrument, correct pitches and tempo.
- [ ] Stop/cancel/unmount releases mic; browser recording indicator clears.
- [x] `npm test` (100 tests, after merging sensitivity), lint, `npx tsc --noEmit`, and `npm run build` pass (2026-10-10).
- [x] Automated desktop Edge checks load and play all 20 sampled sounds, preserve note bars and exported MIDI bytes, exercise fallback/retry and rapid/live switching, and confirm one shared audio clock. Output RMS is positive during playback and zero after Pause; this is audio analysis, not human listening.
- [x] Automated Edge transport checks cover pause/resume, stop, rewind, 60/180 BPM, 32-beat looping, mute/solo, metronome, and playback count-in cancellation. Reload/navigation closes the old audio context. Human listening on the demo laptop remains required.

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
5. ~~Test segmentation with fixture frames independently of the microphone.~~ Done; real-device tuning remains (Person 1).
6. ~~Replace run grouping in `generateTrack`.~~ Done: segment -> instrument/harmony fitting -> merge -> quantize.
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
