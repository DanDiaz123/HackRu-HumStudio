# AGENTS.md - HumStudio Engineering Rules

This file is for **AI coding agents and human contributors** working in the HumStudio repository. Read it **before** writing or changing implementation code.

**Project status:** These documents may be present before an app has been scaffolded. Do not assume a component, package script, or feature exists until you inspect the repository.  
**Project aim:** Browser-based, **monophonic hum -> editable MIDI notes -> piano-roll playback/export** for HackRU.  
**Working product name:** HumStudio.  
**Documentation precedence:** `TECHNICAL_SPEC.md` (shared interfaces, algorithms, acceptance) > `SOFTWARE_DESIGN_DOCUMENT.md` (product scope, rationale) > `README.md` (public onboarding). If documents conflict, correct the documentation as part of the change and tell the team.

## 1. Agent mission

**Ship a stable live-demo loop before anything ambitious.** A judge should be able to hum a clean melody, see notes, fix one, hear it, and export a project/MIDI file.

1. First: `Note[] -> PianoRoll -> Tone.js playback`, with hard-coded fixture notes.
2. Next: mic permission and capture -> Pitchy frames -> deterministic segmentation/quantization.
3. Then: recording result in editor, editable notes, JSON save/load, MIDI export.
4. Last: metronome, count-in, manual note authoring, polish. Add cloud, auth, and ML models only on explicit instruction after P0 works.

**Do not** build a full DAW, backend, Supabase login, multi-track editor, neural model, audio uploader, effects chain, or unrelated animation to "help" the MVP.

## 2. Inspect before changing

Before editing:

1. Read `README.md`, `SOFTWARE_DESIGN_DOCUMENT.md`, and `TECHNICAL_SPEC.md` relevant to your task.
2. List relevant existing files and inspect `package.json`/lockfile. Do not guess file paths or framework/library versions.
3. Identify the smallest affected modules and expected inputs/outputs.
4. If the repository contains only docs, scaffold the Next.js app in a **safe empty directory** or only after team approval to initialize the repo. Do not overwrite existing files.
5. If another developer or agent owns an active file, coordinate interfaces instead of replacing their changes.

Preferred terminal sequence when app exists:

```bash
npm install
npm run dev
npm run lint
npx tsc --noEmit
npm run build
npm run test --if-present
```

Only claim a command passed if it actually ran and passed. If no `package.json` exists yet, state that clearly rather than reporting test success.

## 3. Immutable shared contracts

The canonical types are defined in `TECHNICAL_SPEC.md` section 3 and should live in `src/lib/music/types.ts`:

```ts
export type QuantizeDivision = "off" | "1/4" | "1/8" | "1/16";
export interface Note {
  id: string;
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}
export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  bpm: number;
  quantize: QuantizeDivision;
  notes: Note[];
  createdAt: string;
  updatedAt: string;
}
```

**Never rename fields** (`midi`, `startBeat`, `durationBeats`) in a single module without updating all importers, serializers, tests, and the spec. Do not introduce `startTime`/`duration` in seconds into project state. **Quarter-note beats are the canonical musical time unit.**

Valid notes satisfy: integer MIDI 0..127; finite startBeat >= 0; finite durationBeats > 0; finite velocity 0..1. Default project BPM is 120 and quantization is `"1/16"`; tempo input is constrained to 60..180. Single-track, fixed 4/4 MVP.

## 4. Planned module boundaries

```text
src/components/                  # UI and note gestures only
src/hooks/useRecorder.ts         # recorder state and lifecycle
src/state/project-reducer.ts     # canonical serializable project state
src/lib/music/types.ts           # shared note/project interfaces
src/lib/music/timing.ts          # pitch/beat helpers
src/lib/music/quantize.ts        # quantization and conversion to Note[]
src/lib/audio/mic.ts             # browser mic / audio-frame lifecycle
src/lib/audio/pitch-detector.ts  # Pitchy adapter; raw PitchFrame[]
src/lib/audio/segment-notes.ts   # PitchFrame[] -> NoteSegment[]
src/lib/audio/tone-engine.ts     # transport/synth scheduling
src/lib/midi/export-midi.ts      # @tonejs/midi only
src/lib/persistence/local-project.ts # JSON validation/save/import/export
src/tests/                       # pure unit tests and fixtures
```

The exact folder names may change as a team decision, but **keep separation of concerns**. React components should not embed pitch math, MIDI encoding, or raw AudioContext teardown. Pure music functions must be testable without a browser.

## 5. Audio-specific guardrails

- **Browser-only:** `navigator`, `window`, `localStorage`, `AudioContext`, microphone streams, and Tone audio initialization cannot be executed at Next.js server-render time. Use `'use client'` boundaries and effects/event handlers where appropriate.
- **User gesture:** await `Tone.start()` after a real user click before playback.
- **No mic monitor:** connect input stream to analysis, not to speakers (`audioContext.destination`).
- **Cleanup is mandatory:** stop `MediaStreamTrack`s, cancel animation/frame loops, disconnect audio nodes, and release analysis resources after Stop, errors, or unmount.
- **No ghost schedulers:** clear Tone transport event IDs before rescheduling and dispose synthesizers on teardown. Never accumulate events on each React render.
- **No shared mutation:** do not put AudioNode, MediaStream, or mutable pitch buffers into the serializable `Project`.
- **Pitch:** use Pitchy fundamental estimate + clarity/RMS filtering. A loudest-FFT-bin algorithm is not an acceptable production replacement.
- **Rhythm:** calculate seconds relative to **recording start**, then convert to beats at `Project.bpm` and quantize. Do not count permission prompt or count-in as recorded time.
- **Claims:** This MVP uses DSP. Do not claim a trained AI model is implemented when it is not.

