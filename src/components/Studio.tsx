"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { generateTrack } from "@/lib/generate";
import { type HumFrame, micErrorMessage, startDemoHum, startMic } from "@/lib/hum";
import { exportMidi } from "@/lib/midi";
import {
  DEFAULT_HARMONY,
  type Harmony,
  KEYS,
  type Mode,
  chordName,
  chordsFromVoicing,
  fitToHarmony,
  harmonyLabel,
  inferHarmony,
  keyName,
  romanNumeral,
  scaleDegree,
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
import TrackRow, { type Phase, REVEAL_SEC } from "./TrackRow";

const COLLAPSED_H = 36;

/** Move a part onto new harmony without deleting notes: the Keys sample is re-voiced, drums stay put. */
const refit = (t: Track, h: Harmony): Track =>
  t.instrument.kind === "drums" ? t : { ...t, notes: t.sample ? voiceChords(h) : fitToHarmony(t.notes, t.instrument, h) };

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
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [frames, setFrames] = useState<HumFrame[]>([]);
  const [pending, setPending] = useState<Note[]>([]);
  const [demo, setDemo] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState(0);
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
      setStage(0);
      const timer = setInterval(() => setStage((s) => Math.min(2, s + 1)), 800);
      try {
        const notes = await generateTrack(zoomed.instrument, taken, bpm, quantize, harmony);
        clearInterval(timer);
        if (!notes.length) throw new Error("empty");
        setPending(notes);
        setPhase("revealing");
        const ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : (REVEAL_SEC + 0.5) * 1000;
        setTimeout(() => {
          const id = zoomed.instrument.id;
          // A Melody take sets the key and chords, a Keys take re-picks the chords; other pitched parts
          // are re-fitted (moved, never deleted).
          const h = id === "melody" ? inferHarmony(notes) : id === "keys" ? chordsFromVoicing(notes, harmony) : null;
          if (h) setHarmony(h);
          setTracks((ts) =>
            ts.map((t) => {
              if (t.instrument.id === id) return { ...t, notes, sample: false };
              return h ? refit(t, h) : t;
            }),
          );
          setPhase("done");
        }, ms);
      } catch {
        clearInterval(timer);
        setPhase("error"); // existing notes are untouched
        setError("No notes came out of that take. Try a longer, steadier hum.");
      }
    },
    [zoomed, bpm, quantize, harmony],
  );

  async function record(useDemo: boolean) {
    if (!zoomed || busy) return;
    pauseIfPlaying();
    const taken: HumFrame[] = [];
    setFrames(taken);
    setDemo(useDemo);
    setElapsed(0);
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
      if (Math.floor(f.tSec * 10) !== Math.floor((taken.at(-2)?.tSec ?? -1) * 10)) setElapsed(f.tSec);
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
    const h = withKey({ tonic: Number(tonic), mode: mode as Mode }, tracks.find((t) => t.instrument.id === "melody")?.notes ?? []);
    setHarmony(h);
    setTracks((ts) => ts.map((t) => refit(t, h)));
  }

  function toggle(id: string, key: "muted" | "solo") {
    setTracks((ts) => ts.map((t) => (t.instrument.id === id ? { ...t, [key]: !t[key] } : t)));
  }

  const noteLabel = (m: number) => `${midiName(m).replace(/-?\d+$/, "")} ${scaleDegree(m, harmony) ?? "·"}`;

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
          <select value={quantize} onChange={(e) => setQuantize(e.target.value as QuantizeDivision)} disabled={busy}>
            <option value="off">Off</option>
            <option value="1/4">1/4</option>
            <option value="1/8">1/8</option>
            <option value="1/16">1/16</option>
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

      {learn && (
        <section className="chord-row" aria-label="Song theory">
          <div className="ruler-corner chord-corner">{keyName(harmony)}</div>
          <ol className="chord-strip">
            {harmony.bars.map((c, bar) => (
              <li key={bar} className="chord-cell" style={{ left: `${beatX(bar * 4)}%` }}>
                <b>{chordName(c)}</b> <span>{romanNumeral(c, harmony)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

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
            pending={pending}
            noteLabel={learn ? noteLabel : undefined}
            demo={demo}
            elapsed={elapsed}
            stage={stage}
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
