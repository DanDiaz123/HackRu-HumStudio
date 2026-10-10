# HumStudio — HackRU Team Workload Split

**Team size:** 4 developers  
**Event:** HackRU Fall 2026  
**Working product name:** HumStudio  
**Status:** Current ownership and remaining-work plan as of 2026-10-10. Core implementation is merged on `main`; unchecked items are real-device, listening, deployment, or presentation follow-up.

> **The demo goal:** Pick an instrument track, hum a short melody, see the live spectrogram, reveal editable notes, play the arrangement, and export MIDI. Finish a reliable end-to-end demo before adding extra features.

## 1. Current starting point and scope

This split reflects the **existing repository**, not a blank project. At the time this plan was prepared:

- The Next.js/React/TypeScript app, plain-CSS styling, and GitHub repository are already initialized.
- `src/components/Studio.tsx`, `TrackRow.tsx`, and `Spectrogram.tsx` implement a multitrack-oriented interface with recording/generation/reveal states.
- `src/lib/hum.ts` contains microphone capture and Pitchy pitch estimation.
- `src/lib/generate.ts` contains deterministic DSP segmentation, quantization, harmony fitting, and instrument-role generation; it is not a trained AI backend.
- `src/lib/playback.ts` and `src/lib/midi.ts` contain tested Tone.js playback and multi-track MIDI export implementations.
- `DESIGN.md` defines the existing visual identity. **Improve and use it; do not start branding from scratch.**
- Presence of source code **does not mean each feature has been tested** on a real microphone or deployed browser.

**Product-scope clarification:** The repository now implements the **multitrack, instrument-specific editor** and live spectrogram/reveal sequence. The app produces a generated instrument arrangement inspired by a monophonic hum, using deterministic DSP and harmony rules; it does not claim faithful transcription, machine learning, or a backend. Remaining unchecked work is validation on real hardware, deployment, listening, and presentation.

## 2. Assignment summary

