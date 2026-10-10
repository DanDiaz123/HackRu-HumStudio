# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary: HackRU Fall 2026 judges watching a ~90-second live demo on a laptop (desktop Chrome/Edge). The UI must be legible at a glance and make the hum-to-music moment land. Secondary: beginners and songwriters who can hear a melody but cannot play or program it.

## Product Purpose
HumStudio turns a hummed melody into music. A multi-track editor holds one track per instrument; the user picks a track, hums into it, and the track fills with generated music data for that instrument. Success: a judge sees a hum become music on a real-looking timeline within one demo.

## Positioning
Voice is the input device. Instead of clicking notes into a piano roll, each instrument track is filled by humming, and the user watches their voice (live spectrogram) turn into music (revealed notes).

## Operating Context
Live hackathon demo: unknown laptop microphone, browser permission prompts, room noise, short recordings (up to ~15 s). Desktop Chrome/Edge over localhost or HTTPS; mobile is best effort.

## Capabilities and Constraints
- Multi-track is core (overrides the SDD's single-track P0): tracks per instrument in a DAW-style arrangement view.
- Flow: click a track to zoom into it, record a hum, a live spectrogram draws over the track while recording, a loading state covers generation, then the music data is revealed with an animation.
- The hum feeds a generated arrangement for that track, not necessarily a 1:1 transcription. The UI is built; generation is a DSP heuristic behind `generateNotes(...)` in `src/lib/generate.ts` plus rule-based harmony: the Melody take sets the song's key and chords, and every other pitched track is fitted to them so parts recorded separately still sound good together. A backend is undecided.
- Five fixed instrument tracks: Melody, Bass, Keys, Drums, Strings.
- A top-menu Sensitivity dropdown selects Low (large sustained pitch changes), Medium (balanced/default), or High (small quicker pitch changes). Changing it or Snap re-generates every recorded part from its kept take (analysis frames, in memory) without recording again; hand-edited parts are kept. Tuning values live together in `src/lib/audio/note-sensitivity.ts`.
- Each expanded track has its own Sound selector beneath its category title. A serializable preset ID selects smplr playback timbre without changing category identity or notes. Selected samples load on demand, with the previous working sound or original synth as fallback; sample downloads use third-party asset hosts, and raw microphone audio stays local.
- Notes are stored in beats (`Note`: midi, startBeat, durationBeats, velocity), per TECHNICAL_SPEC.md.
- Raw audio stays on device in the MVP.

## Brand Commitments
Working name "HumStudio" (rename allowed). User-stated reference: should look like a familiar music editor (FL Studio, Chrome Music Lab).

## Evidence on Hand
No real recordings, users, or testimonials. Keys and Drums ship with parts labeled "Sample", and the synthetic input is labeled "Demo hum"; never present either as live output.

## Product Principles
1. The hum-to-music moment is the product; everything else supports it.
2. Familiar DAW conventions over novelty in controls, so judges read it instantly.
3. Honest state: recording, generating, and failure states are always visible and truthful.
4. Demo-resilient: mic denial or weak input never breaks the editor.

## Accessibility & Inclusion
Visible labels and focusable controls; recording/playback state never conveyed by color alone; respect reduced motion for the reveal animation.
