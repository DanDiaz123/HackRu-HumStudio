"use client";
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { addNote, moveNote, resizeNote } from "@/lib/note-edit";
import { createNoteClipboard, previewCopiedNotes, selectNotesInRect, type NoteClipboard, type RollPoint, type RollRect } from "@/lib/note-clipboard";
import { DRUM_ROWS, type Instrument, type Note, QUANT_BEATS, type QuantizeDivision, TOTAL_BEATS, beatX, midiName, noteH, noteId, noteRow, noteY, pitchRows, rowMidi } from "@/lib/tracks";

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; y0: number; grab: number; orig: Note; draft: Note; moved: boolean };
type CopyState = { mode: "armed" } | { mode: "selecting"; rect: RollRect; selected: Note[] } |
  { mode: "ready"; clipboard: NoteClipboard } |
  { mode: "pasting"; clipboard: NoteClipboard; grabBeat: number; anchorBeat: number };

/** The zoomed lane's notes, editable: drag to move, drag either edge to stretch, click empty space to add,
 * right-click, double-click or Delete to remove, arrows to nudge (Shift stretches). Notes on one pitch never overlap:
 * a move onto another note slides to the nearest free spot (or stays put), a stretch stops at the neighbour.
 * Drag state stays here; Studio gets one commit per edit. */
