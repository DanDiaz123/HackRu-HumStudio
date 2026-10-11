# smplr instrument presets handoff

Implemented on `feature/smplr-instrument-presets`, using the official `smplr` 1.1.0 package and its installed declarations/catalogs. Each expanded track has a labeled, keyboard-accessible Sound selector directly beneath its title. Its selection survives switching between tracks and changes only that track's serializable `presetId`; existing MIDI notes and category IDs remain intact.

Tone.js still owns the transport, beats, loop, metronome, and count-in. smplr receives Tone's underlying AudioContext and exact scheduled times. The selected sound for all five tracks preloads after project restoration, including empty/muted tracks. Open and Undo/Redo preload changed choices. Other unused presets load when selected, with loading/error feedback and Retry sound. Startup does not resume audio or start playback. The previous working sound or original synth remains available on failure. Decoded buffers are reused; stale loads cannot replace newer selections. Individual stop handles, unique stop IDs, and resource leases avoid choking overlapping notes or disposing a shared sampler prematurely. Pause cancels future attacks and release tails.

## Verified presets

All 20 displayed options loaded upstream assets and produced nonzero audio output in desktop Edge; each produced zero output after Pause. Catalog identifiers were also validated against the installed smplr helpers.

| Track | Default | Other available sounds |
|---|---|---|
| Melody | Flute | Marimba, Trumpet, Clean Electric Guitar, Synth Lead |
| Bass | Fingered Electric Bass | Picked Electric Bass, Acoustic Bass, Synth Bass |
| Keys | Splendid Grand Piano | Wurlitzer EP200, Pianet T, TX81Z FM Piano |
| Strings | String Ensemble | Violin, Cello, Synth Strings |
| Drums | TR-808 | LinnDrum LM-2, Casio RZ-1 |

TR-909 is absent from the installed DrumMachine catalog; Casio RZ-1 supplies the third working kit. Yamaha CP80 is excluded because its upstream OGG set lacks `065-F4-PP.ogg` and `057-A3-F.ogg`, while forcing the available M4A files failed audio decoding in Edge. Unplayable entries are not offered.

Drum MIDI 36/38/42/46/49 maps to kit-specific kick/snare/closed-hat/open-hat/crash aliases. TR-808 calls crash `cymbal`; LM-2 uses `hhclosed`/`hhopen`; Casio exposes its hats as full sample aliases under a shared group. Loaded groups and sample names are checked before accepting a kit. One-shot drums ignore melodic note-off but stop on pause, loop-end, and disposal.

## Changed and created files

All files in this feature change:

- `src/components/TrackRow.tsx` — per-track native selector, loading/error/retry, visible credits link.
- `src/components/Studio.tsx` — independent selection state, status subscription, preload before Play.
- `src/app/globals.css` — flood/ink selector styling and reachable controls on short screens.
- `src/lib/tracks.ts` — serializable `presetId` and category defaults.
- `src/lib/playback.ts` — documentation of all user gestures that unlock the existing facade.
- `src/lib/audio/playback-engine.ts` — preset-aware voices/preload/status hooks; refresh active playback when ready.
- `src/lib/audio/tone-backend.ts` — smplr manager on Tone's context; original synth/metronome fallback.
- `src/lib/audio/instrument-presets.ts` (new) — stable catalog, defaults, category validation, GM drum aliases.
- `src/lib/audio/smplr-backend.ts` (new) — lazy factories, catalog validation, shared buffer loader, asset restrictions.
- `src/lib/audio/preset-manager.ts` (new) — deduplication, timeout, fallback/retry, stale-load guards, leases.
- `src/lib/audio/sampled-voice.ts` (new) — normalized velocity adapter and individual note lifetimes.
- `src/tests/presets.test.ts` (new) — 14 catalog/loading/voice regression tests.
- `src/tests/playback.test.ts` — five additional preset scheduling/count-in regressions.
- `package.json` — adds official smplr dependency.
- `package-lock.json` — locks smplr 1.1.0; existing dependency versions are unchanged.
- `eslint.config.mjs` — ignores generated legacy `.test-build/`, allowing ordinary `npm run lint`.
- `public/sound-credits.txt` (new) — published sample-source attribution and license links.
- `AGENTS.md` — shared Track field, module ownership, authorized sample dependency/source policy.
- `PRODUCT.md` — per-track sound capability and local audio policy.
- `DESIGN.md` — selector placement, styling, focus and feedback conventions.
- `TECHNICAL_SPEC.md` — shared contracts, playback API/lifecycle, future persistence migration and verification.
- `SOFTWARE_DESIGN_DOCUMENT.md` — sampled playback, Track/save contract and regression coverage.
- `README.md` — sound-selection usage, sources, catalog exceptions, stack and verification instructions.
- `SMPLR_INTEGRATION.md` (new) — this full handoff.

No algorithm changes were made to `hum.ts`, `generate.ts`, or `music/harmony.ts`. MIDI encoding is unchanged. Existing note editing and project persistence workstreams remain separate.