Initial detector tuning values: 4096-sample frames, approximately 20 ms hop, min clarity 0.85, min RMS 0.01, fundamental 80..1000 Hz, ~60 ms pitch stability, ~80 ms silence hold, ~100 ms min note. These are configurable estimates, not universal truths.

## 6. UI and data policy

- Single canonical reducer/store; note arrays are replaced immutably. Keep temporary drag state local and commit on `pointerup`.
- UI coordinates are derived from beats and MIDI pitch; no persistent pixel coordinates.
- Use `crypto.randomUUID()`/tested ID generator for note IDs. No array-index keys for draggable notes.
- A failed/empty recording must **not erase existing notes**. Confirm before replacing a nonempty transcription.
- Provide an explicit browser-error UI for mic permission denial, empty detection, and insecure origins.
- Preserve JSON import data only after full validation; reject oversized/unknown-schema input without modifying state.
- Raw microphone samples stay local and are **not uploaded or persisted**. Only note/project JSON is saved. No telemetry or cloud dependency in MVP.
- Keep labels and focus states accessible; no autoplay or deceptive interaction.

## 7. Dependencies and scope control

Use the agreed minimal stack:

```text
next, react, react-dom, typescript
     + tone
     + pitchy
     + @tonejs/midi
     + scaffold-provided styling/lint tools
```

Avoid dependency sprawl, API tokens, hosted inference, sample CDN requirements, and complex UI frameworks. If a new dependency is necessary, explain **why** its impact on reliability/time is worth it. Pin/lock dependencies through the repo's package lock after installation. No hard-coded credentials or `.env` secrets in committed code.

## 8. Coding standards and verification

- TypeScript strictness: prefer types over `any`; handle nullability and errors at boundaries.
- Small pure functions for frequency/pitch, timing, quantization, segmentation, and validation.
- Time units in names (`tSec`, `startBeat`, `durationBeats`, `hopMs`); never mix units silently.
- Gate unvoiced samples; test NaN, Infinity, negative values, empty arrays, and zero durations.
- Unit test deterministic algorithms with synthetic `PitchFrame[]` before testing live microphone input.
- Manually exercise the whole path on an actual browser; audio functionality cannot be proven by lint/build alone.
- After changing code, run available relevant checks (`npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test --if-present`) and report actual outcomes.
- Avoid modifying generated artifacts, dependencies, or unrelated files.

### Minimum fixture tests

```text
440 Hz -> MIDI 69; 220 Hz -> 57; 261.626 Hz -> 60
0.5 second at 120 BPM -> 1 quarter-note beat
1/16 quantization snaps 0.26 beat -> 0.25 beat
Single noisy pitch spike does not create a new note
Stable silence separates two different notes
JSON export/import preserves notes + BPM
MIDI export at 120 BPM maps beat 2 to 1.0 second
Repeated Tone scheduling does not create duplicated playback
```

## 9. Team coordination / parallel work

Keep workstream boundaries clear:

| Workstream | Owns | Depends on |
|---|---|---|
| Editor | `PianoRoll`, editing gestures, coordinate math | Shared `Note` type |
| Playback | Tone service, play/pause/stop/rewind, synth | Shared `Note` type |
| Transcription | mic/Pitchy, segmenter, quantizer | `PitchFrame`, `NoteSegment`, `Note` |
| Integration | reducer, autosave, file import/export, MIDI, errors | Above modules |

For a change that affects shared types or APIs, update `TECHNICAL_SPEC.md` and notify teammates before integration. Favor small pull requests/commits that can be tested independently; avoid rewriting another stream's files just to clean up style.

## 10. Definition of done per agent task

A task is complete only when its implementation:

1. Honors the data contracts and appropriate client/server boundary.
2. Handles obvious unhappy paths without deleting user data or leaking microphone/audio resources.
3. Includes a representative fixture or clear manual reproduction/check.
4. Passes available type/lint/tests/build checks, or explicitly lists what could not run and why.
5. Updates relevant docs if behavior/contracts changed.
6. Reports **changed files**, **tests actually run**, **known gaps**, and **next integration step** in its completion note.

### Forbidden shortcuts

- Never silently replace `Pitchy` with an unvalidated FFT peak detector.
- Never fake successful live transcription, tested browser permissions, or deployed URLs.
- Never fabricate package scripts/files that were not created.
- Never persist raw recorded voice or send it to a server without explicit team decision and user consent.
- Never delete existing notes following an empty recording.
- Never "finish" by adding auth/cloud/features unrelated to the core loop.

## 11. PR / handoff template

```text
Summary:
  What user-visible behavior changed?
Files changed:
  List exact paths.
Interfaces affected:
  Note/Project/PitchFrame contracts or none.
Verification:
  Commands and real browser checks actually completed.
Risks/limitations:
  Any known recording, quantization, or environment issues.
Follow-up:
  One concrete next integration step.
```

If blocked, report the smallest reproducible failure and preserve the stable, demo-able behavior rather than introducing risky last-minute architecture changes.