export default function EditableNotes(p: {
  notes: Note[];
  /** Visible unselected drum lanes: deletion is allowed, pitch/time edits are not. */
  backgroundNotes: Note[];
  selectedMidi?: number;
  inst: Instrument;
  quantize: QuantizeDivision;
  label?: (midi: number) => string;
  disabled: boolean;
  onEdit: (notes: Note[]) => void;
  onDelete: (noteId: string) => void;
  /** Full-track commit, including every visible drum row; returns rejection feedback without changing state. */
  onPaste: (clipboard: NoteClipboard, anchorBeat: number) => string | null;
  pasteBeat: () => number;
}) {
  const { notes, inst } = p;
  const area = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [copy, setCopy] = useState<CopyState | null>(null);
  const copyRef = useRef<CopyState | null>(null);
  const capturedPointer = useRef<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const keyboardRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  const releaseRef = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  const visible = [...p.backgroundNotes, ...notes];
  const updateCopy = (next: CopyState | null) => { copyRef.current = next; setCopy(next); };
  const releasePointer = () => {
    const id = capturedPointer.current;
    if (id !== null && area.current?.hasPointerCapture(id)) area.current.releasePointerCapture(id);
    capturedPointer.current = null;
  };
  const step = QUANT_BEATS[p.quantize] || 0.05; // Off: free timing, rounded only to remove float noise
  const minLen = QUANT_BEATS[p.quantize] || 0.25;
  const snap = (b: number) => Math.round(b / step) * step;
  const at = (e: { clientX: number; clientY: number }) => {
    const r = area.current!.getBoundingClientRect();
    return { beat: ((e.clientX - r.left) / r.width) * TOTAL_BEATS, row: ((e.clientY - r.top) / r.height) * pitchRows(inst) };
  };
  const within = (point: RollPoint): RollPoint => ({ beat: Math.max(0, Math.min(TOTAL_BEATS, point.beat)),
    row: Math.max(0, Math.min(pitchRows(inst), point.row)) });
  const selectedNotes = (rect: RollRect) => {
    const r = area.current!.getBoundingClientRect();
    return selectNotesInRect(visible, inst, rect, { beats: 2 * TOTAL_BEATS / r.width, rows: 5 * pitchRows(inst) / r.height });
  };
  function finishSelection() {
    const current = copyRef.current;
    if (current?.mode !== "selecting") return;
    const selected = current.selected;
    releasePointer();
    if (!selected.length) { updateCopy(null); setFeedback("No notes selected. Press Ctrl+C to try again."); return; }
    updateCopy({ mode: "ready", clipboard: createNoteClipboard(inst.id, selected) });
    setFeedback("Drag the highlighted group to paste. Ctrl+V pastes at the playhead. Escape cancels.");
  }
  function cancelCopy() {
    releasePointer(); updateCopy(null); setDrag(null); setFeedback("");
  }
  function startCopy(e: PointerEvent) {
    const current = copyRef.current;
    if (!current || p.disabled || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    area.current!.setPointerCapture(e.pointerId);
    capturedPointer.current = e.pointerId;
    const point = within(at(e));
    const selected = (e.target as HTMLElement).closest(".copy-selected,.copy-group");
    if (current.mode === "ready" && selected) {
      updateCopy({ mode: "pasting", clipboard: current.clipboard, grabBeat: at(e).beat, anchorBeat: current.clipboard.anchorBeat });
      setFeedback("Drop to paste the whole group. Escape cancels.");
    } else if (current.mode !== "pasting") {
      updateCopy({ mode: "selecting", rect: { from: point, to: point }, selected: [] });
      setFeedback("Drag to select notes to copy.");
    }
  }

  // Window listeners also work when the user opens a track without focusing an individual note.
  useEffect(() => {
    keyboardRef.current = event => {
      const target = event.target as HTMLElement | null;
      if (p.disabled || target?.closest("input,select,textarea,[contenteditable]:not([contenteditable=false])") || document.querySelector("dialog[open]")) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (event.repeat) return;
        releasePointer(); setDrag(null); updateCopy({ mode: "armed" });
        setFeedback("Drag to select notes to copy.");
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v") {
        const current = copyRef.current;
        if (current?.mode !== "ready" || event.repeat) return;
        event.preventDefault();
        const message = p.onPaste(current.clipboard, p.pasteBeat());
        setFeedback(message ?? "Copied notes pasted. Drag the group or press Ctrl+V to paste again.");
      } else if (event.key === "Escape" && (copyRef.current || drag)) {
        event.preventDefault(); cancelCopy();
      }
    };
    releaseRef.current = event => {
      if (["Control", "Meta", "c", "C"].includes(event.key) && copyRef.current?.mode === "selecting") finishSelection();
    };
  });
  useEffect(() => {
    const element = area.current;
    const onKey = (event: globalThis.KeyboardEvent) => keyboardRef.current(event);
    const onRelease = (event: globalThis.KeyboardEvent) => releaseRef.current(event);
    // Handle Escape before Studio's bubbling shortcut can collapse the active editor.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onRelease);
    return () => {
      window.removeEventListener("keydown", onKey, true); window.removeEventListener("keyup", onRelease);
      const id = capturedPointer.current;
      if (id !== null && element?.hasPointerCapture(id)) element.releasePointerCapture(id);
    };
  }, []);
  const replace = (n: Note) => p.onEdit(notes.map((x) => (x.id === n.id ? n : x)));
  const remove = (n: Note) => p.onDelete(n.id);
  const editable = (n: Note) => p.selectedMidi === undefined || n.midi === p.selectedMidi;

  function grab(e: PointerEvent, n: Note, mode: Drag["mode"]) {
    if (p.disabled || copyRef.current || e.button || !editable(n)) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: n.id, mode, x0: e.clientX, y0: e.clientY, grab: at(e).beat - n.startBeat, orig: n, draft: n, moved: false });
  }
  function move(e: PointerEvent) {
    const current = copyRef.current;
    if (current?.mode === "selecting") {
      const rect = { ...current.rect, to: within(at(e)) };
      updateCopy({ ...current, rect, selected: selectedNotes(rect) }); return;
    }
    if (current?.mode === "pasting") {
      updateCopy({ ...current, anchorBeat: current.clipboard.anchorBeat + at(e).beat - current.grabBeat }); return;
    }
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 3;
    const { beat, row } = at(e);
    const o = drag.orig;
    const draft =
      drag.mode === "move" ? moveNote(o, { startBeat: snap(beat - drag.grab), midi: p.selectedMidi ?? rowMidi(row, inst) }, notes, step) ?? drag.draft
      : resizeNote(o, drag.mode, snap(beat), notes, minLen);
    setDrag({ ...drag, moved, draft });
  }
  function drop(e: PointerEvent) {
    const current = copyRef.current;
    if (current?.mode === "selecting") {
      const rect = { ...current.rect, to: within(at(e)) };
      updateCopy({ ...current, rect, selected: selectedNotes(rect) }); finishSelection(); return;
    }
    if (current?.mode === "pasting") {
      releasePointer();
      const anchorBeat = current.clipboard.anchorBeat + at(e).beat - current.grabBeat;
      const message = p.onPaste(current.clipboard, anchorBeat);
      updateCopy({ mode: "ready", clipboard: current.clipboard });
      setFeedback(message ?? "Copied notes pasted. Drag the group or press Ctrl+V to paste again.");
      return;
    }
    if (drag?.moved) replace(drag.draft);
    setDrag(null);
  }
  function add(e: PointerEvent) {
    if (p.disabled || copyRef.current || e.button || e.target !== e.currentTarget) return;
    const { beat, row } = at(e);
    const n = addNote({ id: noteId(), midi: p.selectedMidi ?? rowMidi(row, inst), startBeat: Math.min(TOTAL_BEATS - minLen, Math.floor(beat / step) * step), durationBeats: minLen, velocity: 0.8 }, notes, minLen);
    if (n) p.onEdit([...notes, n]);
  }
  function key(e: KeyboardEvent, n: Note) {
    if (p.disabled || copyRef.current) return;
    const nudge = QUANT_BEATS[p.quantize] || 0.25;
    if (e.key === "Delete" || e.key === "Backspace") {
      remove(n);
      area.current?.focus();
    } else if (!editable(n)) {
      return;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const d = e.key === "ArrowLeft" ? -nudge : nudge;
      const next = e.shiftKey
        ? resizeNote(n, "end", n.startBeat + n.durationBeats + d, notes, minLen)
        : moveNote(n, { startBeat: n.startBeat + d, midi: n.midi }, notes, nudge, 0);
      if (next) replace(next);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (p.selectedMidi !== undefined) { e.preventDefault(); return; }
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
  const selected = copy?.mode === "selecting" ? copy.selected
    : copy && "clipboard" in copy ? copy.clipboard.notes : [];
  const selectedIds = new Set(selected.map(note => note.id));
  const rect = copy?.mode === "selecting" ? copy.rect : copy && "clipboard" in copy ? {
    from: { beat: copy.clipboard.anchorBeat, row: Math.min(...selected.map(note => noteRow(note.midi, inst))) },
    to: { beat: copy.clipboard.anchorBeat + Math.max(...selected.map(note => note.startBeat + note.durationBeats)),
      row: Math.max(...selected.map(note => noteRow(note.midi, inst))) + 1 },
  } : null;
  const ghosts = copy?.mode === "pasting" ? previewCopiedNotes(copy.clipboard, copy.anchorBeat, p.quantize) : [];
  return (
    <>
    <div
      ref={area}
      className={`notes-area editable${p.disabled ? "" : " on"}${copy ? " copying" : ""}`}
      tabIndex={-1}
      onPointerDown={add}
      onPointerDownCapture={startCopy}
      onPointerMove={move}
      onPointerUp={drop}
      onPointerCancel={cancelCopy}
    >
      {visible.map((stored) => {
        const n = drag?.id === stored.id ? drag.draft : stored;
        const beats = +n.durationBeats.toFixed(2);
        return (
          <span
            key={n.id}
            className={`note${editable(stored) ? "" : " background"}${drag?.id === n.id && drag.moved ? " dragging" : ""}${selectedIds.has(stored.id) ? " copy-selected" : ""}`}
            role="button"
            tabIndex={p.disabled ? -1 : 0}
            aria-label={`${pitchName(n.midi)}, beat ${+(n.startBeat + 1).toFixed(2)}, ${beats} beat${beats === 1 ? "" : "s"}`}
            style={{ left: `${beatX(n.startBeat)}%`, width: `${beatX(n.durationBeats)}%`, top: `${noteY(n.midi, inst)}%`, height: `${h}%` }}
            onPointerDown={(e) => grab(e, stored, "move")}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!p.disabled && !copyRef.current) { setDrag(null); remove(stored); }
            }}
            onDoubleClick={() => !p.disabled && !copyRef.current && editable(stored) && remove(stored)}
            onKeyDown={(e) => key(e, stored)}
          >
            {p.label && <span className="note-label">{p.label(n.midi)}</span>}
            {!p.disabled && !copy && editable(stored) && (
              <>
                <span className="note-edge start" onPointerDown={(e) => grab(e, stored, "start")} />
                <span className="note-edge" onPointerDown={(e) => grab(e, stored, "end")} />
              </>
            )}
          </span>
        );
      })}
      {rect && <div className={`copy-rect${copy?.mode === "selecting" ? "" : " copy-group"}`} aria-hidden
        style={{ left: `${beatX(Math.min(rect.from.beat, rect.to.beat))}%`,
          width: `${beatX(Math.abs(rect.to.beat - rect.from.beat))}%`,
          top: `${Math.min(rect.from.row, rect.to.row) / pitchRows(inst) * 100}%`,
          height: `${Math.abs(rect.to.row - rect.from.row) / pitchRows(inst) * 100}%` }} />}
      {ghosts.map(note => <span key={note.id} className="note copy-ghost" aria-hidden
        style={{ left: `${beatX(note.startBeat)}%`, width: `${beatX(note.durationBeats)}%`, top: `${noteY(note.midi, inst)}%`, height: `${h}%` }} />)}
    </div>
    <p className="copy-feedback" role="status" aria-live="polite">{feedback}</p>
    </>
  );
}