## Verification actually completed on 2026-10-10

Commands passed (Windows uses `npm.cmd` / `npx.cmd`):

```text
npm run lint
npx tsc --noEmit
npm run build
npm test                         # 65 passed, 0 failed
npm audit --omit=dev --json       # 0 production vulnerabilities
git diff --check
```

The 65 tests comprise playback 22, presets 14, harmony 6, segmentation 12, and generation 11. Preset fixtures cover validation/defaults, missing drum aliases, stale completion, load failure/timeout/retry, shared disposal, invalid velocities, equal-pitch stop IDs, lookahead cancellation, and one-shot behavior. Playback fixtures verify that background readiness cannot cancel a stopped engine's recording count-in.

Automated desktop Edge checks fetched real upstream samples and exercised the UI through its labeled controls:

- All 20 choices load and produce positive output RMS; Pause silences each within 100 ms.
- Every expanded title is immediately followed by its own category-specific selector; selections survive zoom navigation.
- Preset changes preserve rendered note pitches/timing and the exported MIDI file byte for byte.
- Only one output AudioContext exists; sample starts use its clock. Two different default tracks and multiple solo tracks play together.
- Pause holds position; resume advances; Stop resets; Rewind preserves running playback. At 60 BPM approximately one beat elapses per second; at 180 BPM approximately three do. The 32-beat loop wraps and continues output.
- Muted arrangements are silent; metronome clicks remain available. Playback count-in can be cancelled without a later ghost start.
- Deliberately aborted Wurlitzer downloads show the previous Grand Piano fallback; playback still produces output and Retry recovers after requests are unblocked.
- Delayed Trumpet loading cannot replace a later Marimba choice. Repeated live changes preserve notes and continue output without browser errors.
- Demo humming still generates notes into the selected track. Synthetic WAV through the browser microphone/Pitchy/count-in path produces one held note with short wobbles/dropouts, or three notes for stable changes; media tracks end after both takes, with no page errors.
- Desktop/mobile screenshots were inspected. Selectors fit at 1280/390/320 px widths; the short-screen error state keeps Record reachable by scrolling the expanded header.
- Reloading or navigating away closes the old playing AudioContext. Resource disposal/stale-load behavior is also covered by unit tests; this is not a heap-memory benchmark.
- `/sound-credits.txt` is served successfully and linked from each expanded selector.

These checks analyze actual browser audio output; no human listening quality or physical microphone accuracy is claimed.

## Sources, privacy and security review

[Sound credits](public/sound-credits.txt) ship at `/sound-credits.txt`. They preserve the upstream author/source/license links: smplr is MIT; FluidR3_GM rendering is CC BY 3.0 US; Greg Sullivan's electric pianos are CC BY 3.0 Unported; TX81Z/VCSL is CC0; Splendid Grand and the drum collection are described as public domain by their sources. Keep the credits when distributing HumStudio. MusyngKite is not used.

There is no new server, authentication boundary, file-upload path, credential, or telemetry. Fixed category-specific preset IDs reject arbitrary URLs/prototype IDs/cross-category selections. React renders names and static error messages as text. The storage callback requires the two fixed HTTPS hosts (`gleitz.github.io`, `smpldsnds.github.io`) without credentials/redirects, with bounded manifest sample counts, network timeouts and missing-buffer checks. Installed smplr 1.1.0 fetches ElectricPiano's fixed SFZ manifest internally, bypassing the callback's timeout/redirect policy; its sample buffers still use the callback. Project input cannot supply those URLs. See `AUDIT.md` for this remaining dependency boundary gap. Raw microphone data stays local. Selected sounds fetch upstream assets on opening, so network/source availability remains a dependency; the existing synth fallback handles failures.

`npm audit --json` ran and returned five high-severity findings in the existing development-only Next ESLint dependency chain (`braces` → `micromatch` → `fast-glob` → `@next/eslint-plugin-next` → `eslint-config-next`). The proposed automatic fix downgrades the Next ESLint configuration to 14.2.35, incompatible with this Next 16 setup, so it was not applied. Production audit is clean. A compatible development-toolchain fix remains follow-up work.

## Remaining manual checks and integration

- Listen on the actual demo laptop/headphones: sound quality, levels, drum timbres, timing, and switching while sustained notes play.
- Record a real human hum on the physical microphone; verify permission denial and HTTPS deployment behavior. Synthetic browser capture is not a substitute for these checks.
- Open the MIDI export in the team's target MIDI application. Browser byte preservation is verified; DAW import/listening remains manual.
- Optional: test other browsers and long-session heap usage; Edge reload/navigation cleanup passed.

Project schema v3 now persists `presetId` with each track through Save/Open and autosave. V1/V2 files remain supported; missing preset IDs receive the category default, and unknown/cross-category IDs reject through `presetForTrack`. Restore the project before automatic loading so legacy/default sounds do not download ahead of saved choices. The dated checks above describe the original integration; see `AUDIT.md` for subsequent work.
