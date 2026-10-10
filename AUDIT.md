# HumStudio merge audit — 2026-10-10

Integrated local sensitivity restoration `f703e85` with upstream main `f0b041b`, then the concurrently published `f6da9c4` project/editing features. Preserved responsive controls, lane labels, and manual-key behavior. Three subagents reviewed transcription, UI/state, playback/MIDI, and the new project/editing boundaries; the integration review covered cleanup, shared contracts, security, dependencies, and browser behavior.

## Fixes

- Generate all three sensitivity profiles per take and swap them immediately. Keep tuning in `note-sensitivity.ts`.
- Rebuild Snap using each take's capture BPM; Off restores original timing. Preserve manual key selections, hand edits, and deliberate chord overlaps.
- Compute settings outside React state updaters; synchronize async arrangement snapshots and cancel recording/reveal work after unmount.
- Preserve confirmed Melody pitches at every sensitivity; correct reveal wording accordingly.
- Expire old level dips before re-attack detection. After a bridged dropout, wait through the existing 100 ms dip window so microphone analysis recovery cannot split a held note.
- Reject malformed generation options and invalid drum analysis; clip drum tails at the timeline boundary.
- Release microphone tracks, worklet ports, and graph nodes on all setup failures and Stop. Cleanup is idempotent and does not close the shared playback context.
- Reject stale playback/metronome callbacks and prevent disposed engines from restarting audio. Validate count-in BPM before interrupting working playback.
- Validate MIDI encoding, assign distinct melodic channels, preserve positive tick durations, and release download URLs even on browser failures.
- Require approved HTTPS sample hosts, standard ports, no credentials, and no redirects.
- Give Snap an explicit accessible name; fit Re-record in the compact sidebar; report retained notes accurately after failed takes.
- Preserve upstream save/open, autosave, editing rules, shortcuts, and part actions. Undo/redo restores settings, capture tempo, cached profiles, original Snap sources, key decisions, and metadata together.
- Reject unexpected project fields, wrong types, coercible sound IDs, duplicate IDs, and notes past the timeline. Saved snapshots do not share mutable note/harmony arrays.
- Bound editing searches and validate controls/IDs; refuse edits that would cross neighbors or the timeline when the Snap grid grows.

## Changed files

| Area | Paths |
|---|---|
| UI/state | `src/components/Studio.tsx`, `src/components/TrackRow.tsx`, `src/components/icons.tsx`, `src/app/globals.css`, `src/lib/music/arrangement-settings.ts`, `src/lib/note-edit.ts` |
| Transcription/capture | `src/lib/generate.ts`, `src/lib/audio/segment-notes.ts`, `src/lib/audio/note-sensitivity.ts`, `src/lib/hum.ts`, `public/hum-worklet.js` |
| Playback/export/files | `src/lib/audio/playback-engine.ts`, `src/lib/audio/smplr-backend.ts`, `src/lib/midi.ts`, `src/lib/download.ts`, `src/lib/persistence/project.ts` |
| Regressions | `src/tests/arrangement-settings.test.ts`, `src/tests/generation.test.ts`, `src/tests/hum.test.ts`, `src/tests/midi.test.ts`, `src/tests/note-edit.test.ts`, `src/tests/persistence.test.ts`, `src/tests/playback.test.ts`, `src/tests/presets.test.ts`, `src/tests/segmentation.test.ts`, `src/tests/sensitivity.test.ts` |
| Documentation | `AGENTS.md`, `DESIGN.md`, `PRODUCT.md`, `README.md`, `SOFTWARE_DESIGN_DOCUMENT.md`, `TECHNICAL_SPEC.md`, `AUDIT.md` |

The Note/Track/HumFrame field contracts remain unchanged. `generateNotes` supports both integration branches' optional argument orders. Added pure `createMidiBytes(tracks, bpm)`; `exportMidi` retains its public interface. Settings caches contain runtime analysis features, never microphone samples, and are not uploaded or persisted.

## Verification actually completed

- `npm.cmd test`: **168 passed, zero failures**.
- `npm.cmd run lint`, `npx.cmd tsc --noEmit`, `npm.cmd run build`: passed.
- Local headless Edge: Demo hum/reveal, Low/Medium/High swaps, busy-state controls, capture-tempo Snap/Off, persistent key choice, edited-note preservation, empty re-record recovery, and MIDI download header passed without page errors.
- Menu labels remained visible with no horizontal overflow at 1920, 1280, 860, 480, 390, and 320 px. Screenshots confirmed the compact Re-record label fits.
- Synthetic microphone WAV through Edge → worklet → Pitchy → generation: held G4 with 100 ms semitone wobbles and 120 ms dropouts remained one note. Stop ended the acquired media track; reload during a second recording returned to a usable studio without page errors.
- Final browser integration also verified settings/edit undo/redo, project Save/Open, rejection of unexpected file fields without changing notes, autosave restoration, and the additional project controls at 320..1920 px.
- Source review found no unsafe code evaluation, HTML injection sinks, tracked credentials, microphone uploads, or sensitive logging in reviewed paths. The app has no authentication or server API. The new local project-file input validates before applying; analysis features and audio are excluded from files/autosave.
- `npm.cmd audit --omit=dev --json`: zero known production dependency vulnerabilities.

## Remaining limitations

The full dependency audit reports five high-severity entries in the development linting chain, all rooted in `braces@3.0.3` ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). The advisory currently lists no patched version. The suggested major downgrade of `eslint-config-next` would mismatch Next 16 and was not applied. The app does not expose untrusted glob patterns to this tooling; production dependencies are unaffected by this audit finding.

Synthetic browser tests do not prove physical-microphone accuracy or human listening quality. Repeated pitches separated only by brief near-silence can still merge; re-attacks within the 100 ms dropout recovery window are intentionally suppressed. Next integration step: tune the three profiles with real humming on the demo microphone and listen to playback/export in a MIDI player.

Temporary browser tools, synthetic audio, and screenshots stay in ignored test/build directories; project dependencies and the lockfile were not changed.
