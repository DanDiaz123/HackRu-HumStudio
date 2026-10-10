<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md - HumStudio Engineering Rules

This file is for **AI coding agents and human contributors** working in the HumStudio repository. Read it **before** writing or changing implementation code.

**Project status:** The Next.js app is scaffolded and the multi-track studio UI is built (`src/components/Studio.tsx`, `TrackRow.tsx`, `Spectrogram.tsx`). Playback has a regression suite, metronome, and four-beat playback count-in. Melodic generation uses tested deterministic segmentation in `src/lib/audio/segment-notes.ts`, followed by instrument/harmony fitting, merging, and quantization in `src/lib/generate.ts`; Drums retain RMS heuristics. Note editing and persistence are not built. Real-microphone and audible playback verification remain open. Still inspect the repository before assuming a feature works.
**Project aim:** Browser-based **multi-track hum-to-music sketchpad** for HackRU: pick an instrument track, hum, see a live spectrogram, get notes for that instrument, play the arrangement, export MIDI.
**Working product name:** HumStudio.
**Documentation precedence:** `PRODUCT.md` (product scope) > `TECHNICAL_SPEC.md` (shared interfaces, algorithms, acceptance) > `SOFTWARE_DESIGN_DOCUMENT.md` (rationale) > `README.md` (onboarding). Visual decisions follow `DESIGN.md`; file ownership follows `WORKLOAD_SPLIT.md`. If documents conflict, correct the documentation as part of the change and tell the team.

## 1. Agent mission

**Ship a stable live-demo loop before anything ambitious.** A judge should be able to open a track, hum a clean melody, see notes appear, fix one, hear the arrangement, and export MIDI.

1. ~~Sample `Note[]` -> track lanes -> Tone.js playback.~~ Done.
2. ~~Mic permission and capture -> Pitchy frames -> spectrogram -> loading -> reveal.~~ Done with deterministic DSP generation; needs real-mic testing.
3. Now: real-device generation tuning, editable notes in the zoomed track, multi-track JSON save/load.
4. Last: manual note authoring, polish. Metronome, playback count-in, and recording count-in + click are implemented; listening verification remains open. Add cloud, auth, a generation backend, and ML models only on explicit team decision after the loop works.

**Do not** build a mixer, audio tracks, user-created tracks, Supabase login, neural model, audio uploader, effects chain, or new animation to "help" the MVP. The five instrument tracks, zoom, spectrogram, and reveal are the agreed scope (`PRODUCT.md`); polish them rather than adding more.

## 2. Inspect before changing

Before editing:

1. Read `README.md`, `PRODUCT.md`, and the parts of `TECHNICAL_SPEC.md` and `SOFTWARE_DESIGN_DOCUMENT.md` relevant to your task; read `DESIGN.md` before any UI change.
2. List relevant existing files and inspect `package.json`/lockfile. Do not guess file paths or framework/library versions (Next 16, React 19, Tone 15).
3. Identify the smallest affected modules and expected inputs/outputs.
4. The app is already scaffolded. **Never** run `create-next-app` or overwrite the scaffold.
5. Check `WORKLOAD_SPLIT.md` for the owner of each file. If another developer or agent owns it, coordinate interfaces instead of replacing their changes.

Preferred terminal sequence:

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

The canonical types are defined in `TECHNICAL_SPEC.md` section 3 ; `Note` and `QuantizeDivision` live in `src/lib/music/types.ts` (re-exported by `src/lib/tracks.ts`). `Project` is specified but not in code yet; add it with persistence:

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

Valid notes satisfy: integer MIDI 0..127; finite startBeat >= 0; finite durationBeats > 0; finite velocity 0..1. Tempo input is constrained to 60..180; the UI defaults to **BPM 120 and quantization `"1/16"`**. Fixed 4/4, 8 bars.

**Multi-track contracts** (`src/lib/tracks.ts`, see `TECHNICAL_SPEC.md` 3.1-3.3): `Instrument`, `Track { instrument, presetId, notes, muted, solo, sample }`, `INSTRUMENTS` (Melody, Bass, Keys, Drums, Strings), `HumFrame`, and the generation seam:

```ts
generateTrack(inst: Instrument, frames: HumFrame[], bpm: number, quantize: QuantizeDivision, harmony: Harmony): Promise<Note[]>
```

The song has one shared `Harmony` (`src/lib/music/harmony.ts`, `TECHNICAL_SPEC.md` 3.4): a Melody take sets the key and chords, and other pitched tracks are fitted to them so separately hummed parts never clash. App state is `Track[]` plus `Harmony`; never flatten tracks when playing, exporting, or saving. `Project` v1 is single-track; the multi-track save format must be a **new schema version**, not an edit to v1.

