"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { generateTrack } from "@/lib/generate";
import { type HumFrame, micErrorMessage, startDemoHum, startMic } from "@/lib/hum";
import { exportMidi } from "@/lib/midi";
import { DEFAULT_HARMONY, fitToHarmony, harmonyLabel, inferHarmony, voiceChords } from "@/lib/music/harmony";
import * as playback from "@/lib/playback";
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

function readout(beat: number) {
  const bar = Math.floor(beat / 4) + 1;
  const b = Math.floor(beat % 4) + 1;
  const s = Math.floor((beat % 1) * 4) + 1;
  return `${bar}.${b}.${s}`;
}

export default function Studio() {
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [harmony, setHarmony] = useState(DEFAULT_HARMONY);
  const [bpm, setBpm] = useState(120);
  const [quantize, setQuantize] = useState<QuantizeDivision>("1/16");
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
      const engine = await playback.ensureAudio();
      if (request !== playbackRequest.current) return;
      const current = arrangementRef.current;
      engine.schedule(current.tracks, current.bpm);
      engine.setMetronome(metronome);
      if (countIn) {
        const completed = await engine.countIn(current.bpm, setCountInBeat);
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
      if (taken.filter((f) => f.hz).length < 10) {
        setPhase("error");
        setError("We didn't catch a hum. Get closer to the mic and try again.");
        return;
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
          // A Melody take sets the song's chords; other pitched parts are re-fitted (moved, never deleted).
          const h = id === "melody" ? inferHarmony(notes) : null;
          if (h) setHarmony(h);
          setTracks((ts) =>
            ts.map((t) => {
              if (t.instrument.id === id) return { ...t, notes, sample: false };
              if (!h || t.instrument.kind === "drums") return t;
              return { ...t, notes: t.sample ? voiceChords(h) : fitToHarmony(t.notes, t.instrument, h) };
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
    let capturing = useDemo; // the mic opens before the count-in; its frames are dropped until counting ends
    let offsetSec: number | null = useDemo ? 0 : null;
    const onFrame = (raw: HumFrame) => {
      if (done || !capturing) return;
      offsetSec ??= raw.tSec; // first captured frame is t=0
      const f = offsetSec ? { ...raw, tSec: raw.tSec - offsetSec } : raw;
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
        const stopMic = await startMic(onFrame);
        stopRef.current = () => {
          done = true;
          stopMic();
          restoreTransport();
        };
        // Count in, then keep the click going so the hum lands on the beat grid. No backing tracks: the mic would hear them.
        const engine = await playback.ensureAudio();
        engine.schedule([], bpm);
        engine.setMetronome(true);
        const counted = await engine.countIn(bpm, setCountInBeat);
        setCountInBeat(null);
        if (!counted || done) throw new Error("count-in cancelled");
        capturing = true;
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
      done = true;
      void finish(taken);
    };
  }

  function toggle(id: string, key: "muted" | "solo") {
    setTracks((ts) => ts.map((t) => (t.instrument.id === id ? { ...t, [key]: !t[key] } : t)));
  }

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
        <div className="field harmony-field" title={`Song chords, one per bar: ${harmonyLabel(harmony)}. A Melody take sets them.`}>
          <span>Key</span>
          <output className="position harmony-value" aria-label="Song key and chords" aria-live="polite">{harmonyLabel(harmony, 4)}</output>
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
            pending={pending}
            demo={demo}
            elapsed={elapsed}
            stage={stage}
            bpm={bpm}
            countIn={t.instrument.id === zoomedId ? countInBeat : null}
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
