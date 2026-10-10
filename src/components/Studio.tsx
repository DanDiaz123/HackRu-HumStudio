"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type GenTrace, generateTrackVariants, snapNotesToGrid, type NoteSensitivityVariants } from "@/lib/generate";
import { DEFAULT_NOTE_SENSITIVITY, NOTE_SENSITIVITY_LEVELS, NOTE_SENSITIVITY_PRESETS, isNoteSensitivity, type NoteSensitivity } from "@/lib/audio/note-sensitivity";
import { type HumFrame, micErrorMessage, startDemoHum, startMic } from "@/lib/hum";
import { exportMidi } from "@/lib/midi";
import {
  DEFAULT_HARMONY,
  type Harmony,
  type Key,
  KEYS,
  type Mode,
  chordName,
  chordsFromVoicing,
  fitToHarmony,
  harmonyLabel,
  inferHarmony,
  keyName,
  solfege,
  voiceChords,
  withKey,
} from "@/lib/music/harmony";
import * as playback from "@/lib/playback";
import { presetForTrack } from "@/lib/audio/instrument-presets";
import type { PresetStatus } from "@/lib/audio/preset-manager";
import {
  MAX_RECORD_SEC,
  type Note,
  type QuantizeDivision,
  TOTAL_BEATS,
  type Track,
  beatX,
  initialTracks,
  midiName,
} from "@/lib/tracks";
import { DownloadIcon, PauseIcon, PlayIcon, RewindIcon, StopIcon } from "./icons";
import TrackRow, { type Phase, REVEAL_SEC, type Reveal } from "./TrackRow";

const COLLAPSED_H = 36;

/** Move a part onto new harmony without deleting notes: the Keys sample is re-voiced, drums stay put. */
const refit = (t: Track, h: Harmony): Track =>
  t.instrument.kind === "drums" ? t : { ...t, notes: t.sample ? voiceChords(h) : fitToHarmony(t.notes, t.instrument, h) };

const sameHarmony = (a: Harmony, b: Harmony) => a.tonic === b.tonic && a.mode === b.mode &&
  a.bars.length === b.bars.length && a.bars.every((bar, index) => bar.length === b.bars[index].length && bar.every((pitch, i) => pitch === b.bars[index][i]));

function readout(beat: number) {
  const bar = Math.floor(beat / 4) + 1;
  const b = Math.floor(beat % 4) + 1;
  const s = Math.floor((beat % 1) * 4) + 1;
  return `${bar}.${b}.${s}`;
}

