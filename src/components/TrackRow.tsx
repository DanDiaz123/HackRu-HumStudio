"use client";

import type { CSSProperties } from "react";
import type { HumFrame } from "@/lib/hum";
import { DRUM_ROWS, type Instrument, type Note, type Track, beatX, midiName, noteH, noteY } from "@/lib/tracks";
import { BackIcon, MicIcon, RecordIcon, StopIcon } from "./icons";
import Spectrogram from "./Spectrogram";

export type Phase = "idle" | "requesting" | "recording" | "generating" | "revealing" | "done" | "error";

export const REVEAL_SEC = 1.6;
const STAGES = ["Listening back", "Finding the pitch", "Writing the part"];

interface Props {
  track: Track;
  zoomed: boolean;
  collapsed: boolean;
  busy: boolean;
  phase: Phase;
  error: string;
  frames: HumFrame[];
  pending: Note[];
  demo: boolean;
  elapsed: number;
  stage: number;
  bpm: number;
  onOpen: () => void;
  onBack: () => void;
  onRecord: (demo: boolean) => void;
  onStop: () => void;
  onToggle: (key: "muted" | "solo") => void;
}

const lastBeat = (notes: Note[]) => Math.max(1, ...notes.map((n) => n.startBeat + n.durationBeats));

function NoteBars({ notes, inst, reveal }: { notes: Note[]; inst: Instrument; reveal?: boolean }) {
  const h = noteH(inst);
  const end = lastBeat(notes);
  return notes.map((n) => (
    <span
      key={n.id}
      className={reveal ? "note set" : "note"}
      style={
        {
          left: `${beatX(n.startBeat)}%`,
          width: `${beatX(n.durationBeats)}%`,
          top: `${noteY(n.midi, inst)}%`,
          height: `${h}%`,
          "--d": `${(n.startBeat / end) * REVEAL_SEC}s`,
        } as CSSProperties
      }
    />
  ));
}

function PitchLabels({ track }: { track: Track }) {
  const inst = track.instrument;
  const labels =
    inst.kind === "drums"
      ? DRUM_ROWS.map((r) => ({ midi: r.midi, text: r.name }))
      : Array.from({ length: inst.hi - inst.lo + 1 }, (_, i) => inst.lo + i)
          .filter((m) => m % 12 === 0)
          .map((m) => ({ midi: m, text: midiName(m) }));
  return (
    <div className="pitch-labels" aria-hidden>
      {labels.map((l) => (
        <span key={l.midi} style={{ top: `${noteY(l.midi, inst)}%`, height: `${noteH(inst)}%` }}>
          {l.text}
        </span>
      ))}
    </div>
  );
}

