"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { generateTrack } from "@/lib/generate";
import { type HumFrame, type StopFn, micErrorMessage, startDemoHum, startMic } from "@/lib/hum";
import { exportMidi } from "@/lib/midi";
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
import { DownloadIcon, PlayIcon, RewindIcon, StopIcon } from "./icons";
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
  const [bpm, setBpm] = useState(100);
  const [quantize, setQuantize] = useState<QuantizeDivision>("1/8");
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [frames, setFrames] = useState<HumFrame[]>([]);
  const [pending, setPending] = useState<Note[]>([]);
  const [demo, setDemo] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [avail, setAvail] = useState(0);

  const rowsRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<HTMLOutputElement>(null);
  const stopRef = useRef<StopFn | null>(null);
  const audioReady = useRef(false);
  const stopTake = useRef<() => void>(() => {});

  const busy = phase === "requesting" || phase === "recording" || phase === "generating" || phase === "revealing";
  const zoomed = tracks.find((t) => t.instrument.id === zoomedId) ?? null;

  useLayoutEffect(() => {
    const el = rowsRef.current!;
    const ro = new ResizeObserver(() => setAvail(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the transport in sync with notes, mutes and tempo.
  useEffect(() => {
    if (audioReady.current) playback.schedule(tracks, bpm);
  }, [tracks, bpm]);

  // Playhead + position readout run outside React.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const beat = playback.positionBeats() % TOTAL_BEATS;
      if (headRef.current) headRef.current.style.left = `${beatX(beat)}%`;
      if (posRef.current) posRef.current.textContent = readout(beat);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Release the mic if the page goes away mid-take.
  useEffect(() => () => stopRef.current?.(), []);

  const setPos = (beat: number) => {
    if (headRef.current) headRef.current.style.left = `${beatX(beat)}%`;
    if (posRef.current) posRef.current.textContent = readout(beat);
  };

  async function togglePlay() {
    if (playing) {
      playback.stop();
      setPlaying(false);
      return;
    }
    await playback.ensureAudio();
    audioReady.current = true;
    playback.schedule(tracks, bpm);
    playback.play();
    setPlaying(true);
  }

  function rewind() {
    playback.rewind();
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
        const notes = await generateTrack(zoomed.instrument, taken, bpm, quantize);
        clearInterval(timer);
        if (!notes.length) throw new Error("empty");
        setPending(notes);
        setPhase("revealing");
        const ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : (REVEAL_SEC + 0.5) * 1000;
        setTimeout(() => {
          const id = zoomed.instrument.id;
          setTracks((ts) => ts.map((t) => (t.instrument.id === id ? { ...t, notes, sample: false } : t)));
          setPhase("done");
        }, ms);
      } catch {
        clearInterval(timer);
        setPhase("error"); // existing notes are untouched
        setError("No notes came out of that take. Try a longer, steadier hum.");
      }
    },
    [zoomed, bpm, quantize],
  );

  async function record(useDemo: boolean) {
    if (!zoomed || busy) return;
    if (playing) {
      playback.stop();
      setPlaying(false);
    }
    const taken: HumFrame[] = [];
    setFrames(taken);
    setDemo(useDemo);
    setElapsed(0);
    setError("");
    const limitSec = Math.min(MAX_RECORD_SEC, (TOTAL_BEATS * 60) / bpm);
    let done = false;
    const onFrame = (f: HumFrame) => {
      if (done) return;
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
        stopRef.current = await startMic(onFrame);
      }
      setPhase("recording");
    } catch (e) {
      setPhase("error");
      setError(micErrorMessage(e));
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
          <button className="t-btn" onClick={rewind} aria-label="Back to start">
            <RewindIcon />
          </button>
          <button className={`t-btn play${playing ? " on" : ""}`} onClick={togglePlay} disabled={busy} aria-label={playing ? "Stop" : "Play"}>
            {playing ? <StopIcon /> : <PlayIcon />}
          </button>
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
