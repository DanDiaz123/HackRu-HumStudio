"use client";

import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { hzToMidi } from "@/lib/generate";
import type { HumFrame } from "@/lib/hum";
import { type Harmony, chordName, keyName, romanNumeral, scaleDegree, solfege } from "@/lib/music/harmony";
import { presetForTrack, presetsForTrack } from "@/lib/audio/instrument-presets";
import { addNote, moveNote, resizeNote } from "@/lib/note-edit";
import type { PresetStatus } from "@/lib/audio/preset-manager";
import {
  DRUM_ROWS,
  DRUM_PARTS,
  drumPart,
  type DrumPart,
  type Instrument,
  type Note,
  QUANT_BEATS,
  type QuantizeDivision,
  TOTAL_BEATS,
  type Track,
  beatX,
  midiName,
  noteH,
  noteId,
  noteRow,
  noteY,
  pitchRows,
  rowMidi,
} from "@/lib/tracks";
import { BackIcon, MicIcon, RecordIcon, StopIcon } from "./icons";
import Spectrogram from "./Spectrogram";

export type Phase = "idle" | "requesting" | "recording" | "generating" | "revealing" | "done" | "error";

export const REVEAL_SEC = 1.6;

/** The generation sequence, built from what the pipeline actually produced (see Studio finish()). */
export interface Reveal {
  step: number;
  raw: Note[]; // hummed notes in beats, before fitting and snapping
  final: Note[];
  harmony: Harmony; // the song's harmony once this take lands
  steps: { title: string; sub: string }[];
}

/** What each part does in the arrangement (Learn). Mirrors fitToHarmony and the role shaping in generate.ts. */
const ROLE: Record<string, string> = {
  melody: "Sets the key and chords",
  bass: "Root or fifth of each chord",
  keys: "One chord per bar",
  strings: "Held chord tones",
  drums: "Kick, snare, hats",
};

interface Props {
  track: Track;
  zoomed: boolean;
  collapsed: boolean;
  busy: boolean;
  phase: Phase;
  error: string;
  frames: HumFrame[];
  reveal: Reveal | null;
  /** Learn mode: text set inside each note bar of the zoomed lane. */
  noteLabel?: (midi: number) => string;
  learn: boolean;
  harmony: Harmony;
  quantize: QuantizeDivision;
  onEditNotes: (notes: Note[]) => void;
  onClear: () => void;
  onRepeat: () => void;
  demo: boolean;
  bpm: number;
  countIn: number | null;
  presetStatus?: PresetStatus;
  onPresetChange: (presetId: string) => void;
  onOpen: () => void;
  onBack: () => void;
  onRecord: (demo: boolean) => void;
  onStop: () => void;
  onToggle: (key: "muted" | "solo") => void;
  onDrumPartChange: (part: DrumPart) => void;
}

const lastBeat = (notes: Note[]) => Math.max(1, ...notes.map((n) => n.startBeat + n.durationBeats));