## 4. Module boundaries

```text
src/components/Studio.tsx        # shell, canonical Track[] state, record/generate/reveal flow   (Person 4)
src/components/TrackRow.tsx      # one track: arrangement row / zoomed lane / note UI           (Person 3)
src/components/Spectrogram.tsx   # halftone display of HumFrame[]                               (Person 1 + 3)
src/lib/tracks.ts                # Instrument, Track, INSTRUMENTS, lane geometry                 (shared)
src/lib/music/types.ts           # Note, QuantizeDivision; future project/capture contracts       (shared)
src/lib/music/harmony.ts         # shared key/chords: detectKey, inferHarmony, fitToHarmony   (Person 1, shared)
src/lib/hum.ts                   # mic lifecycle, Pitchy gating, demo hum -> HumFrame            (Person 1)
src/lib/generate.ts              # generateTrack() facade / generateNotes() pure DSP pipeline    (Person 1)
src/lib/playback.ts              # browser-only playback facade                                 (Person 2)
src/lib/audio/playback-engine.ts # testable transport/voices/scheduling                          (Person 2)
src/lib/audio/tone-backend.ts    # Tone.js adapter                                               (Person 2)
src/lib/audio/instrument-presets.ts # serializable category-specific preset catalog              (Person 2, shared)
src/lib/audio/preset-manager.ts  # lazy loading, fallback, switching, shared sample lifetimes    (Person 2)
src/lib/audio/smplr-backend.ts   # sampled instruments on Tone's underlying audio context        (Person 2)
src/lib/audio/sampled-voice.ts   # per-attack stop handles and MIDI drum mapping boundary        (Person 2)
src/lib/audio/click-track.ts     # metronome/count-in                                            (Person 2)
src/lib/midi.ts                  # @tonejs/midi export                                           (Person 4)
src/lib/audio/segment-notes.ts   # implemented: gated HumFrame -> SegmentedNote[] + rest boundary (Person 1)
src/lib/persistence/             # target: multi-track JSON validation/save/import/export       (Person 4)
src/tests/                       # playback, harmony, segmentation, generation regression suites
```

Extract smaller modules when it helps parallel work, but **keep separation of concerns**. React components should not embed pitch math, MIDI encoding, or raw AudioContext teardown. Pure music functions must be testable without a browser.

## 5. Audio-specific guardrails

- **Browser-only:** `navigator`, `window`, `localStorage`, `AudioContext`, microphone streams, and Tone audio initialization cannot be executed at Next.js server-render time. Use `'use client'` boundaries and effects/event handlers where appropriate.
- **User gesture:** await `Tone.start()` after a real user click before playback.
- **No mic monitor:** connect input stream to analysis, not to speakers (`audioContext.destination`).
- **Cleanup is mandatory:** stop `MediaStreamTrack`s, cancel animation/frame loops, disconnect audio nodes, and release analysis resources after Stop, errors, or unmount.
- **No ghost schedulers:** clear Tone transport event IDs before rescheduling and dispose synthesizers on teardown. Never accumulate events on each React render.
- **No shared mutation:** do not put AudioNode, MediaStream, or mutable pitch buffers into the serializable `Project`.
- **Pitch:** use Pitchy fundamental estimate + clarity/RMS filtering (`hum.ts` does). A loudest-FFT-bin algorithm is not an acceptable production replacement. The 48-bin FFT data in `HumFrame.bins` is for the spectrogram display only.
- **Rhythm:** calculate seconds relative to **recording start**, then convert to beats at `Project.bpm` and quantize. Do not count permission prompt or count-in as recorded time.
- **Claims:** This MVP uses DSP and deterministic generation heuristics. Do not claim a trained AI model or a backend is implemented when it is not.

Initial detector tuning values: 4096-sample frames, approximately 20 ms hop, min clarity 0.85, min RMS 0.01, fundamental 80..1000 Hz. Implemented segmentation defaults: 120 ms pitch stability, 150 ms silence hold, 100 ms min note, five-frame median, and 0.7-semitone pitch hold region. These are configurable estimates, not universal truths; short repeated attacks can merge.

## 6. UI and data policy