| Person | Role | Primary ownership | GitHub |
| --- | --- | --- | --- |
| **1** | **Microphone + voice-to-notes** | Pitch detection, note segmentation, quantization, generating the selected track's notes | [Issue #2](https://github.com/DanDiaz123/HackRu-Project/issues/2) |
| **2** | **Music playback + transport** | Tone.js, track instruments, tempo, play/pause/rewind, mute/solo, timing | [Issue #3](https://github.com/DanDiaz123/HackRu-Project/issues/3) |
| **3** | **Track editor + piano roll** | Track-note display, drag/edit/resize notes, note grid, playhead/editor interactions | [Issue #4](https://github.com/DanDiaz123/HackRu-Project/issues/4) |
| **4** | **Integration + branding + persistence** | App shell, brand polish, shared state, recording flow coordination, saving/loading, MIDI export, deployment/demo | [Issue #5](https://github.com/DanDiaz123/HackRu-Project/issues/5) |

**Ownership is about avoiding merge conflicts, not forbidding help.** Anyone can help debug and test another workstream. Agree on shared interfaces before changing files owned by another person.

## 3. Person 1 — Voice recognition and track generation

**Owner:** ____________________  
**Branch suggestion:** `feature/voice-to-notes`  
**Issue:** [#2 — Hum-to-MIDI transcription](https://github.com/DanDiaz123/HackRu-Project/issues/2)

### What to work on

- [ ] Test `startMic()` with a **real microphone** in Chrome/Edge, including permission denial, silence, and stopping early.
- [x] Stabilize the initial Pitchy path: RMS/clarity/frequency gates, sliding-window analysis, pitch smoothing, and resource cleanup are implemented; real-device tuning remains open.
- [x] Convert continuous `HumFrame[]` readings into discrete note onsets/offsets with jitter suppression, rests, and dropout handling.
- [x] Convert start/end seconds into **quarter-note beats** using capture BPM; apply Off, 1/4, 1/8, and 1/16 snapping correctly.
- [x] Implement deterministic `generateTrack(...)` generation with Low/Medium/High cached sensitivity profiles and harmony/instrument fitting.
- [x] Return notes appropriate for the selected instrument's range; drum/RMS mapping remains documented as a separate limitation.
- [x] Ensure empty/failed recordings leave existing notes untouched.
- [x] Add deterministic voiced/unvoiced, wobble, dropout, sensitivity, and generation fixtures; live pitch-to-note verification remains open.

**Primary files:** `src/lib/hum.ts`, `src/lib/generate.ts`, and any small extracted pure pitch/segmentation/quantization helpers under `src/lib/audio/` or `src/lib/music/`. Coordinate changes to `src/components/Spectrogram.tsx` with Person 3.

**Handoff to Person 4:** The tested `generateTrack(...)` output as canonical `Note[]` plus accurate loading/error status and a short recorded-demo procedure.

**Definition of done:** A 5–15-second clean hum creates recognizably correct note pitches and approximate timing on the selected track; no microphone leaks or disappearing existing notes. This is a **DSP prototype**, not automatically a neural AI system.

## 4. Person 2 — Tone.js audio engine and playback

**Owner:** ____________________  
**Branch suggestion:** `feature/playback-transport`  
**Issue:** [#3 — Tone.js playback](https://github.com/DanDiaz123/HackRu-Project/issues/3)

### What to work on

- [x] Verify scheduling logic for all five instrument tracks with correct pitch, duration, volume, and timing in deterministic regression tests; audible sign-off remains open.
- [x] Make BPM changes preserve beat-aligned scheduling, not shift where notes sit on the musical grid.
- [x] Implement Play, Pause, Stop, Rewind, and current playhead position with transport state matching the scheduled engine; audible sign-off remains open.
- [x] Check mute and solo combinations, including editing notes while playback is stopped or running (deterministic regression tests; listening pending).
- [x] Prevent duplicate Tone Transport callbacks or stuck voices when rescheduling/replaying; release/dispose synth resources cleanly (regression tests; listening pending).
- [x] Ensure browser audio starts only following a real user gesture; do not initialize Tone audio during server rendering.
- [x] Add metronome and count-in **only after** basic playback is reliable (core checks passed before implementation; count-in precedes playback).
- [ ] Listen to generated melody alongside sample drums/keys on the demo laptop to prove simultaneous audible multitrack playback.

**Primary files:** `src/lib/playback.ts` and isolated transport/audio controls. Person 4 owns the overall `Studio.tsx` layout; coordinate any transport-hookup changes rather than both editing the same component simultaneously.

**Handoff to Person 4:** Documented functions to initialize, schedule `Track[]`, play/pause, rewind, and report playhead position, with a hardcoded test arrangement.

**Definition of done:** Repeated play/stop/rewind and track changes work audibly, stay synchronized with note positions, and do not build up overlapping scheduled events.

### Person 2 implementation handoff

**Implementation delivered; real-browser listening sign-off remains open.** The
engine now schedules melodic attacks and releases in beats, supports all five
instruments, separates Pause from Stop, preserves running state on Rewind,
handles live note/mute/solo/tempo changes, and cleans up queued synths and owned
transport callbacks. The metronome and cancellable four-beat playback count-in
are optional. No `Note`, `Track`, or `Project` fields changed.

**Files changed:**

- `src/lib/playback.ts`
- `src/lib/audio/playback-engine.ts`
- `src/lib/audio/tone-backend.ts`
- `src/lib/audio/click-track.ts`
- `src/components/Studio.tsx` (transport hookup, defaults, error handling, teardown only)
- `src/components/icons.tsx` (Pause icon)
- `src/tests/playback.test.ts`
- `src/tests/fixtures/playback.ts`
- `package.json` (test script runs `node --test` on `.ts` directly; no dependency changes)
- `TECHNICAL_SPEC.md`, `README.md`, and `WORKLOAD_SPLIT.md`

**Public integration:** Call `await ensureAudio()` from a Play click, then
`schedule(currentTracks, bpm)` and `play()`. Re-run `schedule` after immutable
track edits or BPM changes. Use `pause()` to retain the beat, `stop()` to reset,
`rewind()` to return to zero, `positionBeats()` for the playhead, and `state()` for
the actual transport status. Optional `setMetronome(true)` enables beat clicks;
`await countIn(bpm, remaining => ...)` returns true on completion or false when
cancelled. Always call `dispose()` during studio teardown. These functions are
documented in technical-spec section 9.

**Fixture:** `playbackFixtureTracks()` provides a deterministic melody, bass,
keys, strings, and drum arrangement. Tests inject an audio backend to check
timing/lifecycle without browser audio. The existing UI's labeled Demo hum can
also be generated into Melody while the sample Keys/Drums remain present.

**Verification on 2026-10-10:** Dependency installation, lint, TypeScript, and
production build were run successfully. The regression suite covers simultaneous
five-track scheduling, BPM/onset/release alignment, repeated scheduling,
pause/resume, stop/rewind, mute/solo, live note changes, same-pitch overlaps,
loop boundaries, invalid/oversized input, teardown, metronome/count-in timing,
and count-in cancellation/failure. A local HTTP check returned 200 and confirmed
Play/Stop/count-in controls render. Remote browser testing returned
`ERR_CONNECTION_REFUSED`; local Computer Use stopped because it could not
determine the browser URL reliably. Neither attempt verified audible output.

**Security review:** The playback path has no server endpoint, authentication,
file upload, network audio, or logging of microphone/project data. BPM is validated
before replacing a schedule; note/track validation belongs at JSON import, the
only untrusted input. Full
`npm audit` reported five existing high-severity development-tool findings in
the ESLint/fast-glob/micromatch/braces chain. `npm audit --omit=dev` reported zero
production findings. No force update/downgrade was applied.

**Known limits:** The eight-bar loop clips notes at beat 32. Drum hits use fixed
percussive envelopes. Live schedule changes silence/recreate voices and can
briefly re-attack held notes. Count-in is wired to playback; Persons 1/4 must
coordinate recording count-in so permission prompts and clicks are excluded
from recorded time. Full project persistence/editor work is outside Person 2.

**Next integration step — listening sign-off on the demo laptop:**

1. Run `npm run dev` and open localhost in desktop Chrome/Edge with headphones.
2. Play the sample Keys/Drums, pause mid-note, wait, resume, then Stop. Verify
   silence while paused, a stationary paused playhead, and reset to `1.1.1` on Stop.
3. Rewind while running, replay repeatedly, and change BPM between 60, 120, and
   180. Verify the grid position and sound remain aligned without duplicated hits.
4. Test mute, one solo, multiple solos, and a muted solo; mute must take precedence.
5. Generate the labeled Demo hum into Melody (and Bass/Strings for all five),
   then listen alongside sample Keys/Drums. Verify pitch, balance, duration, and
   loop transition. Exercise Person 3's note-edit callback while paused/running.
6. Enable M for metronome; check downbeat accents. Enable 4; confirm four clicks
   before playback and Stop cancels counting. Navigate away and verify silence.

The remaining unchecked Person 2 items above require this listening check;
automated scheduling tests do not establish audible quality.

## 5. Person 3 — Multitrack editor and editable piano roll

**Owner:** ____________________  
**Branch suggestion:** `feature/piano-roll-editor`  
**Issue:** [#4 — Editable piano-roll UI](https://github.com/DanDiaz123/HackRu-Project/issues/4)

### What to work on

- [x] Use the existing `TrackRow.tsx` layout while preserving track opening/zooming and note/spectrogram visuals.
- [x] Make notes in a zoomed track editable with immutable parent updates.
- [x] Implement pitch/time dragging with selected-grid snapping and collision-aware nearest-free placement.
- [x] Implement resizing from either edge with neighbor/timeline bounds.
- [x] Support selection, deletion, click-to-add, Clear, Repeat, and keyboard nudging.
- [x] Clamp notes to valid ranges (MIDI 0–127, beat ≥ 0, duration > 0); use stable note IDs.
- [x] Keep the piano roll aligned with the beat ruler, track clips, instrument range, and playhead.
- [x] Preserve instrument-specific lanes, including drum rows where appropriate.
- [x] Keep editing logic separate in `src/lib/note-edit.ts` from audio scheduling and microphone capture.

**Primary files:** `src/components/TrackRow.tsx`, a new `src/components/PianoRoll.tsx` if helpful, and presentation/geometry helpers. Coordinate spectrogram changes with Person 1. Person 4 owns global CSS/design tokens; request a style change rather than independently restyling all of `globals.css`.

**Handoff to Person 4:** A track editor that accepts the selected track's notes and emits valid immutable note edits to parent state. Agree on callback props before implementing them.

**Definition of done:** A judge can visually identify the generated notes, correct a wrong pitch, move a note in time, resize it, and hear the updated arrangement play.

## 6. Person 4 — Integration, branding, persistence, and demo

**Owner:** ____________________  
**Branch suggestion:** `feature/app-integration-branding`  
**Issue:** [#5 — App integration, branding, persistence, MIDI export](https://github.com/DanDiaz123/HackRu-Project/issues/5)

### Application and integration — first priority

- [x] Keep the current Next.js app operational and own the **shared project/track state** in `Studio.tsx`.
- [x] Coordinate generation, editing callbacks, and playback scheduling around the same current `Track[]`.
- [x] Implement local save/restore of **all tracks**, BPM, quantization, sensitivity, harmony, mute/solo flags, and note edits; validate imported JSON before replacing state.
- [x] Implement and test multi-track MIDI export with `@tonejs/midi`; checking it in an external music editor remains open.
- [x] Make recording failures, stale asynchronous callbacks, and reloads safe; never replace good notes on an empty/failed take.
- [ ] Own deployment of a real HTTPS demo and verify microphone behavior there.
- [x] Reconcile the old single-track documentation with the newer `PRODUCT.md` and the actual `Track[]` data model (README, SDD, TECHNICAL_SPEC, AGENTS updated 2026-10-10).
- [x] Agree on and implement the versioned multitrack save format (`ProjectV2`, strict validation, v1 migration).

### Branding and visual presentation — same owner, after core loop

- [x] Use **`DESIGN.md` as the visual reference** (palette, Archivo typography, squared-off controls, instrument colors).
- [x] Establish the HumStudio name/tagline, wordmark, favicon, and page metadata.
- [x] Maintain consistent buttons, controls, error/loading/recording states and accessible contrast.
- [x] Polish the studio shell, responsive desktop layout, recording call-to-action, and empty/onboarding states.
- [x] Keep the live spectrogram and note-reveal animation legible, honest, and respectful of reduced-motion settings.
- [ ] Capture final screenshots, write short Devpost presentation copy, and rehearse a **90-second judge demo** with a real recording moment.
- [x] Coordinate piano-roll styling through the existing design tokens.

**Primary files:** `src/components/Studio.tsx`, `src/app/`, `src/app/globals.css`, `src/lib/midi.ts`, persistence/state modules, `public/` branding assets, and product/demo docs. **Do not rebuild the app scaffold or overwrite teammates' components.**

**Handoff to everyone:** A working hosted integration environment, clear contracts, a list of outstanding blockers, and a demo script.

**Definition of done:** A browser user can record, edit, play, save/reopen, and export without crashes; branding is cohesive and the deployed demo clearly distinguishes real input from the built-in **Demo hum** fallback.

**Capacity warning:** This is the broadest role. Person 4 should establish state/contracts/deployment early, then prioritize saving, integration, and demo reliability before optional marketing polish. Everyone shares final integration testing.

## 7. Shared data contracts and file boundaries

**Canonical note shape** (from `src/lib/music/types.ts`):

```ts
export interface Note {
  id: string;
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}
```

- **Beats, not seconds:** `startBeat` and `durationBeats` are quarter-note beats. Mic frames may use seconds, but notes in shared state do not.
- **Track data:** Current app uses `Track[]` from `src/lib/tracks.ts`, each containing an instrument and `Note[]`. Do not accidentally flatten all instrument tracks when saving or playing.
- **Note owner:** Person 1 creates notes, Person 3 edits notes, Person 2 plays notes, Person 4 owns the canonical state and persists/exports notes.
- **Shared files:** `Studio.tsx` and `globals.css` belong to Person 4 for merge coordination; `TrackRow.tsx` belongs to Person 3; `generate.ts`/`hum.ts` to Person 1; `playback.ts` to Person 2. `tracks.ts` and `music/types.ts` are shared contracts, so change them only after notifying everyone.
- **Design ownership:** Person 4 owns product branding and global design tokens; Person 3 owns the usability and implementation of piano-roll note interactions.

Before writing glue code, agree on (1) the selected track ID, (2) the note-edit callback shape, (3) the save format for multitrack state, and (4) the meaning of "Generate": faithful transcription or arrangement transformation. Do not silently change existing contracts.

## 8. Integration timeline (relative, not fixed clock times)

| Checkpoint | What must be demonstrable | Who |
| --- | --- | --- |
| **Kickoff — first 30 min** | Assign GitHub issues, review current app, agree on product scope and shared APIs; pick one demo melody | Everyone; Person 4 coordinates |
| **First independent checkpoint** | Real hum → note data; two-track Tone playback; notes visible/editor prototype; hosted app builds | Persons 1 / 2 / 3 / 4 respectively |
| **Midpoint integration** | Person 1's `Note[]` appears in Person 3's editor and plays through Person 2's audio with Person 4's state | Everyone |
| **Feature-complete checkpoint** | Edit a generated note; export MIDI; project survives reload; handle failed mic | Everyone; Person 4 leads |
| **Final hours — feature freeze** | Test on actual demo laptop/Chrome, deployed HTTPS, real mic, mute/solo, reload, fallback, 90-second presentation | Everyone |

Make **small PRs as soon as a vertical slice works**, instead of waiting for all four full features to finish. Prefer an end-to-end working demo over adding nonessential options.

## 9. Pull-request and AI-agent rules

1. Branch from current `main`; one feature branch per owner and small PRs for independent changes.
2. Read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, and relevant sections of `TECHNICAL_SPEC.md` before assigning an agent a task.
3. Give Codex a **single scoped file/module task** and tell it which files belong to other teammates. Don't allow separate agents to refactor the same central component at once.
4. Before merging, each author documents changed files, what was manually tested, lint/type/build results, and known gaps. A code file existing is not proof that browser audio works.
5. Never commit secrets, expose microphone audio to a server, or claim AI inference exists without real integration. Validate imported projects and keep voice audio local.
6. Integration-owner review is recommended for changes to types/state; relevant feature-owner review is recommended for changes inside another person's files.
7. If a teammate is blocked, post the blocker in their linked issue early. Have another teammate help; don't wait until demo day ends.

## 10. Shared minimum acceptance test

- [x] On local Chrome/Edge, the user can open the studio and choose a track.
- [ ] Live mic permission and start/stop work with a real device; synthetic browser coverage passes.
- [x] Live spectrogram, processing state, note reveal, and Demo hum fallback are clearly labeled.
- [x] Generated notes are covered by deterministic pitch/beat regression fixtures without dozens of noise artifacts.
- [x] At least one note can be edited; browser regression covers edits and state preservation.
- [x] At least two tracks schedule together with mute/solo and no duplicated notes in deterministic transport tests.
- [x] A user can export valid MIDI and save/reopen the complete multitrack project.
- [x] Mic denial, silence, refresh, and invalid input preserve good state in code/browser regression coverage.
- [ ] Deployment and 90-second live demo are tested on the judging laptop.

### Cut order if the team falls behind

1. **Keep at all costs:** working hum → notes → visible track → audible playback and an honest, reliable demo.
2. **Next:** one editable note interaction, MIDI export, stable tempo/mute/solo.
3. **Then:** project persistence, count-in/metronome, instrument refinements.
4. **Cut first:** new authentication/Supabase backend, elaborate animations, neural model experiments, additional effects, multiplayer, mobile-specific polish.

---

**Related project files:** [PRODUCT.md](PRODUCT.md) · [DESIGN.md](DESIGN.md) · [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) · [AGENTS.md](AGENTS.md) · [README.md](README.md).
