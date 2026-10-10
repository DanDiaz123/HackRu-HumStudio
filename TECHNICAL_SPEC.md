# HumStudio - Technical Specification

**Status:** Proposed implementation contract (not evidence that code exists)  
**Version:** 1.0 | **Date:** 2026-10-09  
**Target:** HackRU MVP - Next.js App Router + React + TypeScript + Tone.js + Pitchy + `@tonejs/midi`

This file tells implementers **what to build, which interfaces to share, what edge cases to handle, and how to prove it works**. For product rationale and scope, read [`SOFTWARE_DESIGN_DOCUMENT.md`](SOFTWARE_DESIGN_DOCUMENT.md). Coding agents must also read [`AGENTS.md`](AGENTS.md).

## 0. Implementation priorities

- **P0:** One synth track; 4/4; editable 8-bar piano roll; BPM/play/pause/stop/rewind; microphone acquisition; monophonic humming-to-notes; Off/1/4/1/8/1/16 quantization; local autosave; JSON file import/export; MIDI export; clear errors.
- **P1:** Four-beat count-in and metronome; extra instruments; manual note creation/deletion; undo/redo; instrument polish; presets. A count-in should be implemented early if live recording is hard to align to a tempo.
- **P2:** Multi-track editing, Supabase, neural models, imported audio, effects, collaboration.

**Non-negotiable integration milestone:** `hardcoded Note[] -> visible piano roll -> audible Tone.js playback` before attempting voice transcription.

## 1. Stack and environment

| Layer | Library/API | Notes |
|---|---|---|
| App | Next.js (App Router) | React + TypeScript; use the `src/` directory. |
| Styling | Tailwind CSS (scaffold default) | Avoid another large UI system unless already present. |
| Audio playback | `tone` | User-gesture audio start, transport, `PolySynth`. |
| Microphone | `getUserMedia`, Web Audio | HTTPS/localhost, mic permission, client-only. |
| Pitch | `pitchy` | `PitchDetector.forFloat32Array(4096)`. |
| MIDI | `@tonejs/midi` | Encode a Standard MIDI File in browser. |
| State | React `useReducer` + Context | Single canonical `Project`; no requirement for Zustand/Redux. |
| Persistence | `localStorage` + browser file download/upload | No auth/backend in MVP. |
| Testing | `vitest` for pure modules (recommended) | Add tests after basic scaffold; manual browser checks remain required. |

Recommended: Node.js >= 20.9, npm, Chrome or Edge on desktop. Verify chosen package versions against the lockfile; do not rely on unverified snippets from a different Tone.js major version.

### New project bootstrap

If there is **no app repository yet**, run this in a suitable parent folder:

```bash
npx create-next-app@latest humstudio --typescript --eslint --tailwind --app --src-dir --use-npm
cd humstudio
npm install tone pitchy @tonejs/midi
npm run dev
```

Then copy these four documents into the repo root. If `create-next-app` generated its own `AGENTS.md`, reconcile it with this project's `AGENTS.md`; do not silently discard project-specific guidance. If an application already exists, **do not** run the scaffold command in it.

## 2. Planned repository layout

```text
humstudio/
  README.md
  SOFTWARE_DESIGN_DOCUMENT.md
  TECHNICAL_SPEC.md
  AGENTS.md
  package.json                 # created by scaffold; NOT supplied here
  src/
    app/
      layout.tsx
      page.tsx
      globals.css
    components/
      StudioClient.tsx
      PianoRoll.tsx
      TransportControls.tsx
      RecordPanel.tsx
      QuantizeSelector.tsx
    hooks/
      useRecorder.ts
    state/
      project-reducer.ts
    lib/
      music/
        types.ts
        timing.ts
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
      timing.test.ts
      quantize.test.ts
      segment-notes.test.ts
      export-midi.test.ts
```

This is a **target layout**, not an assertion that those files have been created. Prefer these names unless the team agrees to a consistent alternative.

## 3. Shared TypeScript contracts

Create `src/lib/music/types.ts` first. Import its types everywhere; do not define incompatible local `Note` copies.

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
  notes: Note[];         // Flat, one-track MVP
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