- One canonical owner of `Track[]` (`Studio.tsx` today; a reducer when editing/persistence land); note arrays are replaced immutably. Keep temporary drag state local and commit on `pointerup`.
- UI coordinates are derived from beats and MIDI pitch; no persistent pixel coordinates.
- Use `crypto.randomUUID()`/tested ID generator for note IDs. No array-index keys for draggable notes.
- A failed/empty recording must **not erase existing notes** (implemented). A successful take replaces only the selected track's notes; adding a confirmation before overwriting a non-sample part is a P1 task.
- Provide an explicit browser-error UI for mic permission denial, empty detection, and insecure origins.
- Preserve JSON import data only after full validation; reject oversized/unknown-schema input without modifying state.
- Raw microphone samples stay local and are **not uploaded or persisted**. Only note/project JSON is saved. No telemetry or cloud dependency in MVP.
- Keep labels and focus states accessible; no autoplay or deceptive interaction. Sample parts stay labeled "Sample" and the synthetic input stays labeled "Demo hum".
- UI changes follow `DESIGN.md` (tokens in `src/app/globals.css`, Archivo, square corners, flood colors per instrument). Don't restyle globally without the design owner.

## 7. Dependencies and scope control

Use the agreed minimal stack:

```text
next, react, react-dom, typescript
     + tone
     + pitchy
     + @tonejs/midi
     + smplr (explicitly authorized per-track sampled presets)
     + scaffold-provided styling/lint tools
```

Avoid dependency sprawl, API tokens, hosted inference, and complex UI frameworks. The user-authorized smplr feature fetches selected sample assets from `gleitz.github.io` and `smpldsnds.github.io`; preserve the synth fallback and `public/sound-credits.txt`. No microphone data is uploaded. Other network dependencies require an explicit scope decision. Pin/lock dependencies through the repo's package lock after installation. No hard-coded credentials or `.env` secrets in committed code.

## 8. Coding standards and verification

- TypeScript strictness: prefer types over `any`; handle nullability and errors at boundaries.
- Small pure functions for frequency/pitch, timing, quantization, segmentation, and validation.
- Time units in names (`tSec`, `startBeat`, `durationBeats`, `hopMs`); never mix units silently.
- Gate unvoiced samples; test NaN, Infinity, negative values, empty arrays, and zero durations.
- Unit test deterministic algorithms with synthetic `PitchFrame[]` before testing live microphone input.
- Manually exercise the whole path on an actual browser; audio functionality cannot be proven by lint/build alone.
- After changing code, run available relevant checks (`npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test --if-present`) and report actual outcomes.
- Avoid modifying generated artifacts, dependencies, or unrelated files.

### Minimum fixture tests (playback, harmony, segmentation, and generation suites exist; persistence/MIDI fixtures remain targets)

```text
440 Hz -> MIDI 69; 220 Hz -> 57; 261.626 Hz -> 60
0.5 second at 120 BPM -> 1 quarter-note beat
1/16 quantization snaps 0.26 beat -> 0.25 beat
Single noisy pitch spike does not create a new note
Stable silence separates two different notes
JSON export/import preserves notes + BPM
MIDI export at 120 BPM maps beat 2 to 1.0 second
Repeated Tone scheduling does not create duplicated playback
generateTrack returns notes inside the instrument's range, and [] for silence
detectKey: C-E-G-C melody -> C major; inferHarmony: C|F|G|C melody -> C F G C chords
```

## 9. Team coordination / parallel work

Workstreams, owners, and checkpoints are defined in [`WORKLOAD_SPLIT.md`](WORKLOAD_SPLIT.md):

| Workstream | Owns | Depends on |
|---|---|---|
| Voice-to-notes (Person 1) | `hum.ts`, `generate.ts`, segmentation/quantization helpers | `HumFrame`, `Note`, `Instrument` |
| Playback (Person 2) | `playback.ts`, transport behavior, mute/solo | `Track[]`, `Note` |
| Track editor (Person 3) | `TrackRow.tsx`, note editing gestures, lane geometry | `Track`, `Note` |
| Integration (Person 4) | `Studio.tsx`, `globals.css`, `midi.ts`, persistence, deploy, docs | All of the above |

For a change that affects shared types or APIs (`music/types.ts`, `tracks.ts`, `generateTrack`), update `TECHNICAL_SPEC.md` and notify teammates before integration. Favor small pull requests/commits that can be tested independently; avoid rewriting another stream's files just to clean up style.

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
- Never present a Sample part or the Demo hum as live microphone output, or DSP generation as a trained AI model.

## 11. PR / handoff template

```text
Summary:
  What user-visible behavior changed?
Files changed:
  List exact paths.
Interfaces affected:
  Note/Project/PitchFrame/Track/HumFrame/generateTrack contracts or none.
Verification:
  Commands and real browser checks actually completed.
Risks/limitations:
  Any known recording, quantization, or environment issues.
Follow-up:
  One concrete next integration step.
```

If blocked, report the smallest reproducible failure and preserve the stable, demo-able behavior rather than introducing risky last-minute architecture changes.