export default function Studio() {
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [harmony, setHarmony] = useState(DEFAULT_HARMONY);
  const [learn, setLearn] = useState(true);
  const [bpm, setBpm] = useState(120);
  const [quantize, setQuantize] = useState<QuantizeDivision>("1/4");
  const [sensitivity, setSensitivity] = useState<NoteSensitivity>(DEFAULT_NOTE_SENSITIVITY);
  const [sensitivityNotes, setSensitivityNotes] = useState<Record<string, NoteSensitivityVariants>>({});
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [frames, setFrames] = useState<HumFrame[]>([]);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [demo, setDemo] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [startingAudio, setStartingAudio] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [presetStatuses, setPresetStatuses] = useState<Record<string, PresetStatus>>({});
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const [avail, setAvail] = useState(0);

  const rowsRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<HTMLOutputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  // Re-record clears the part up front; a failed take puts it back (never lose a part to an empty take).
  const clearedRef = useRef<{ id: string; notes: Note[] } | null>(null);
  // Keep only analysis frames, never microphone samples, so Snap can regenerate from the take.
  const sensitivityFramesRef = useRef<Record<string, HumFrame[]>>({});
  const snapSourceNotesRef = useRef<Record<string, Note[]>>({});
  const harmonyDriverRef = useRef<"melody" | "keys" | null>(null);
  const keyOverrideRef = useRef<Key | null>(null);
  const playbackRequest = useRef(0);
  const arrangementRef = useRef({ tracks, bpm });
  const stopTake = useRef<() => void>(() => {});
  const unsubscribePresets = useRef<(() => void) | null>(null);

  const busy = startingAudio || phase === "requesting" || phase === "recording" || phase === "generating" || phase === "revealing";
  const zoomed = tracks.find((t) => t.instrument.id === zoomedId) ?? null;

  useLayoutEffect(() => {
    const el = rowsRef.current!;
    const ro = new ResizeObserver(() => setAvail(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the transport in sync with notes, mutes and tempo.
  useEffect(() => {
    arrangementRef.current = { tracks, bpm };
    const engine = playback.getEngine();
    engine?.schedule(tracks, bpm);
  }, [tracks, bpm]);

  const setPos = (beat: number) => {
    if (headRef.current) headRef.current.style.left = `${beatX(beat)}%`;
    if (posRef.current) posRef.current.textContent = readout(beat);
    // Light the chord under the playhead in the zoomed lane (Learn); DOM only, like the playhead.
    const bar = Math.floor(beat / 4);
    document.querySelectorAll(".lane-chords li").forEach((li, i) => li.classList.toggle("now", i === bar));
  };

  // Playhead + position readout run outside React.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const engine = playback.getEngine();
      setPos(engine?.positionBeats() ?? 0);
      if (engine?.state() !== "started") {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Cancel pending starts and release browser audio resources when the page goes away.
  useEffect(() => () => {
    stopRef.current?.();
    playbackRequest.current++;
    unsubscribePresets.current?.();
    playback.dispose();
  }, []);

  function pauseIfPlaying() {
    const live = playback.getEngine();
    if (live?.state() !== "started") return false;
    live.pause();
    setPos(live.positionBeats());
    setPlaying(false);
    return true;
  }

  /** Connect runtime loading feedback after a user gesture, outside serializable Track[]. */
  async function connectAudio() {
    const engine = await playback.ensureAudio();
    unsubscribePresets.current ??= engine.subscribePresets(status => {
      setPresetStatuses(previous => ({ ...previous, [status.trackId]: status }));
    });
    return engine;
  }

  /** Change only playback timbre; retain the category, note array, and all note IDs. */
  async function changePreset(trackId: string, presetId: string) {
    const preset = presetForTrack(trackId, presetId);
    const current = arrangementRef.current;
    const next = current.tracks.map(track => track.instrument.id === trackId ? { ...track, presetId: preset.id } : track);
    arrangementRef.current = { ...current, tracks: next };
    setTracks(next);
    setPresetStatuses(previous => ({ ...previous, [trackId]: { trackId, presetId, state: "loading" } }));
    try {
      const engine = await connectAudio();
      const latest = arrangementRef.current;
      const track = latest.tracks.find(t => t.instrument.id === trackId)!;
      if (track.presetId !== preset.id) return;
      engine.schedule(latest.tracks, latest.bpm);
      await engine.prepare([track], true);
    } catch {
      if (arrangementRef.current.tracks.find(t => t.instrument.id === trackId)?.presetId !== preset.id) return;
      setPresetStatuses(previous => ({ ...previous, [trackId]: { trackId, presetId, state: "fallback",
        message: "Audio could not start. Check your output device and retry this sound." } }));
    }
  }

  /** Put the arrangement and metronome setting back after a click-only recording. */
  function restoreTransport() {
    const engine = playback.getEngine();
    if (!engine) return;
    engine.stop();
    engine.setMetronome(metronome);
    engine.schedule(arrangementRef.current.tracks, arrangementRef.current.bpm);
    setPos(0);
  }

  async function togglePlay() {
    if (pauseIfPlaying()) return;
    if (startingAudio) return;
    const request = ++playbackRequest.current;
    setStartingAudio(true);
    setPlaybackError("");
    try {
      const engine = await connectAudio();
      if (request !== playbackRequest.current) return;
      const current = arrangementRef.current;
      engine.schedule(current.tracks, current.bpm);
      const solo = current.tracks.some(track => track.solo);
      await engine.prepare(current.tracks.filter(track => track.notes.length && !track.muted && (!solo || track.solo)));
      if (request !== playbackRequest.current) return;
      const latest = arrangementRef.current;
      engine.schedule(latest.tracks, latest.bpm);
      engine.setMetronome(metronome);
      if (countIn) {
        const completed = await engine.countIn(latest.bpm, setCountInBeat);
        if (!completed || request !== playbackRequest.current) return;
      }
      setCountInBeat(null);
      engine.play();
      setPlaying(engine.state() === "started");
    } catch {
      if (request !== playbackRequest.current) return;
      playback.getEngine()?.stop();
      setPlaying(false);
      setPlaybackError("Audio could not start. Check your output device and try Play again.");
    } finally {
      if (request === playbackRequest.current) {
        setStartingAudio(false);
        setCountInBeat(null);
      }
    }
  }

  function stopPlayback() {
    playbackRequest.current++;
    setStartingAudio(false);
    setCountInBeat(null);
    playback.getEngine()?.stop();
    setPlaying(false);
    setPos(0);
  }

  function rewind() {
    playback.getEngine()?.rewind();
    setPos(0);
  }

  const open = useCallback(
    (id: string) => {
      if (busy) return;
      setZoomedId(id);
      setPhase("idle");
      setFrames([]);
      setError("");
    },
    [busy],
  );

  const back = useCallback(() => {
    if (busy) return;
    setZoomedId(null);
    setPhase("idle");
    setFrames([]);
  }, [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  const finish = useCallback(
    async (taken: HumFrame[]) => {
      stopRef.current?.();
      stopRef.current = null;
      if (!zoomed) return;
      // Beatbox hits are mostly unvoiced, so drums count loud frames instead of pitched ones.
      const heard = zoomed.instrument.kind === "drums" ? (f: HumFrame) => f.rms > 0.02 : (f: HumFrame) => f.hz !== null;
      if (taken.filter(heard).length < 10) {
        restoreCleared();
        setPhase("error");
        setError("We didn't catch a hum. Get closer to the mic and try again.");
        return;
      }
      if (process.env.NODE_ENV === "development") {
        // Dev only: `copy(__humTake)` in the console saves this take for src/tests/takes (analysis frames, no audio).
        const frames = taken.map((f) => ({ ...f, bins: Array.from(f.bins) }));
        Object.assign(window, { __humTake: { instrument: zoomed.instrument.id, bpm, quantize, harmony, frames } });
      }
      setPhase("generating");
      try {
        const inst = zoomed.instrument;
        const trace = {} as GenTrace;
        const variants = generateTrackVariants(inst, taken, bpm, quantize, harmony, sensitivity, trace);
        const notes = variants[sensitivity];
        if (!notes.length) throw new Error("empty");
        // A Melody take sets the key and chords, a Keys take re-picks the chords; other pitched parts
        // are re-fitted (moved, never deleted).
        const h = inst.id === "melody" ? inferHarmony(notes) : inst.id === "keys" ? chordsFromVoicing(notes, harmony) : null;
        const after = h ?? harmony;
        // Every step shows what the pipeline actually produced; nothing here is a progress estimate.
        const drums = inst.kind === "drums";
        const noun = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
        const steps = [
          drums
            ? { title: noun(trace.raw.length, "hit"), sub: "Heard in your beatbox" }
            : { title: noun(trace.raw.length, "note"), sub: `Found in ${trace.voicedFrames} pitched frames of your hum` },
          {
            title: trace.grid ? "On the beat" : drums || inst.id === "melody" ? "As hummed" : "In key",
            sub: trace.grid
              ? `Snapped to the ${quantize} grid` + (drums || inst.id === "melody" ? "" : `, fitted to ${keyName(after)}`)
              : drums || inst.id === "melody" ? "Timing kept; confirmed pitch changes preserved" : `Fitted to ${keyName(after)}, timing kept`,
          },
          ...(drums ? [] : [{ title: keyName(after), sub: after.bars.map(chordName).join(" ") }]),
        ];
        const stepMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1100;
        const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
        setReveal({ step: 0, raw: trace.raw, final: notes, harmony: after, steps });
        setPhase("revealing");
        for (let i = 1; i <= steps.length; i++) {
          await wait(i === 1 && stepMs ? (REVEAL_SEC + 0.3) * 1000 : stepMs); // step 0 lasts as long as the print-in sweep
          setReveal((r) => r && { ...r, step: i });
        }
        if (h) {
          setHarmony(h);
          snapSourceNotesRef.current = {};
        }
        clearedRef.current = null;
        setSensitivityNotes((previous) => ({ ...previous, [inst.id]: variants }));
        sensitivityFramesRef.current[inst.id] = taken.map((frame) => ({ ...frame }));
        delete snapSourceNotesRef.current[inst.id];
        if (inst.id === "melody" || inst.id === "keys") harmonyDriverRef.current = inst.id;
        if (inst.id === "melody") keyOverrideRef.current = null;
        setTracks((ts) =>
          ts.map((t) => {
            if (t.instrument.id === inst.id) return { ...t, notes, sample: false };
            return h ? refit(t, h) : t;
          }),
        );
        setReveal(null);
        setPhase("done");
      } catch {
        restoreCleared();
        setReveal(null);
        setPhase("error"); // the cleared part comes back
        setError("No notes came out of that take. Try a longer, steadier hum.");
      }
    },
    [zoomed, bpm, quantize, harmony, sensitivity],
  );

  function restoreCleared() {
    const c = clearedRef.current;
    clearedRef.current = null;
    if (c) setTracks((ts) => ts.map((t) => (t.instrument.id === c.id && !t.notes.length ? { ...t, notes: c.notes } : t)));
  }

  async function record(useDemo: boolean) {
    if (!zoomed || busy) return;
    pauseIfPlaying();
    clearedRef.current = null;
    if (!zoomed.sample && zoomed.notes.length) {
      clearedRef.current = { id: zoomed.instrument.id, notes: zoomed.notes };
      setTracks((ts) => ts.map((t) => (t.instrument.id === zoomed.instrument.id ? { ...t, notes: [] } : t)));
    }
    const taken: HumFrame[] = [];
    setFrames(taken);
    setDemo(useDemo);
    setError("");
    const limitSec = Math.min(MAX_RECORD_SEC, (TOTAL_BEATS * 60) / bpm);
    let done = false;
    // Mic frames carry audio-clock time; t=0 is the first click after the count-in, as the singer hears it.
    // Frames before it (the count-in) are dropped.
    let originSec: number | null = useDemo ? 0 : null;
    const onFrame = (raw: HumFrame) => {
      if (done || originSec === null || raw.tSec < originSec) return;
      const f = originSec ? { ...raw, tSec: raw.tSec - originSec } : raw;
      taken.push(f);
      if (f.tSec >= limitSec) {
        done = true;
        void finish(taken);
      }
    };
    stopRef.current = () => {
      done = true;
    };
    try {
      if (useDemo) {
        stopRef.current = startDemoHum(onFrame);
      } else {
        setPhase("requesting");
        // Audio first: the mic runs on Tone's context, so its frames share the click's clock.
        const engine = await connectAudio();
        const mic = await playback.micContext();
        const stopMic = await startMic(mic, onFrame);
        stopRef.current = () => {
          done = true;
          stopMic();
          restoreTransport();
        };
        // Count in, then keep the click going so the hum lands on the beat grid. No backing tracks: the mic would hear them.
        engine.schedule([], bpm);
        engine.setMetronome(true);
        const counted = await engine.countIn(bpm, setCountInBeat);
        setCountInBeat(null);
        if (!counted || done) throw new Error("count-in cancelled");
        originSec = engine.nowSec() + mic.outputLatencySec;
        engine.play();
      }
      setPhase("recording");
    } catch (e) {
      stopRef.current?.();
      stopRef.current = null;
      restoreCleared();
      setPhase("error");
      setError(e instanceof Error && e.message === "count-in cancelled" ? "Recording was cancelled." : micErrorMessage(e));
    }
    // Stop button finishes with the live array.
    stopTake.current = () => {
      if (done) return; // a double-click or the time limit already finished this take
      done = true;
      void finish(taken);
    };
  }

  /** A wrong key guess is one pick away: chords re-picked from the melody, every pitched part refitted. */
  function changeKey(value: string) {
    const [tonic, mode] = value.split(" ");
    const key = { tonic: Number(tonic), mode: mode as Mode };
    keyOverrideRef.current = key;
    snapSourceNotesRef.current = {};
    const h = withKey(key, tracks.find((t) => t.instrument.id === "melody")?.notes ?? []);
    setHarmony(h);
    setTracks((ts) => ts.map((t) => refit(t, h)));
  }

  /** A hand edit replaces the part's notes; an edited Sample is the user's part from then on. */
  function editNotes(id: string, notes: Note[]) {
    delete sensitivityFramesRef.current[id];
    snapSourceNotesRef.current[id] = notes.map((note) => ({ ...note }));
    setSensitivityNotes((previous) => {
      if (!previous[id]) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setTracks((ts) => ts.map((t) => (t.instrument.id === id ? { ...t, notes, sample: false } : t)));
  }

  /** Swap a cached profile and refit dependent parts if its inferred song harmony changed. */
  function updateDisplayedNotes(level: NoteSensitivity, variantsById = sensitivityNotes, snapUncaptured?: QuantizeDivision) {
    const melodyVariant = variantsById.melody?.[level];
    const melodyNotes = melodyVariant ?? tracks.find((track) => track.instrument.id === "melody")?.notes ?? [];
    const keysVariant = variantsById.keys?.[level];
    const nextHarmony = keyOverrideRef.current
      ? withKey(keyOverrideRef.current, melodyNotes)
      : harmonyDriverRef.current === "melody" && melodyVariant
        ? inferHarmony(melodyVariant)
        : harmonyDriverRef.current === "keys" && keysVariant
          ? chordsFromVoicing(keysVariant, harmony)
          : harmony;
    const harmonyChanged = !sameHarmony(nextHarmony, harmony);
    if (harmonyChanged) snapSourceNotesRef.current = {};
    setHarmony(nextHarmony);
    setTracks((current) => current.map((track) => {
      const variant = variantsById[track.instrument.id]?.[level];
      if (variant) {
        const nextTrack = { ...track, notes: variant, sample: false };
        if (track.instrument.id === "melody" || track.instrument.kind === "drums" ||
          (track.instrument.id === "keys" && harmonyDriverRef.current === "keys" && !keyOverrideRef.current)) return nextTrack;
        return refit(nextTrack, nextHarmony);
      }
      const fitted = harmonyChanged ? refit(track, nextHarmony) : track;
      if (snapUncaptured) {
        const source = snapSourceNotesRef.current[track.instrument.id] ?? fitted.notes.map((note) => ({ ...note }));
        snapSourceNotesRef.current[track.instrument.id] = source;
        return { ...fitted, notes: snapNotesToGrid(track.instrument, source, snapUncaptured) };
      }
      return fitted;
    }));
  }

  function selectSensitivity(level: NoteSensitivity) {
    setSensitivity(level);
    updateDisplayedNotes(level);
  }

  /** Rebuild all cached profiles from analysis frames, then commit notes immediately on the new grid. */
  function selectQuantize(division: QuantizeDivision) {
    setQuantize(division);
    const nextVariants = { ...sensitivityNotes };
    for (const [id, capturedFrames] of Object.entries(sensitivityFramesRef.current)) {
      const instrument = tracks.find((track) => track.instrument.id === id)?.instrument;
      if (!instrument) continue;
      nextVariants[id] = generateTrackVariants(instrument, capturedFrames, bpm, division, harmony, sensitivity);
    }
    setSensitivityNotes(nextVariants);
    updateDisplayedNotes(sensitivity, nextVariants, division);
  }

  function toggle(id: string, key: "muted" | "solo") {
    setTracks((ts) => ts.map((t) => (t.instrument.id === id ? { ...t, [key]: !t[key] } : t)));
  }

  const noteLabel = (m: number) => `${midiName(m).replace(/-?\d+$/, "")} ${solfege(m, harmony) ?? ""}`;

  const rowH = (id: string) => {
    if (!zoomedId) return Math.max(56, avail / tracks.length);
    return id === zoomedId ? Math.max(240, avail - COLLAPSED_H * (tracks.length - 1)) : COLLAPSED_H;
  };

  return (
    <div className={`studio${zoomedId ? " is-zoomed" : ""}`}>
      <header className="transport">
        <h1 className="wordmark">
          <span>Hum</span>Studio
        </h1>
        <div className="transport-group">
          <button className="t-btn" onClick={rewind} disabled={busy} aria-label="Back to start">
            <RewindIcon />
          </button>
          <button className={`t-btn play${playing ? " on" : ""}`} onClick={togglePlay} disabled={busy} aria-label={startingAudio ? "Starting audio" : playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="t-btn" onClick={stopPlayback} disabled={busy && !startingAudio} aria-label="Stop">
            <StopIcon />
          </button>
          <button className={metronome ? "t-btn play" : "t-btn"} aria-label="Metronome" title="Metronome" aria-pressed={metronome} disabled={busy} onClick={() => {
            playback.getEngine()?.setMetronome(!metronome);
            setMetronome(!metronome);
          }}>M</button>
          <button className={countIn ? "t-btn play" : "t-btn"} aria-label="Four-beat count-in" title="Four-beat count-in before playback" aria-pressed={countIn} disabled={busy} onClick={() => setCountIn(!countIn)}>4</button>
          <button className={learn ? "t-btn learn play" : "t-btn learn"} title="Learn: chords and scale degrees" aria-pressed={learn} onClick={() => setLearn(!learn)}>Learn</button>
          <output ref={posRef} className="position" aria-label="Position, bar.beat.sixteenth">
            1.1.1
          </output>
        </div>
        <label className="field">
          <span>BPM</span>
          <input
            type="number"
            min={60}
            max={180}
            value={bpm}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v)) setBpm(Math.min(180, Math.max(60, Math.round(v))));
            }}
          />
        </label>
        <div className="field harmony-field" title={`Song chords, one per bar: ${harmonyLabel(harmony)}. A Melody take sets them; pick a key to override.`}>
          <span>Key</span>
          <select aria-label="Song key" value={`${harmony.tonic} ${harmony.mode}`} disabled={busy} onChange={(e) => changeKey(e.target.value)}>
            {KEYS.map((k) => (
              <option key={`${k.tonic} ${k.mode}`} value={`${k.tonic} ${k.mode}`}>{keyName(k)}</option>
            ))}
          </select>
          <output className="position harmony-value" aria-label="Song chords" aria-live="polite">{harmony.bars.slice(0, 4).map(chordName).join(" ")}</output>
        </div>
        <label className="field">
          <span>Snap</span>
          <select value={quantize} onChange={(e) => selectQuantize(e.target.value as QuantizeDivision)} disabled={busy}>
            <option value="off">Off</option>
            <option value="1/4">1/4</option>
            <option value="1/8">1/8</option>
            <option value="1/16">1/16</option>
          </select>
        </label>
        <label className="field sensitivity-field" title={`${NOTE_SENSITIVITY_PRESETS[sensitivity].description} Each take generates all three versions for immediate switching.`}>
          <span>Sensitivity</span>
          <select aria-label="Note sensitivity" value={sensitivity} disabled={busy} onChange={(event) => {
            if (isNoteSensitivity(event.target.value)) selectSensitivity(event.target.value);
          }}>
            {NOTE_SENSITIVITY_LEVELS.map((level) => (
              <option key={level} value={level}>{NOTE_SENSITIVITY_PRESETS[level].label}</option>
            ))}
          </select>
        </label>
        <button className="export" aria-label="Export MIDI" onClick={() => exportMidi(tracks, bpm)} disabled={busy || tracks.every((t) => !t.notes.length)}>
          <DownloadIcon /> <span className="lbl">Export MIDI</span>
        </button>
      </header>

      {playbackError && <p role="alert">{playbackError}</p>}
      {Object.values(presetStatuses).some(status => status.state === "loading") && (
        <p className="sound-notice" role="status">Loading selected sounds…</p>
      )}
      {Object.values(presetStatuses).filter(status => status.state === "fallback").map(status => (
        <p key={status.trackId} className="sound-notice" role="status">{status.message}</p>
      ))}
      {countInBeat !== null && <p role="status" aria-live="polite">Count-in: {countInBeat}</p>}

      <div className="ruler-row">
        <div className="ruler-corner">{!zoomed
            ? `${tracks.length} tracks`
            : zoomed.instrument.kind === "drums"
              ? "Kit"
              : `${midiName(zoomed.instrument.lo)}–${midiName(zoomed.instrument.hi)}`}</div>
        <div className="ruler" aria-hidden>
          {Array.from({ length: TOTAL_BEATS / 4 }, (_, i) => (
            <span key={i} style={{ left: `${beatX(i * 4)}%` }}>
              {i + 1}
            </span>
          ))}
        </div>
      </div>

      <div className="rows" ref={rowsRef} style={{ gridTemplateRows: tracks.map((t) => `${rowH(t.instrument.id)}px`).join(" ") }}>
        {tracks.map((t) => (
          <TrackRow
            key={t.instrument.id}
            track={t}
            zoomed={t.instrument.id === zoomedId}
            collapsed={!!zoomedId && t.instrument.id !== zoomedId}
            busy={busy}
            phase={phase}
            error={error}
            frames={frames}
            reveal={reveal}
            noteLabel={learn ? noteLabel : undefined}
            learn={learn}
            harmony={harmony}
            quantize={quantize}
            onEditNotes={(notes) => editNotes(t.instrument.id, notes)}
            demo={demo}
            bpm={bpm}
            countIn={t.instrument.id === zoomedId ? countInBeat : null}
            presetStatus={presetStatuses[t.instrument.id]}
            onPresetChange={id => { void changePreset(t.instrument.id, id); }}
            onOpen={() => open(t.instrument.id)}
            onBack={back}
            onRecord={record}
            onStop={() => stopTake.current()}
            onToggle={(k) => toggle(t.instrument.id, k)}
          />
        ))}
        <div className="playhead-track" aria-hidden>
          <div className="playhead" ref={headRef} />
        </div>
      </div>
    </div>
  );
}