### 5.1 Recorder states

```ts
type RecorderStatus =
  | "idle" | "requesting-permission" | "ready" | "counting-in"
  | "recording" | "processing" | "error";
```

Allowed path: `idle -> requesting-permission -> ready -> [counting-in] -> recording -> processing -> idle`. The count-in is optional; errors may occur from any active stage. Only one recording session may exist at a time.

### 5.2 Acquisition and analysis

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

### Required API

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

### 8.1 Piano roll

- 4/4 time and 8 bars initially (beats 0..32); horizontally scroll if notes exceed the viewport.
- Vertical rows: one per semitone, showing at least C3 (48) to C6 (84).
- Coordinate mapping: `x = beat * pixelsPerBeat` and `y = (maxVisibleMidi - midi) * pixelsPerSemitone`.
- Strong lines every 4 beats, normal lines each beat, light lines for 1/16 divisions if selected.
- Note drag body: change start and MIDI pitch. Right-edge handle: change duration. Selection outline distinct from drag.
- Horizontal drag snaps to active grid. "Off" can round at 0.05 beat solely to avoid floating-point noise (do not present it as musical quantization).
- Clamp pitch to MIDI 0..127 and start to beat >= 0; minimum duration is selected grid step (or 0.1 beat when Off).
- Pointer capture prevents losing drag when pointer leaves rectangle. Support `pointercancel` and `Escape` to abandon a drag without committing partial changes.
- P0 fallback when drag-resize is difficult: a selected-note duration input plus drag for pitch/time.

### 8.2 Transport and recording panel

- Controls: Play, Pause, Stop, Rewind, BPM number input, Record, Stop Recording, Quantize selector, Save Project, Open Project, Export MIDI.
- Show recording state, visible level/pitch preview when available, and precise error messages.
- A first-time Play/Record click must call/await `Tone.start()` before synthesized audio.
- Default BPM = 120 and quantization = 1/16.
- When a recording finishes, either **replace the previous transcription** with confirmation or **append at the playhead**; choose one explicit rule and display it. Recommended hackathon behavior: replace the single-track notes after confirming if an existing melody would be overwritten; if editor is empty, insert directly.

### 8.3 Keyboard/accessibility

- Buttons and inputs have explicit labels and visible focus indicators.
- Provide status changes as text (not color only).
- Basic keyboard: `Space` toggles play/pause only when focus is not inside a text input; `Escape` cancels drag/recording modal. Avoid global shortcuts until stable.

## 9. Tone.js playback service

### Public interface

```ts
export interface PlaybackEngine {
  initializeFromUserGesture(): Promise<void>;
  setBpm(bpm: number): void;
  scheduleNotes(notes: readonly Note[]): void;
  play(): void;
  pause(): void;
  stop(): void;
  rewind(): void;
  dispose(): void;
}
```

Contract and lifecycle:

- Use `Tone.start()` in the user-gesture initialization path and await its promise.
- Use a shared `Tone.getTransport()` and simple `Tone.PolySynth`.
- Convert `startBeat` to transport ticks (`Math.round(startBeat * transport.PPQ)`) and use supported tick/musical-time scheduling; this avoids hard-coding an absolute seconds timeline that becomes wrong when BPM changes.
- Use the transport callback's scheduled `time` parameter for `triggerAttackRelease`, not `Date.now()`/`setTimeout()`.
- Convert `durationBeats` to a musical duration at current BPM; re-check the selected Tone.js major version's API when implementing.
- Track every scheduled callback ID. `scheduleNotes` must clear old events first to prevent duplicates, especially after edits/tempo changes.
- `pause` must preserve transport position while releasing sounding voices; `stop` halts playback and releases voices; `rewind` resets transport position. On unmount, clear events and dispose synth.
- MIDI pitch is numeric in state. At synth boundary convert to note name/frequency with Tone helpers or verified pitch conversion; never change canonical note format.
- The editor is the canonical state. Tone.js scheduling is a **derived side effect**, never the only copy of the arrangement.

## 10. Project persistence

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

### Public interface

