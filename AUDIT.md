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

- `npm.cmd test`: **170 passed, zero failures**.
- `npm.cmd run lint`, `npx.cmd tsc --noEmit`, `npm.cmd run build`: passed.
- Local headless Edge: Demo hum/reveal, Low/Medium/High swaps, busy-state controls, capture-tempo Snap/Off, persistent key choice, edited-note preservation, empty re-record recovery, and MIDI download header passed without page errors.
- Menu labels remained visible with no horizontal overflow at 1920, 1280, 860, 480, 390, and 320 px. Screenshots confirmed the compact Re-record label fits.
- Synthetic microphone WAV through Edge → worklet → Pitchy → generation: held G4 with 100 ms semitone wobbles and 120 ms dropouts remained one note. Stop ended the acquired media track; reload during a second recording returned to a usable studio without page errors.
- Final browser integration also verified settings/edit undo/redo, project Save/Open, rejection of unexpected file fields without changing notes, autosave restoration, and the additional project controls at 320..1920 px.
- The Drums tab browser check verified five selectable rhythm parts, lane filtering for Kick/Snare, and no page errors or desktop overflow.
- Source review found no unsafe code evaluation, HTML injection sinks, tracked credentials, microphone uploads, or sensitive logging in reviewed paths. The app has no authentication or server API. The new local project-file input validates before applying; analysis features and audio are excluded from files/autosave.
- `npm.cmd audit --omit=dev --json`: zero known production dependency vulnerabilities.

## Remaining limitations

The full dependency audit reports five high-severity entries in the development linting chain, all rooted in `braces@3.0.3` ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). The advisory currently lists no patched version. The suggested major downgrade of `eslint-config-next` would mismatch Next 16 and was not applied. The app does not expose untrusted glob patterns to this tooling; production dependencies are unaffected by this audit finding.

Synthetic browser tests do not prove physical-microphone accuracy or human listening quality. Repeated pitches separated only by brief near-silence can still merge; re-attacks within the 100 ms dropout recovery window are intentionally suppressed. Next integration step: tune the three profiles with real humming on the demo microphone and listen to playback/export in a MIDI player.

Temporary browser tools, synthetic audio, and screenshots stay in ignored test/build directories; project dependencies and the lockfile were not changed.

## Startup loading and codebase cleanup audit - 2026-10-11

### Changes

- Automatically preload the selected sound for all five instruments after project restoration, including empty/muted tracks. Open and Undo/Redo preload changed choices. Unused catalog presets remain on demand.
- Separate browser initialization from gesture-driven audio resume in `src/lib/audio/audio-lifecycle.ts` and `src/lib/playback.ts`. Startup/Play share one engine; pending initialization/resume cannot revive a disposed studio. A failed resume can retry without discarding loaded samples.
- Keep runtime loading status across project restoration when the sound stays unchanged. Startup does not resume audio, start transport, alter notes, block editing, or change history/persistence contracts.
- Fix duplicate sample disposal after load cancellation and after a retired voice lease outlives manager disposal. Regressions assert exactly one disposal per resource.
- Normalize smplr's deprecated bare progress callback to the supported options form.
- Share deterministic sample fixtures across browser suites; cover every instrument family instead of relying on upstream downloads or intentionally failing whole families.
- Correct stale documentation about startup loading, implemented persistence, and note-only regeneration storage.

### Scope and source review

Reviewed startup/gesture concurrency, engine scheduling/count-in, sample loads/switches/leases, microphone/worklet cleanup, project validation/serialization, note editing/copying, generation/settings snapshots, MIDI/download boundaries, browser-only access, and repository configuration. Searched application/public sources for unsafe evaluation, HTML injection sinks, sensitive logging, credentials and network/storage operations. No unsafe evaluation, HTML injection sink, tracked credential, microphone upload, new server/auth boundary, or new network host was found in these paths. The existing strict project validation and note limits remain in place. This review is not a penetration test or proof that every possible defect is absent.

### Verification completed

- `npm run lint`: passed, no warnings.
- `npx tsc --noEmit`: passed.
- `npm test`: 213 passed, no failures/skips; includes startup/gesture deduplication, cancellation/retry, SSR guards, all-track preparation and exactly-once resource disposal.
- `npm run build`: passed.
- `startup-sounds.mjs`: Edge checks passed at 1280/390/320 px. All five selected sounds downloaded before user input; the app made no audio resume calls and did not start playback. Play reused preloaded assets. Restored empty/muted choices, failed Bass with independent ready tracks, Retry, Open, Undo/Redo and autosave reload passed.
- `studio-interactions.mjs` and `per-track-copy.mjs`: passed against the production app in Edge at 1280/390/320 px with no unexpected console/page errors. Capture/count-in/reveal, drum editing, note gestures, clipboard groups, persistence/history, independent settings, sound switches/fallback, transport controls, MIDI export and layout checks remained intact. The 320 px startup editor screenshot was visually inspected.
- Production dependency audit: zero findings. Full dependency audit: five existing high-severity development findings, all rooted in `braces`; npm's proposed downgrade would mismatch Next 16. The published [advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) still lists no patched version.

### Remaining concerns

- Installed smplr 1.1.0's ElectricPiano fetches its fixed SFZ manifest through its internal `fetchOk`, bypassing the application's storage callback and its redirect/timeout policy. Confirmed in the installed package source map (`../src/electric-piano.ts`). All preset IDs and initial SFZ URLs are fixed; project input cannot supply URLs, and sample-buffer requests still use the restricted callback. The manager's 20-second fallback prevents a stalled manifest from blocking the UI, but does not abort that internal fetch. A supported upstream storage/abort hook is needed to enforce the same network policy for these manifests; no global fetch override or dependency fork was introduced.
- No physical microphone, human listening, other-browser or current upstream availability verification was performed. Synthetic decoding/interaction tests do not establish instrument timbre or live transcription accuracy.
- Startup now downloads five selected sounds instead of only audible tracks. It may use more initial bandwidth/memory; it never downloads the entire 20-preset catalog.

Dependencies/lockfile are unchanged. New browser fixtures/results and screenshots use ignored `.test-build/`; only source, regressions and documentation belong in the change.
