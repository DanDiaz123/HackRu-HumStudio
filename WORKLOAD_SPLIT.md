# HumStudio — HackRU Team Workload Split

**Team size:** 4 developers  
**Event:** HackRU Fall 2026  
**Working product name:** HumStudio  
**Track:** HackRU **Education Track** — learning basic music theory by singing, visualizing, editing and hearing notes.  
**Status:** Four-person ownership and remaining-work plan as of 2026-10-10. The core app and Learn overlays are implemented on `main`; real-mic, human listening, education walkthrough, deployment and presentation verification remain open.

> **Education Track demo goal:** A beginner hums a melody, sees the actual note name/degree/cents, recognizes the key/chords, edits or quantizes a note, and hears the change. The multitrack arrangement, smplr sounds, and MIDI export support this **learn-by-doing** story. Finish a reliable live demonstration before adding speculative lessons or scores.

## 1. Current starting point and scope

This split reflects the **existing repository**, not a blank project. At the time this plan was prepared:

- The Next.js/React/TypeScript app, plain-CSS styling, and GitHub repository are already initialized.
- `src/components/Studio.tsx`, `TrackRow.tsx`, and `Spectrogram.tsx` implement a multitrack-oriented interface with recording/generation/reveal states.
- `src/lib/hum.ts` contains microphone capture and Pitchy pitch estimation.
- `src/lib/generate.ts` contains deterministic DSP segmentation, quantization, harmony fitting, instrument-role generation, and rhythm-only Drum part mapping; it is not a trained AI backend.
- `src/lib/playback.ts` and `src/lib/midi.ts` contain tested Tone.js playback and multi-track MIDI export implementations.
- `DESIGN.md` defines the existing visual identity. **Improve and use it; do not start branding from scratch.**
- A **Learn** toggle (on by default), note/solfège labels, key and role summary, live pitch/degree/cents, chord names/Roman numerals and bar highlighting are already implemented in `Studio.tsx`, `TrackRow.tsx` and `music/harmony.ts`.
- `src/tests/harmony.test.ts` already covers scale degrees, solfège and Roman numerals. The education UI and physical microphone still need manual validation.
- Presence of source code **does not mean each feature has been tested** on a real microphone or deployed browser, or with learners.

**Product-scope clarification:** The repository now implements the **multitrack, instrument-specific editor** and live spectrogram/reveal sequence. The app produces a generated instrument arrangement inspired by a monophonic hum, using deterministic DSP and harmony rules; it does not claim faithful transcription, machine learning, or a backend. Remaining unchecked work is validation on real hardware, deployment, listening, and presentation.

### 1.1 Education Track definition of success