```ts
export function createMidiBytes(project: Project): Uint8Array;
export function downloadMidi(project: Project): void;
```

### Reference mapping

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

Suggested reducer actions:

```ts
type ProjectAction =
  | { type: "SET_BPM"; bpm: number }
  | { type: "SET_QUANTIZE"; division: QuantizeDivision }
  | { type: "ADD_NOTES"; notes: Note[] }
  | { type: "REPLACE_NOTES"; notes: Note[] }
  | { type: "UPDATE_NOTE"; id: string; patch: Partial<Pick<Note, "midi" | "startBeat" | "durationBeats" | "velocity">> }
  | { type: "DELETE_NOTE"; id: string }
  | { type: "LOAD_PROJECT"; project: Project };
```

- All actions validate/clamp values and preserve structural sharing when sensible.
- Import, recording, and editing must funnel through this store. Never mutate `project.notes` in place.
- Recorder frames live in a mutable session ref until the user stops, avoiding thousands of reducer dispatches.
- Don't wipe existing notes on `PermissionDeniedError` or an empty transcription.
- Side effects (Tone schedule, local autosave) observe **committed** store changes; avoid duplicate scheduling during dragging by throttling or scheduling on pointerup.

## 13. Test matrix and acceptance criteria

### Unit tests (use synthetic fixtures)

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
| T-11 | Consecutive `scheduleNotes` calls | No duplicated playback events |
| T-12 | Start/stop mic twice | No orphaned media tracks or loops |

### Manual browser acceptance

- [ ] `npm run dev` displays UI without hydration errors.
- [ ] Hard-coded C4-E4-G4 sequence appears correctly and plays in time at 120 BPM.
- [ ] Play/Pause preserves position; edit while stopped and replay produces no layered duplicate notes.
- [ ] Microphone request works on localhost and approved HTTPS deployment.
- [ ] Deny permission: error message appears, app stays usable.
- [ ] Hum a clear melody; it becomes at least several correct-looking notes and can be replayed.
- [ ] Edit note pitch/time/duration; synth reflects changes.
- [ ] Save JSON, refresh, reopen JSON; note positions and BPM survive.
- [ ] MIDI export opens in a MIDI application with correct pitches and tempo.
- [ ] Stop/cancel/unmount releases mic; browser recording indicator clears.
- [ ] Run `npm run lint`, `npx tsc --noEmit`, and `npm run build` successfully (if those scripts exist after scaffold).

### Benchmarks, explicitly aspirational

For a clean 5-10 second single-voice melody, target >= 80% correct stable-note pitches, a perceptually useful quantized rhythm, and < 2 seconds from Stop to editable notes on a typical laptop. Measure empirically; do not claim compliance without testing.

## 14. Failure handling and demo preparation

| Failure | User message / system action |
|---|---|
| Permission denied | "Microphone access was denied. Allow it in browser settings or try the sample melody." |
| No audio device | "No microphone is available." |
| Insecure origin | "Recording requires HTTPS or localhost." |
| Silence/no voiced pitch | "No clear melody detected. Try humming closer to the microphone." Do not replace existing notes. |
| Recording too long | Auto-stop at 15 seconds; process accumulated frames. |
| Bad JSON | "This is not a valid HumStudio v1 project." Preserve previous project. |
| Audio context suspended | Prompt user to click Play/Enable Audio and retry `Tone.start()`. |
| Storage blocked | Warn that autosave is unavailable and offer Download Project. |

Always keep a prepared **sample melody fixture** and a rehearsed sequence available for judging. Demo backup must be presented honestly as a sample, not as live transcription.

## 15. Integration checklist and delivery order

1. Merge types, timing helpers, and a fixture note array.
2. Implement `PianoRoll` showing fixture notes; verify beat/pitch coordinate mapping.
3. Implement Tone playback service; test BPM changes and event cleanup.
4. Wire reducer state to editing and playback.
5. Implement mic recording session, timestamps, and first Pitchy Hz readout.
6. Test segmentation with fixture frames independently of the microphone.
7. Connect stopped recording -> segment -> quantize -> `Note[]` -> editor.
8. Add JSON autosave + file round trip and MIDI export.
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
