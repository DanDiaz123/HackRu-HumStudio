# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Track and positioning

**HackRU Fall 2026 submission focus: Education.** HackRU describes this track as hacks that focus on building an educated community ([HackRU tracks](https://www.hackru.org/)). HumStudio's educational contribution is to make basic music theory **visible, audible, and interactive** for people who do not yet read notation or play an instrument.

**One-line pitch:** *Learn music by humming it: see your notes, discover keys and chords, experiment with rhythm, and hear how instrument parts fit together.*

HumStudio remains a creative music sketchpad. The Education positioning is **learning through making**, not a claim that it is a complete curriculum, tutor, accredited teaching tool, or automatic grader.

## Users

**Primary:** Beginning music learners, school/college students, and self-taught creators who know a tune by ear but struggle to connect pitch, rhythm, notation, and harmony. Teachers, tutors, and club leaders can use the visualizations for short demonstrations; no classroom-management features exist.

**Secondary:** Songwriters sketching ideas without instruments; HackRU judges watching a roughly 90-second live demonstration in desktop Chrome/Edge.

**Accessibility opportunity:** Voice provides an alternative to keyboard playing or manually entering every note. It is **not** a complete accessibility solution: the mic requires voiced input, and the current live pitch display is visual-only.

## Learner problem and educational value

Conventional theory lessons introduce abstract note names, scale degrees, chord symbols, rhythmic grids, and instrument roles before a novice can connect those ideas to a sound they produced. Full DAWs also assume familiarity with piano rolls and MIDI editing.

HumStudio supports an **experiment → observe → change → listen** learning loop:

1. Select an instrument track and hum a short, monophonic idea.
2. Watch the live spectrogram and, with **Learn** enabled, see the current detected pitch, its scale-degree/solfège label, and cents from the nearest semitone.
3. Stop recording and watch the detected melody become MIDI-style note bars. The reveal distinguishes the hummed note stage from snapping/role-based arrangement.
4. Read note names/solfège, the inferred or manually selected key, and chord symbols plus Roman numerals across bars. The current chord is highlighted during playback.
5. Compare **Snap Off vs 1/4, 1/8, 1/16** and the metronome to explore beat placement.
6. Move or resize a note, replay it, or change an instrument's sound to discover how pitch, duration, harmony, and timbre affect the result.
7. Layer Melody, Bass, Keys, Strings, and rhythm-only Drum parts; mute/solo to hear each part's role.

**Educational outcome to demonstrate, not claim to have measured:** a learner can name at least one sung pitch/scale degree, point to a chord and bar on the timeline, explain why quantization changes the rhythm, and hear the effect of editing a note.

## Product purpose and core experience

HumStudio turns a hum into a **multitrack instrumental arrangement** that can be inspected, edited, replayed, saved, and exported. It is both a composition tool and a beginner-friendly visual music-theory sandbox.

- Five fixed instrument tracks: Melody, Bass, Keys, Drums, Strings, over eight bars of 4/4.
- Click a track to expand it, choose its sampled **Sound**, record a hum while a live spectrogram fills the lane, and watch the resulting notes reveal.
- **Generation is not guaranteed to be a literal transcription.** Pitchy plus deterministic DSP estimates and segments pitches, then instrument-role and harmony heuristics may alter pitches, timing, or voices. Melody retains confirmed pitches unless a user explicitly changes the key; Bass, Keys, and Strings generate parts according to their roles. Drums capture the timing of onsets in one chosen kit lane.
- MIDI notes use `Note { id, midi, startBeat, durationBeats, velocity }` in quarter-note beats. A shared `Harmony` stores a key and one chord per bar.

## Education features — actual implementation on main

| Feature | What a learner can explore | Implementation | Status |
| --- | --- | --- | --- |
| **Learn toggle** (defaults on) | Switch between the regular DAW view and contextual music-theory labels | `Studio.tsx`, `TrackRow.tsx` | Implemented |
| **Live pitch feedback** | Nearest note name, solfège/scale degree or "outside the key," and signed cents displacement | `TrackRow.tsx` `LivePitch`; `hzToMidi`, `scaleDegree`, `solfege` | Implemented visually during voiced recording; not a graded pitch exercise |
| **Labeled piano-roll notes** | Relate note bars and positions to pitch names and do/re/mi | `Studio.tsx` `noteLabel`, `TrackRow.tsx` | Implemented when Learn is on |
| **Key and chords** | Inferred key, manual key override, one chord per bar, chord symbols and Roman numerals | `music/harmony.ts`, `Studio.tsx`, `TrackRow.tsx` | Implemented; harmonic guesses may be imperfect |
| **Playback-following chord highlight** | Link chord changes to a location in the music | `Studio.tsx` playhead; `TrackRow.tsx` `LaneChords` | Implemented |
| **Rhythm experimentation** | Compare raw timing versus beat-grid snapping; count in to a metronome | Snap, BPM, metronome/count-in | Implemented; listening/real-device confirmation pending |
| **Constructive experimentation** | Edit a wrong note, undo/redo, mute/solo layers, hear different sampled timbres | Note editing, history, Tone.js + smplr | Implemented; actual classroom learning not evaluated |
| **Accessible first try** | Try the interaction without granting a mic | Clearly labeled `Demo hum` and `Sample` tracks | Implemented; not evidence of live transcription |

**Not implemented:** guided lessons, graded quizzes, a reference-melody scoring system, lesson history, longitudinal learning metrics, teacher dashboards, student accounts, classroom sharing, or personalized feedback. These are future possibilities, **not hackathon deliverables**.

## Operating context and limits

HackRU is a short live demo on an unfamiliar microphone, with room noise and potential sample-host network failures. Main target is desktop Chrome/Edge on localhost or HTTPS. Recordings are typically 5–15 seconds; input is single-voice humming or selected-lane beatboxing. No polyphonic vocal transcription, proof of pedagogical effectiveness, or formal skills assessment is promised.

**Technology:** Next.js/React/TypeScript; local Web Audio + Pitchy; deterministic segmentation and rule-based harmony; Tone.js transport with smplr sound presets and synth fallback; `@tonejs/midi`. No trained model, generative AI service, authentication, or music-learning backend is implemented.

**Privacy:** Mic audio stays on device and is not uploaded or saved. Latest-take pitch-analysis caches remain in memory. Project files/autosave include note data, selected sounds, chords, tempo, Snap, and Sensitivity, not recordings. Sample instruments download sound assets from documented third-party hosts; they do not receive microphone recordings.

## Demo story for Education Track (90 seconds)

1. **0–15 s — The learning barrier:** "You can hum a song but may not know what the notes, chords, or beats mean."
2. **15–35 s — Hear becomes visible:** Open Melody, turn attention to **Learn**, hum clearly, show the live pitch, degree/solfège, cents, and spectrogram. Identify this as a **live recording**, or explicitly say "Demo hum" for the synthetic fallback.
3. **35–55 s — Explain rather than just generate:** Stop; point to the generated note names, the key selector, the chord names and Roman numerals. Clarify that key/chord suggestions are algorithmic interpretations, not ground truth.
4. **55–75 s — Learn by changing:** Move a note or change Snap; replay to hear the impact. Open Bass or Keys and show its different musical role, or mute/solo an existing part.
5. **75–90 s — Outcome and export:** Show the assembled tracks, explain what the learner can now identify, and export MIDI as the next step into other tools.

The demo should include **one verbal learning takeaway**, not only a production-quality song.

## Success criteria and evidence

**For judging:** The running app visibly and audibly completes hum → notes → theory labels → edit/compare → playback/export within a short demonstration. Learners can access the labels without a prior music-notation lesson.

**Acceptance to validate before presenting:** labels correctly correspond to the current key and MIDI notes; chord highlight follows the active bar; note edits update playback; the visual cents indicator responds to a stable note and shows no pitch during silence; toggling Learn does not change project notes or playback; fallback content is honestly labeled.

**Current evidence:** source code and automated audio/UI regressions (see `README.md` and `AUDIT.md`). **Not yet established:** performance on the physical demo mic, expert listening, student usability or learning gains, a teacher pilot, or a live deployed HTTPS demonstration. Do not claim those have happened.

## Roadmap and priorities

- **P0 — maintain:** reliable live hum → editable notes; Learn labels/key/chords/cents; playable multitrack arrangement; instrument presets; JSON/MIDI export; failure-safe fallback.
- **P0 — finish for hackathon:** physically test mic and audio on the judging laptop, verify education labels in the chosen example, practice the education-centered demo, and deploy/test HTTPS.
- **P1 — if time:** concise in-app explanations/tooltips for "key," "scale degree," "cents," and "Snap"; one optional guided three-note activity with no scoring claim.
- **P2 — future:** reference-tone/ear-training exercises with clearly defined accuracy metrics, step-by-step lessons, opt-in progress tracking, educator-created exercises, classroom sharing and accessibility improvements (especially nonvisual feedback).

Avoid trading a reliable learning demo for a large feature with no validation.

## Brand commitments

Working name **HumStudio**. Follow `DESIGN.md`: Archivo typography, dark studio, squared-off controls, five instrument colors, visual spectrogram/reveal. The primary story is **music theory made tangible through your voice**; the creative DAW look supports that story rather than obscuring the explanation.

## Product principles

1. **Sound → meaning → action:** Every educational label should explain what the user just heard or changed.
2. **Voice-first, beginner-first:** Avoid requiring sheet-music literacy just to begin.
3. **Experimentation, not evaluation:** No invented correctness score, grade, or promise of learning improvement.
4. **Interpretations are visible:** Inferred keys and generated harmony are suggestions; learners can choose a key and edit notes.
5. **Demo-resilient and honest:** A bad mic or no network must not destroy notes; synthetic inputs must remain labeled.
6. **Local by default:** User recordings and learning experiments stay private.

## Accessibility & inclusion

Controls have visible labels/focus, statuses include text and respect reduced motion, and shortcuts do not run while typing. The current visual `LivePitch` is `aria-hidden`; nonvisual equivalents and accessibility testing are **future work**, not finished claims. The product should work with a manually edited/sample melody if singing is not possible.