function NoteBars({ notes, inst, reveal, label, cls }: { notes: Note[]; inst: Instrument; reveal?: boolean; label?: (midi: number) => string; cls?: (n: Note) => string }) {
  const h = noteH(inst);
  const end = lastBeat(notes);
  return notes.map((n) => (
    <span
      key={n.id}
      className={cls ? cls(n) : reveal ? "note set" : "note"}
      style={
        {
          left: `${beatX(n.startBeat)}%`,
          width: `${beatX(n.durationBeats)}%`,
          top: `${noteY(n.midi, inst)}%`,
          height: `${h}%`,
          "--d": `${(n.startBeat / end) * REVEAL_SEC}s`,
        } as CSSProperties
      }
    >
      {label && <span className="note-label">{label(n.midi)}</span>}
    </span>
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
    <div className="pitch-labels" aria-hidden style={{ "--rows": pitchRows(inst) } as CSSProperties}>
      {labels.map((l) => (
        <span key={l.midi} style={{ top: `${noteY(l.midi, inst)}%`, height: `${noteH(inst)}%` }}>
          <b>{l.text}</b>
        </span>
      ))}
    </div>
  );
}

function fmt(sec: number) {
  return `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;
}

/** Calls `paint` with the newest frame once per animation frame that has one: live readouts stay out of React. */
function useLatestFrame(frames: HumFrame[], paint: (f: HumFrame) => void) {
  const paintRef = useRef(paint);
  useEffect(() => {
    paintRef.current = paint;
  });
  useEffect(() => {
    let raf = 0;
    let seen = 0;
    const tick = () => {
      if (frames.length !== seen) {
        seen = frames.length;
        paintRef.current(frames[seen - 1]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frames]);
}

function LiveClock({ frames }: { frames: HumFrame[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLatestFrame(frames, (f) => {
    if (ref.current) ref.current.textContent = fmt(f.tSec);
  });
  return <span ref={ref}>{fmt(0)}</span>;
}

/** Learn: the pitch being hummed right now, its scale degree, and how far it sits from the nearest semitone. */
function LivePitch({ frames, harmony }: { frames: HumFrame[]; harmony: Harmony }) {
  const name = useRef<HTMLElement>(null);
  const info = useRef<HTMLSpanElement>(null);
  const needle = useRef<HTMLSpanElement>(null);
  useLatestFrame(frames, (f) => {
    if (!name.current || !info.current || !needle.current) return;
    if (f.hz === null) {
      name.current.textContent = "–";
      info.current.textContent = "no pitch";
      needle.current.style.opacity = "0";
      return;
    }
    const m = hzToMidi(f.hz);
    const r = Math.round(m);
    const cents = Math.round((m - r) * 100);
    const deg = scaleDegree(r, harmony);
    const syl = solfege(r, harmony);
    name.current.textContent = midiName(r);
    info.current.textContent = `${deg ? `${syl} · degree ${deg}` : "outside the key"} · ${cents > 0 ? "+" : ""}${cents}¢`;
    needle.current.style.opacity = "1";
    needle.current.style.left = `${50 + cents}%`;
  });
  return (
    <div className="live-pitch" aria-hidden>
      <b ref={name}>–</b>
      <span ref={info}>listening</span>
      <span className="tune">
        <span ref={needle} className="needle" />
      </span>
    </div>
  );
}

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; y0: number; grab: number; orig: Note; draft: Note; moved: boolean };

/** The zoomed lane's notes, editable: drag to move, drag either edge to stretch, click empty space to add,
 * double-click or Delete to remove, arrows to nudge (Shift stretches). Notes on one pitch never overlap:
 * a move onto another note slides to the nearest free spot (or stays put), a stretch stops at the neighbour.
 * Drag state stays here; Studio gets one commit per edit. */
function EditableNotes(p: {
  notes: Note[];
  inst: Instrument;
  quantize: QuantizeDivision;
  label?: (midi: number) => string;
  disabled: boolean;
  onEdit: (notes: Note[]) => void;
}) {
  const { notes, inst } = p;
  const area = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const step = QUANT_BEATS[p.quantize] || 0.05; // Off: free timing, rounded only to remove float noise
  const minLen = QUANT_BEATS[p.quantize] || 0.25;
  const snap = (b: number) => Math.round(b / step) * step;
  const at = (e: { clientX: number; clientY: number }) => {
    const r = area.current!.getBoundingClientRect();
    return { beat: ((e.clientX - r.left) / r.width) * TOTAL_BEATS, row: ((e.clientY - r.top) / r.height) * pitchRows(inst) };
  };
  const replace = (n: Note) => p.onEdit(notes.map((x) => (x.id === n.id ? n : x)));
  const remove = (n: Note) => p.onEdit(notes.filter((x) => x.id !== n.id));

  function grab(e: PointerEvent, n: Note, mode: Drag["mode"]) {
    if (p.disabled || e.button) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: n.id, mode, x0: e.clientX, y0: e.clientY, grab: at(e).beat - n.startBeat, orig: n, draft: n, moved: false });
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 3;
    const { beat, row } = at(e);
    const o = drag.orig;
    const draft =
      drag.mode === "move" ? moveNote(o, { startBeat: snap(beat - drag.grab), midi: rowMidi(row, inst) }, notes, step) ?? drag.draft
      : resizeNote(o, drag.mode, snap(beat), notes, minLen);
    setDrag({ ...drag, moved, draft });
  }
  function drop() {
    if (drag?.moved) replace(drag.draft);
    setDrag(null);
  }
  function add(e: PointerEvent) {
    if (p.disabled || e.button || e.target !== e.currentTarget) return;
    const { beat, row } = at(e);
    const n = addNote({ id: noteId(), midi: rowMidi(row, inst), startBeat: Math.min(TOTAL_BEATS - minLen, Math.floor(beat / step) * step), durationBeats: minLen, velocity: 0.8 }, notes, minLen);
    if (n) p.onEdit([...notes, n]);
  }
  function key(e: KeyboardEvent, n: Note) {
    if (p.disabled) return;
    const nudge = QUANT_BEATS[p.quantize] || 0.25;
    if (e.key === "Delete" || e.key === "Backspace") {
      remove(n);
      area.current?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const d = e.key === "ArrowLeft" ? -nudge : nudge;
      const next = e.shiftKey
        ? resizeNote(n, "end", n.startBeat + n.durationBeats + d, notes, minLen)
        : moveNote(n, { startBeat: n.startBeat + d, midi: n.midi }, notes, nudge, 0);
      if (next) replace(next);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const next = moveNote(n, { startBeat: n.startBeat, midi: rowMidi(noteRow(n.midi, inst) + (e.key === "ArrowUp" ? -1 : 1), inst) }, notes, nudge, 0);
      if (next) replace(next);
    } else if (e.key === "Escape" && drag) {
      setDrag(null);
      e.stopPropagation();
    } else return;
    e.preventDefault();
  }

  const h = noteH(inst);
  const pitchName = (m: number) => (inst.kind === "drums" ? (DRUM_ROWS.find((r) => r.midi === m)?.name ?? midiName(m)) : midiName(m));
  return (
    <div
      ref={area}
      className={`notes-area editable${p.disabled ? "" : " on"}`}
      tabIndex={-1}
      onPointerDown={add}
      onPointerMove={move}
      onPointerUp={drop}
      onPointerCancel={() => setDrag(null)}
    >
      {notes.map((stored) => {
        const n = drag?.id === stored.id ? drag.draft : stored;
        const beats = +n.durationBeats.toFixed(2);
        return (
          <span
            key={n.id}
            className={`note${drag?.id === n.id && drag.moved ? " dragging" : ""}`}
            role="button"
            tabIndex={p.disabled ? -1 : 0}
            aria-label={`${pitchName(n.midi)}, beat ${+(n.startBeat + 1).toFixed(2)}, ${beats} beat${beats === 1 ? "" : "s"}`}
            style={{ left: `${beatX(n.startBeat)}%`, width: `${beatX(n.durationBeats)}%`, top: `${noteY(n.midi, inst)}%`, height: `${h}%` }}
            onPointerDown={(e) => grab(e, stored, "move")}
            onDoubleClick={() => !p.disabled && remove(stored)}
            onKeyDown={(e) => key(e, stored)}
          >
            {p.label && <span className="note-label">{p.label(n.midi)}</span>}
            {!p.disabled && (
              <>
                <span className="note-edge start" onPointerDown={(e) => grab(e, stored, "start")} />
                <span className="note-edge" onPointerDown={(e) => grab(e, stored, "end")} />
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Learn: each bar's chord along the top of the zoomed lane; Studio lights the one under the playhead. */
function LaneChords({ harmony, stamp }: { harmony: Harmony; stamp?: boolean }) {
  return (
    <ol className={`lane-chords${stamp ? " stamp" : ""}`} aria-label={`Chords in ${keyName(harmony)}`}>
      {harmony.bars.map((c, bar) => (
        <li key={bar} style={{ left: `${beatX(bar * 4)}%`, "--d": `${bar * 60}ms` } as CSSProperties}>
          <b>{chordName(c)}</b> <span>{romanNumeral(c, harmony)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The take setting in: hummed notes print in raw (step 0), then slide to their fitted, snapped places. */
function RevealNotes({ r, inst }: { r: Reveal; inst: Instrument }) {
  const finalIds = new Set(r.final.map((n) => n.id));
  const rawIds = new Set(r.raw.map((n) => n.id));
  // Same two lists every step, so notes keep their elements and CSS transitions carry them to the grid.
  const main = r.step === 0 ? r.raw : r.final;
  const gone = r.step === 0 ? [] : r.raw.filter((n) => !finalIds.has(n.id));
  return (
    <>
      <NoteBars notes={main} inst={inst} cls={(n) => (r.step === 0 ? "note raw set" : rawIds.has(n.id) ? "note snap" : "note snap set")} />
      <NoteBars notes={gone} inst={inst} cls={() => "note snap gone"} />
    </>
  );
}

export default function TrackRow(p: Props) {
  const { track, zoomed, phase } = p;
  const inst = track.instrument;
  const name = inst.name;
  const preset = presetForTrack(inst.id, track.presetId);
  const soundStatus = p.presetStatus?.presetId === preset.id ? p.presetStatus : undefined;
  const selectedDrumPart = inst.kind === "drums" ? drumPart(track.drumPart) : null;
  const visibleNotes = zoomed && selectedDrumPart
    ? track.notes.filter((note) => note.midi === selectedDrumPart.midi)
    : track.notes;
  const hasNotes = visibleNotes.length > 0;
  const style = { "--flood": inst.color } as CSSProperties;
  const labels = inst.kind === "drums" ? undefined : p.noteLabel;
  const pitched = inst.kind !== "drums";

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
            {/* Disabled while busy: re-scheduling mid-take would play the backing tracks into the mic. */}
            <button aria-pressed={track.muted} aria-label={`Mute ${name}`} onClick={() => p.onToggle("muted")} disabled={p.busy}>M</button>
            <button aria-pressed={track.solo} aria-label={`Solo ${name}`} onClick={() => p.onToggle("solo")} disabled={p.busy}>S</button>
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
  const r = phase === "revealing" ? p.reveal : null;
  const step = r?.steps[Math.min(r.step, r.steps.length - 1)];
  const showSpec = (recording || p.frames.length > 0) && phase !== "idle" && phase !== "error" && phase !== "requesting";
  const status =
    p.countIn !== null ? `Count-in ${p.countIn}`
    : phase === "requesting" ? "Waiting for the microphone"
    : recording ? <>{p.demo ? "Demo hum" : "Recording"} <LiveClock frames={p.frames} /></>
    : phase === "generating" ? "Generating"
    : phase === "revealing" ? "Setting notes"
    : phase === "error" ? hasNotes ? `${track.notes.length} notes kept${track.sample ? " · Sample" : ""}` : "Not recorded"
    : hasNotes ? `${track.notes.length} notes${track.sample ? " · Sample" : ""}`
    : "Empty";

  return (
    <div className={`row zoomed phase-${phase}`} style={style}>
      <div className="head">
        <button className="back" onClick={p.onBack} disabled={recording || working || phase === "requesting"}>
          <BackIcon /> All tracks
        </button>
        <h2 className="big-name">{name}</h2>
        <div className="sound-field" data-sound-state={soundStatus?.state ?? "idle"}>
          <label htmlFor={`sound-${inst.id}`}>Sound</label>
          <select id={`sound-${inst.id}`} aria-label={`${name} sound`} title={preset.name}
            value={preset.id} disabled={p.busy} onChange={event => p.onPresetChange(event.target.value)}>
            {presetsForTrack(inst.id).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
          {selectedDrumPart && (
            <label className="drum-part-field">
              <span>Drum part</span>
              <select aria-label="Drum part" value={selectedDrumPart.id} disabled={p.busy}
                onChange={event => p.onDrumPartChange(event.target.value as DrumPart)}>
                {DRUM_PARTS.map(part => <option key={part.id} value={part.id}>{part.name}</option>)}
              </select>
            </label>
          )}
          {soundStatus?.state === "loading" && <p className="sound-feedback" role="status">Loading {preset.name}…</p>}
          {soundStatus?.state === "fallback" && (
            <div className="sound-feedback" role="alert">
              <p>{soundStatus.message}</p>
              <button className="sound-retry" disabled={p.busy} onClick={() => p.onPresetChange(preset.id)}>Retry sound</button>
            </div>
          )}
          <a className="sound-credits" href="/sound-credits.txt" target="_blank" rel="noopener noreferrer">Sound credits</a>
        </div>
        <p className="hint">{inst.hint}</p>
        {p.learn && (
          <dl className="theory">
            {pitched && (
              <div>
                <dt>Key</dt>
                <dd>{keyName(p.harmony)}</dd>
              </div>
            )}
            <div>
              <dt>Role</dt>
              <dd>{ROLE[inst.id]}</dd>
            </div>
          </dl>
        )}
        <div className="rec-controls">
          {working ? null : recording ? (
            <button className="rec on" onClick={p.onStop}>
              <StopIcon /> Stop
            </button>
          ) : (
            <button className="rec" onClick={() => p.onRecord(false)} disabled={phase === "requesting"}>
              <RecordIcon /> <span className="rec-label">{hasNotes && !track.sample ? "Re-record" : "Record"}</span>
            </button>
          )}
          {!recording && !working && (
            <button className="ghost-btn" onClick={() => p.onRecord(true)} disabled={phase === "requesting"}>
              Demo hum
            </button>
          )}
          {!recording && !working && (
            <div className="part-actions">
              <button className="ghost-btn" onClick={p.onRepeat} disabled={p.busy || !visibleNotes.some((n) => n.startBeat < TOTAL_BEATS / 2)}
                title="Copy bars 1-4 over bars 5-8">Repeat 1–4</button>
              <button className="ghost-btn" onClick={p.onClear} disabled={p.busy || !hasNotes} title="Remove every note in this part (undoable)">Clear</button>
            </div>
          )}
          <p className="status" aria-live="polite">
            <span className={`mark${recording ? " live" : ""}`} aria-hidden />
            {status}
          </p>
        </div>
      </div>
      <div className={`lane flood${labels ? " labeled" : ""}`}>
        <PitchLabels track={track} />
        {showSpec && (
          <div className={`spec-wrap${recording ? "" : phase === "generating" || r?.step === 0 ? " dim" : " ghost"}`}>
            <Spectrogram frames={p.frames} bpm={p.bpm} live={recording} inst={inst} />
          </div>
        )}
        {pitched && (r ? r.step >= 2 && <LaneChords harmony={r.harmony} stamp /> : p.learn && <LaneChords harmony={p.harmony} />)}
        {r ? (
          <div className="notes-area">
            <RevealNotes r={selectedDrumPart ? {
              ...r,
              raw: r.raw.filter(note => note.midi === selectedDrumPart.midi),
              final: r.final.filter(note => note.midi === selectedDrumPart.midi),
            } : r} inst={inst} />
          </div>
        ) : (
          !working && (
            <EditableNotes notes={visibleNotes} inst={inst} quantize={p.quantize} label={labels} disabled={p.busy} onEdit={p.onEditNotes} />
          )
        )}
        {recording && p.learn && pitched && <LivePitch frames={p.frames} harmony={p.harmony} />}
        {r && step && (
          <div className="generating" role="status" aria-live="polite">
            {r.step === 0 && <span className="sweep" style={{ "--end": `${beatX(lastBeat(r.raw))}%` } as CSSProperties} aria-hidden />}
            <p key={r.step} className="gen-title">{step.title}</p>
            <p className="gen-stage">{step.sub}</p>
          </div>
        )}
        {phase === "idle" && !hasNotes && (
          <div className="prompt">
            <MicIcon width={28} height={28} />
            <p>Hum the {name.toLowerCase()}</p>
          </div>
        )}
        {phase === "requesting" && (
          <div className="prompt">
            <p>{p.countIn !== null ? `Hum on the click · ${p.countIn}` : "Allow the microphone"}</p>
            <span>Headphones keep the click out of your take. Your audio stays in this tab.</span>
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
