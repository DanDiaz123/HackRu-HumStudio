# HumStudio

**Learn music by humming it.**

A music learning and composition sketchpad built for **HackRU Fall 2026 · Education Track**. Hum a melody, see it become editable notes, build an instrumental arrangement, and explore the theory behind your music.

**[Try the live demo](https://hackru-project-six.vercel.app/)** · [Run locally](#run-locally) · [License](LICENSE.md)

## Why HumStudio?

You can know a melody by ear without knowing its notes, rhythm, or chords. HumStudio connects the sound you make to those ideas through a simple loop:

**Hum → See your notes → Experiment → Listen → Learn**

Live pitch feedback, labeled notes, and chord overlays make music theory visible. Editing and playback let you hear what changes when you move a note, adjust its timing, or add another instrument. The Gemini theory agent explains the current progression in plain language and suggests variations to explore.

## A 90-second walkthrough

1. **Open Melody.** Leave **Learn** enabled and allow microphone access when prompted.
2. **Hum a short phrase.** Press **Record**, hum a few clear notes, and stop. Watch the live spectrogram and pitch display, then see the notes appear on the timeline.
3. **Shape the music.** Drag a note to change pitch or timing, resize it, and compare **Snap Off** with a beat grid. Use Undo to compare versions.
4. **Explore the theory.** Read the key, chord names, Roman numerals, and do-re-mi labels. Press **Explain** for a streamed explanation from the theory agent.
5. **Hear the arrangement.** Play alongside the labeled Keys and Drums sample parts, change a sound, or use Mute and Solo to hear individual instruments.
6. **Keep your idea.** Save a project to continue editing later, or export MIDI to use it in other music tools.

Use desktop Chrome or Edge with a microphone. **Demo hum** provides a clearly labeled synthetic example when a microphone is unavailable.

## Features

| Feature | What you can do |
| --- | --- |
| **Five instrument tracks** | Build Melody, Bass, Keys, Drums, and Strings parts across eight bars of 4/4. |
| **Hum-to-notes** | Record a short phrase with live pitch feedback and a spectrogram, then edit the generated notes. |
| **Learn mode** | Explore note names, solfège, scale degrees, key, chord symbols, and Roman numerals. Follow the active chord during playback. |
| **Gemini theory agent** | Get plain-language explanations of your chord progression and ideas for alternative chords and voicings. |
| **Independent track settings** | Choose a sound, Low/Medium/High sensitivity, and Snap Off/1/4/1/8/1/16 for each instrument. |
| **Piano-roll editing** | Add, move, resize, delete, copy regions, repeat phrases, and undo or redo changes. |
| **Five drum lanes** | Work with Kick, Snare, Closed hat, Open hat, and Crash while keeping every lane visible. |
| **Playback controls** | Play, pause, stop, rewind, change tempo, mute or solo tracks, and use a metronome and count-in. |
| **Save and export** | Autosave in your browser, save/open `.humstudio.json` projects, and export a multitrack `.mid` file. |

Selected sounds for all five instruments load automatically when the app opens. Downloads have retry and synth fallback support; playback starts after a user gesture.

## How it works

1. **Capture:** Web Audio analyzes microphone input locally. Pitchy estimates the fundamental pitch while the spectrogram displays the input.
2. **Detect:** Deterministic DSP groups stable pitches into notes, filters brief wobbles, and identifies rests and attacks.
3. **Arrange:** Melody establishes a shared harmonic context. Bass, Keys, and Strings fit their instrument roles; Drums use onset timing for the selected lane. Each track applies its own sensitivity and timing grid.
4. **Play and learn:** Tone.js and smplr play the arrangement. Learn overlays show the musical structure, and Gemini explains the derived key and chords through a server route.
5. **Save and export:** Project files preserve the editable arrangement and track settings. MIDI exports preserve musical note data.

The recording workflow is designed for clear, one-note-at-a-time humming in a reasonably quiet room. Harmony inference and AI explanations can be imperfect; you can edit notes and select a different key.

### Technology

| Area | Technology |
| --- | --- |
| Application | Next.js 16, React 19, TypeScript |
| Microphone and pitch | Web Audio API, Pitchy |
| Note generation | Local DSP segmentation, rule-based harmony, quantization |
| Instrument playback | Tone.js 15, smplr sampled presets with synth fallback |
| Theory agent | Gemini streaming REST API through a Next.js Route Handler |
| MIDI | `@tonejs/midi` |
| Persistence | Browser `localStorage` and versioned JSON project files |
| Interface | Custom CSS, Archivo typography, canvas spectrogram |

## Privacy and reliability

- **Microphone audio stays on your device.** It is analyzed locally and is never uploaded or included in saved projects.
- **Explain shares only musical context.** The theory agent receives the inferred key and chord labels, including Roman numerals. Audio, individual notes, and project identifiers are excluded.
- **Credentials stay on the server.** The Gemini API key is never bundled into the browser.
- **Sound assets download from third-party hosts.** These hosts receive no microphone recordings. Attribution is listed in [sound credits and licenses](public/sound-credits.txt).
- **Your work is preserved on failure.** Empty takes keep existing notes; invalid imports are rejected before replacing the project. Save, Open, and autosave share a 2,000,000-byte UTF-8 limit.

## Run locally

### Requirements

- Node.js **20.9+** and npm; use **Node.js 24+** for the repository's TypeScript test runner.
- Desktop Chrome or Edge and a microphone.
- Internet access for initial sound downloads and the theory agent.
- `localhost` in development or HTTPS for microphone access on a hosted deployment.

### Install

```bash
npm ci
```

### Configure the theory agent

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey). Add it to `.env.local` in the repository root:

```dotenv
GEMINI_API_KEY=your-key-here
```

The file is ignored by Git. Keep the key server-side and do not give it a `NEXT_PUBLIC_` prefix. For hosted deployments, set the same variable in the server environment.

The default model is `gemini-3.5-flash-lite`. Set `GEMINI_MODEL` to override it. Restart the development server after changing environment variables. If the key is missing, the Explain dialog shows a configuration message.

### Start

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The studio starts at **120 BPM**, **1/4 Snap**, and **Medium sensitivity**, with labeled sample parts on Keys and Drums.

On Windows PowerShell, use `npm.cmd` and `npx.cmd` if execution policy blocks the script wrappers.

## Useful controls

| Action | Control |
| --- | --- |
| Play / pause | Space |
| Record / stop recording | R |
| Open an instrument | 1–5 |
| Return to all tracks / cancel a copy preview | Escape |
| Mute / solo the open track | M / S |
| Toggle Learn / metronome | L / K |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z |
| Save project | Ctrl+S |
| Show all shortcuts | ? |

**Copy a region:** open a track, press Ctrl+C (Cmd+C on macOS), and drag a rectangle over notes. Drag the highlighted group horizontally to insert copies, or use Ctrl+V at the playhead. Copying supports chords and multiple drum rows within the same instrument. Each successful paste is one Undo step; collisions and placements outside the song are rejected together.

**Adjust a take:** each track retains its own sensitivity and Snap settings. The latest unedited take can be regenerated after Save/Open. Hand-edited notes remain intact when sensitivity changes. Project files use schema v3 and support v1/v2 imports.

## Validation and development

- [x] **Real-device tuning:** DSP generation validated with human humming on the demo microphone.

Regression suites cover pitch segmentation, harmony, playback, sound loading, editing, project validation, MIDI, and theory-agent helpers. Browser suites cover studio interactions, startup sounds, per-track settings/copy, and persistence boundaries.

To check implementation changes:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Browser suites use an existing Playwright installation and Microsoft Edge. For example, with the development server running:

```bash
node src/tests/browser/studio-interactions.mjs <path-to-playwright-package> [http://localhost:3000]
```

Related suites: [startup sounds](src/tests/browser/startup-sounds.mjs), [per-track settings and copy](src/tests/browser/per-track-copy.mjs), and [persistence boundaries](src/tests/browser/persistence-boundaries.mjs). Results are written to ignored `.test-build/`. Synthetic microphone tests exercise the recording pipeline; human listening and learner feedback require separate checks.

## License

HumStudio's original source code is licensed under the [MIT License](LICENSE.md).
Third-party libraries and sampled sounds retain their own licenses. smplr is MIT-licensed; sound sources include CC BY 3.0, CC0, and public-domain samples. See [sound credits and license notices](public/sound-credits.txt) and the [smplr MIT notice](public/smplr-license.txt).

**Event:** HackRU Fall 2026 · **Track:** Education · **License:** [MIT](LICENSE.md).