[HackRU's Education Track](https://www.hackru.org/) focuses on building an educated community. The value proposition is **music-theory concepts made tangible** for someone who can hum but cannot yet identify or enter the notes. The main demo should make these three learner actions visible:

1. **Name it:** Find a sung pitch, scale degree/solfège, and chord/Roman numeral.
2. **Change it:** Alter a note's pitch or Snap setting; predict what happens.
3. **Hear it:** Play the edited part, then isolate another instrument to understand its role.

**Already built:** exploratory theory overlays and music controls. **Not built:** a curriculum, automatic intonation grade, quizzes, saved progress, or teacher dashboard. No one should promise measured learning outcomes. All four people share final education-path testing.

## 2. Assignment summary

| Person | Role | Primary ownership | GitHub |
| --- | --- | --- | --- |
| **1** | **Microphone + voice-to-notes** | Stable pitch detection, segmentation and quantization; verify live educational pitch/cents accuracy | [Issue #2](https://github.com/DanDiaz123/HackRu-Project/issues/2) |
| **2** | **Music playback + transport** | Tone.js/smplr, track instruments and tempo; demonstrate rhythm and arrangement roles by listening | [Issue #3](https://github.com/DanDiaz123/HackRu-Project/issues/3) |
| **3** | **Track editor + Learn overlays** | Editable piano roll, readable pitch/solfège/chord/Roman-numeral labels, bar/pitch feedback | [Issue #4](https://github.com/DanDiaz123/HackRu-Project/issues/4) |
| **4** | **Integration + branding + education story** | Shared state, Learn/key controls, privacy, persistence/MIDI, brand, Education Track pitch, deployment/demo | [Issue #5](https://github.com/DanDiaz123/HackRu-Project/issues/5) |

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
- [x] Split the Drums lane into Kick, Snare, Closed hat, Open hat, and Crash selectors; selected recording/editing uses onset rhythm only while all five lanes remain visible and playable.
- [x] Expose `HumFrame.hz` and timestamps to the existing live pitch display; `harmony.ts` can derive scale degree/solfège from the current key.
- [ ] **Education validation:** Record or sing reference pitches (A4 440 Hz, C4 approximately 261.63 Hz) on the **physical demo microphone** and verify the Learn pitch note, cents sign and "no pitch" state match what is heard; log false notes/octave errors.
- [ ] Select a short, reliable melody with distinct pitches/rests for the judge; confirm what the generated **Melody** preserves versus role-generated Bass/Keys/Strings, and share any interpretation limitations with Person 4.

**Primary files:** `src/lib/hum.ts`, `src/lib/generate.ts`, and any small extracted pure pitch/segmentation/quantization helpers under `src/lib/audio/` or `src/lib/music/`. Coordinate changes to `src/components/Spectrogram.tsx` with Person 3.

**Handoff to Person 4:** The tested `generateTrack(...)` output as canonical `Note[]` plus accurate loading/error status and a short recorded-demo procedure.

**Education definition of done:** A 5–15-second clean hum yields usable note data and a truthful pitch/degree/cents visual that can be explained in plain language; permission denial and empty takes do not erase learning progress. Pitch estimates and inferred harmony must not be labeled as grading, neural AI, or an exact music-theory answer key.

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
- [ ] **Education validation:** Demonstrate Snap Off vs 1/4 or 1/8, optionally with the metronome, and verify the beat-placement difference is actually audible and not just visual.
- [ ] Verify the current bar highlight and sounding chord happen together during playback; coordinate highlight fixes with Person 3 rather than modifying their component without agreement.
- [ ] Balance sampled presets for a beginner demo: one melody plus one accompaniment should remain intelligible, with samples preloaded or working synth fallback.

**Primary files:** `src/lib/playback.ts` and isolated transport/audio controls. Person 4 owns the overall `Studio.tsx` layout; coordinate any transport-hookup changes rather than both editing the same component simultaneously.

**Handoff to Person 4:** Documented functions to initialize, schedule `Track[]`, play/pause, rewind, and report playhead position, with a hardcoded test arrangement.

**Education definition of done:** Repeated Play/Pause/Stop, Snap and mute/solo demonstrate audible changes consistently enough for a learner to infer what a beat, part or chord does. This requires **human listening**, not only a passing unit test.

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
- [x] **Learn UI already present:** note pitch/solfège in zoomed `NoteBars`, `LaneChords` per bar with chord name/Roman numeral, Key and instrument Role summary, and `LivePitch` showing note/degree/cents while recording.
- [ ] **Education QA:** Toggle Learn and verify the note labels, Key/Role summary, chord names and live pitch appear/disappear without altering stored notes or playback. The reveal can still show learning context as part of the explanatory transition.
- [ ] In a chosen Key, verify MIDI C4/E4/G4 correspond to do/mi/sol and that C-major I/V chord numerals and playhead-linked highlighting render correctly. Use `harmony.test.ts` fixtures as reference.
- [ ] Review label legibility, small screens, keyboard focus and high-contrast states for a novice during a judged demonstration; keep `LivePitch` visual-only accessibility limitation documented (it is currently `aria-hidden`).
- [ ] Add short in-context explanations only if needed for the demo; do **not** build an unrelated tutorial system or automatic grading flow.

**Primary files:** `src/components/TrackRow.tsx`, `src/components/EditableNotes.tsx`, `src/lib/note-clipboard.ts`, a new `src/components/PianoRoll.tsx` if helpful, and presentation/geometry helpers. Coordinate spectrogram changes with Person 1. Person 4 owns global CSS/design tokens; request a style change rather than independently restyling all of `globals.css`.

**Handoff to Person 4:** A track editor that accepts the selected track's notes and emits valid immutable note edits to parent state. Agree on callback props before implementing them.

**Education definition of done:** A new music learner can point to a generated pitch and its do/re/mi label, identify a chord function on the timeline, change a note, and connect the edit with the sound. The same piano-roll editing behavior must still work with Learn turned off.

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
- [x] Own the `Learn` transport toggle (default on) and the manual Key selector in `Studio.tsx`; keep Learn as an ephemeral view state, not a saved correctness score.
- [ ] **Education QA:** Check that saving/opening retains real harmony/notes/settings, that Learn remains a presentation toggle, and that a manual Key override changes harmony and dependent parts as documented.
- [ ] Lead a 90-second **Education Track** demonstration and a small novice/teammate walkthrough: can they recognize one note/degree, one chord, and the result of an edit? Record qualitative feedback without asserting learning gains.

### Branding and visual presentation — same owner, after core loop

- [x] Use **`DESIGN.md` as the visual reference** (palette, Archivo typography, squared-off controls, instrument colors).
- [x] Establish the HumStudio name/tagline, wordmark, favicon, and page metadata.
- [x] Maintain consistent buttons, controls, error/loading/recording states and accessible contrast.
- [x] Polish the studio shell, responsive desktop layout, recording call-to-action, and empty/onboarding states.
- [x] Keep the live spectrogram and note-reveal animation legible, honest, and respectful of reduced-motion settings.
- [ ] Capture final screenshots and Devpost copy that **lead with beginner music education** rather than merely "AI music generation." Show Learn labels clearly and rehearse a **90-second judge demo** with a real recording moment.
- [ ] Add a one-sentence plain-language explanation for **key**, **scale degree**, **cents**, and **Snap** to the presenter notes or UI if time allows; do not label future tooltips as implemented before they exist.
- [ ] Confirm the team distinguishes live mic audio from **Demo hum** and inferred chords from music-theory ground truth during judging.
- [x] Coordinate piano-roll styling through the existing design tokens.

**Primary files:** `src/components/Studio.tsx`, `src/app/`, `src/app/globals.css`, `src/lib/midi.ts`, persistence/state modules, `public/` branding assets, and product/demo docs. **Do not rebuild the app scaffold or overwrite teammates' components.**

**Handoff to everyone:** A working hosted integration environment, clear contracts, a list of outstanding blockers, and a demo script.

**Education definition of done:** A browser user can record, identify note/chord/rhythm concepts in Learn mode, edit-and-listen, save/reopen, and export without crashes. The Education Track pitch is supported by what actually works; branding is cohesive and the deployed demo clearly labels **Demo hum**, inferred harmony, and generated roles.

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
- **Design ownership:** Person 4 owns product branding and global design tokens; Person 3 owns the usability and implementation of piano-roll note interactions **and Learn visual overlays**. Person 1 verifies pitch-signal accuracy while Person 2 verifies playback-linked harmonic/rhythmic feedback.
- **Theory logic boundary:** `src/lib/music/harmony.ts` is shared. Person 1 owns pitch/key inference correctness; Person 3 consumes its public `solfege`, `scaleDegree`, `romanNumeral` and `keyName` functions for learning UI; Person 4 coordinates state changes from Key/Snap and the educational story.
- **No grading data:** Neither the UI toggle nor signed cents is a saved student score. Do not add user accounts, learning-progress databases, or unreviewed audio uploads.

The current contracts already define track identity, note-edit callbacks, v2 save format, and **deterministic instrument-role arrangement**. Do not silently change them or re-label the generator as neural AI or exact transcription. Any proposed guided-learning feature needs a separate scope decision and a new testable acceptance criterion.

## 8. Integration timeline (relative, not fixed clock times)

| Checkpoint | What must be demonstrable | Who |
| --- | --- | --- |
| **Kickoff — first 30 min** | Assign GitHub issues, review current app, agree on product scope and shared APIs; pick one demo melody | Everyone; Person 4 coordinates |
| **First independent checkpoint** | Real hum → note data; two-track Tone playback; notes visible/editor prototype; hosted app builds | Persons 1 / 2 / 3 / 4 respectively |
| **Midpoint integration** | Person 1's `Note[]` appears in Person 3's editor and plays through Person 2's audio with Person 4's state | Everyone |
| **Feature-complete checkpoint** | Edit a generated note; export MIDI; project survives reload; handle failed mic | Everyone; Person 4 leads |
| **Education-path QA** | Learn note/degree/cents from a real hum, chord/Roman-numeral highlight, one edited note and audible comparison; report an understandable learner takeaway | P1 signal / P2 audio / P3 UI / P4 story |
| **Final hours — feature freeze** | Test on actual demo laptop/Chrome, deployed HTTPS, real mic, mute/solo, reload, fallback, **Education Track 90-second pitch** | Everyone |

Make **small PRs as soon as a vertical slice works**, instead of waiting for all four full features to finish. Prefer an end-to-end working demo over adding nonessential options.

### 90-second Education Track demo handoff (Person 4 narrates)

| Time | Show | Learning point |
| --- | --- | --- |
| 0–15 s | The DAW-style screen and the problem: hearing a tune but not knowing its note names | Music should be learnable by ear, without a keyboard |
| 15–35 s | Melody → Learn on → Record a clear hum (or truthfully labeled Demo hum) → live pitch, degree and cents | Your voice has identifiable pitches, not just a recording waveform |
| 35–55 s | Animated notes, solfège labels, selected/inferred key, chord names and Roman numerals | The melodic phrase relates to a scale and harmony; guesses can be corrected |
| 55–75 s | Change one note or Snap; Play and mute/solo an accompaniment | Pitch, beat placement and instrument roles change what you hear |
| 75–90 s | Full tracks, MIDI export, verbal takeaway | A beginner can see, experiment with and reuse musical structure |

**Judge-facing phrasing:** "HumStudio is an interactive music-theory sketchpad: hum to see your notes, identify a scale degree or chord, adjust them and instantly hear the difference." Do not claim it has student quiz scores, teacher adoption, validated learning gains, or generative AI.

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
- [x] Learn toggles and derived note/solfège, Key/Role, chord/Roman-numeral and live-pitch UI are implemented; `harmony.test.ts` tests theoretical labels.
- [ ] **Manual Learn QA:** identify at least one pitch/degree with the real mic, then show a matching labeled note and chord; verify cents and no-pitch state without presenting them as grades.
- [ ] **Education demo QA:** change a note or Snap setting, hear the result, isolate an instrument role, and ask one beginner to describe what they learned without coaching.
- [x] Mic denial, silence, refresh, and invalid input preserve good state in code/browser regression coverage.
- [ ] Deployment and 90-second live demo are tested on the judging laptop.

### Cut order if the team falls behind

1. **Keep at all costs:** working hum → notes → **Learn note/chord labels** → visible track → audible playback, plus an honest, reliable Education Track explanation.
2. **Next:** one audible edit/Snap comparison, MIDI export, stable tempo/mute/solo.
3. **Then:** project persistence, count-in/metronome, instrument refinements.
4. **Cut first:** new authentication/Supabase backend, elaborate animations, neural model experiments, additional effects, multiplayer, mobile-specific polish.

---

**Related project files:** [PRODUCT.md](PRODUCT.md) · [DESIGN.md](DESIGN.md) · [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) · [AGENTS.md](AGENTS.md) · [README.md](README.md).