function fmt(sec: number) {
  return `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;
}

export default function TrackRow(p: Props) {
  const { track, zoomed, phase } = p;
  const inst = track.instrument;
  const name = inst.name;
  const hasNotes = track.notes.length > 0;
  const style = { "--flood": inst.color } as CSSProperties;

  if (!zoomed) {
    const bars = track.notes.map((n) => Math.floor(n.startBeat / 4));
    const first = Math.min(...bars);
    const last = Math.max(...track.notes.map((n) => Math.ceil((n.startBeat + n.durationBeats) / 4)));
    const midis = track.notes.map((n) => n.midi);
    const fit = inst.kind === "drums" ? inst : { ...inst, lo: Math.min(...midis) - 1, hi: Math.max(...midis) + 1 };
    return (
      <div className={`row${p.collapsed ? " collapsed" : ""}`} style={style}>
        <div className="head">
          <button className="head-name" onClick={p.onOpen} disabled={p.busy}>
            {name}
          </button>
          <div className="ms">
            <button aria-pressed={track.muted} aria-label={`Mute ${name}`} onClick={() => p.onToggle("muted")}>M</button>
            <button aria-pressed={track.solo} aria-label={`Solo ${name}`} onClick={() => p.onToggle("solo")}>S</button>
          </div>
        </div>
        <button className="lane" onClick={p.onOpen} disabled={p.busy} aria-label={`Open ${name} track to record a hum`}>
          {hasNotes ? (
            <div className={`clip${track.sample ? " sample" : ""}`} style={{ left: `${beatX(first * 4)}%`, width: `${beatX((last - first) * 4)}%` }}>
              {!p.collapsed && <span className="clip-label">{track.sample ? `${name} · Sample` : name}</span>}
              <div className="clip-notes" style={{ left: `${-(first / (last - first)) * 100}%`, width: `${(8 / (last - first)) * 100}%` }}>
                <NoteBars notes={track.notes} inst={fit} />
              </div>
            </div>
          ) : (
            !p.collapsed && <span className="empty">Click to hum</span>
          )}
        </button>
      </div>
    );
  }

  const recording = phase === "recording";
  const working = phase === "generating" || phase === "revealing";
  const showSpec = p.frames.length > 0 && phase !== "idle" && phase !== "error" && phase !== "requesting";
  const status =
    phase === "requesting" ? "Waiting for the microphone"
    : recording ? `${p.demo ? "Demo hum" : "Recording"} ${fmt(p.elapsed)}`
    : phase === "generating" ? "Generating"
    : phase === "revealing" ? "Setting notes"
    : phase === "error" ? "Not recorded"
    : hasNotes ? `${track.notes.length} notes${track.sample ? " · Sample" : ""}`
    : "Empty";

  return (
    <div className={`row zoomed phase-${phase}`} style={style}>
      <div className="head">
        <button className="back" onClick={p.onBack} disabled={recording || working || phase === "requesting"}>
          <BackIcon /> All tracks
        </button>
        <h2 className="big-name">{name}</h2>
        <p className="hint">{inst.hint}</p>
        <div className="rec-controls">
          {working ? null : recording ? (
            <button className="rec on" onClick={p.onStop}>
              <StopIcon /> Stop
            </button>
          ) : (
            <button className="rec" onClick={() => p.onRecord(false)} disabled={phase === "requesting"}>
              <RecordIcon /> {hasNotes && !track.sample ? "Re-record" : "Record"}
            </button>
          )}
          {!recording && !working && (
            <button className="ghost-btn" onClick={() => p.onRecord(true)} disabled={phase === "requesting"}>
              Demo hum
            </button>
          )}
          <p className="status" aria-live="polite">
            <span className={`mark${recording ? " live" : ""}`} aria-hidden />
            {status}
          </p>
        </div>
      </div>
      <div className="lane flood">
        <PitchLabels track={track} />
        {showSpec && (
          <div className={`spec-wrap${recording ? "" : phase === "generating" ? " dim" : " ghost"}`}>
            <Spectrogram frames={p.frames} bpm={p.bpm} live={recording} inst={inst} />
          </div>
        )}
        <div className="notes-area">
          {phase === "revealing" ? (
            <NoteBars notes={p.pending} inst={inst} reveal />
          ) : (
            !working && <NoteBars notes={track.notes} inst={inst} />
          )}
        </div>
        {phase === "generating" && (
          <div className="generating" role="status" aria-live="polite">
            <span className="scan" aria-hidden />
            <p className="gen-title">Setting the session</p>
            <p className="gen-stage">{p.stage === 2 ? `Writing the ${name.toLowerCase()} part` : STAGES[p.stage]}</p>
          </div>
        )}
        {phase === "revealing" && (
          <span className="sweep" style={{ "--end": `${beatX(lastBeat(p.pending))}%` } as CSSProperties} aria-hidden />
        )}
        {phase === "idle" && !hasNotes && (
          <div className="prompt">
            <MicIcon width={28} height={28} />
            <p>Hum the {name.toLowerCase()}</p>
          </div>
        )}
        {phase === "requesting" && (
          <div className="prompt">
            <p>Allow the microphone</p>
            <span>Your audio stays in this tab.</span>
          </div>
        )}
        {phase === "error" && (
          <div className="prompt error" role="alert">
            <p>{p.error}</p>
            <div className="prompt-actions">
              <button className="rec" onClick={() => p.onRecord(false)}>
                <RecordIcon /> Try again
              </button>
              <button className="ghost-btn" onClick={() => p.onRecord(true)}>
                Use demo hum
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
