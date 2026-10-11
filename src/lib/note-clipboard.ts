import { isValidNote, MAX_PROJECT_NOTES } from "./persistence/project.ts";
import { noteId, noteRow, pitchRows, QUANT_BEATS, TOTAL_BEATS, type Instrument, type Note, type QuantizeDivision, type Track } from "./tracks.ts";

export interface RollPoint { beat: number; row: number }
export interface RollRect { from: RollPoint; to: RollPoint }
export interface NoteClipboard { instrumentId: string; anchorBeat: number; notes: Note[] }

/** Intersect whole rendered note rectangles, including their CSS minimum dimensions. Both drag directions work. */
export function selectNotesInRect(notes: readonly Note[], inst: Instrument, rect: RollRect,
  minimum = { beats: 0, rows: 1 }): Note[] {
  const clamp = (p: RollPoint) => ({ beat: Math.max(0, Math.min(TOTAL_BEATS, p.beat)), row: Math.max(0, Math.min(pitchRows(inst), p.row)) });
  const a = clamp(rect.from), b = clamp(rect.to);
  const left = Math.min(a.beat, b.beat), right = Math.max(a.beat, b.beat);
  const top = Math.min(a.row, b.row), bottom = Math.max(a.row, b.row);
  if (![left, right, top, bottom, minimum.beats, minimum.rows].every(Number.isFinite) || left === right || top === bottom) return [];
  return notes.filter(note => note.startBeat < right && note.startBeat + Math.max(note.durationBeats, minimum.beats) > left &&
    noteRow(note.midi, inst) < bottom && noteRow(note.midi, inst) + Math.max(1, minimum.rows) > top);
}

/** Store independent musical copies with relative timing; clipboard never belongs in project JSON. */
export function createNoteClipboard(instrumentId: string, notes: readonly Note[]): NoteClipboard {
  if (!notes.length || notes.length > MAX_PROJECT_NOTES || !notes.every(isValidNote) || new Set(notes.map(n => n.id)).size !== notes.length)
    throw new RangeError("Select valid notes to copy.");
  const anchorBeat = Math.min(...notes.map(note => note.startBeat));
  return { instrumentId, anchorBeat, notes: notes.map(note => ({ ...note, startBeat: note.startBeat - anchorBeat })) };
}

/** Snap just the placement anchor: offsets, lengths, pitches and velocities remain exact. */
export function previewCopiedNotes(clipboard: NoteClipboard, anchorBeat: number, quantize: QuantizeDivision): Note[] {
  if (!Number.isFinite(anchorBeat) || !Object.hasOwn(QUANT_BEATS, quantize)) throw new RangeError("Choose a valid paste beat and Snap grid.");
  const grid = QUANT_BEATS[quantize];
  const anchor = grid ? Math.round(anchorBeat / grid) * grid : anchorBeat;
  return clipboard.notes.map(note => ({ ...note, startBeat: note.startBeat + anchor }));
}

/** Reject the entire placement if any copy exceeds the song, count limit or collides on the same pitch. */
export function validateCopiedPlacement(track: Track, clipboard: NoteClipboard, anchorBeat: number, totalNoteCount: number): Note[] {
  if (track.instrument.id !== clipboard.instrumentId) throw new RangeError("Paste into the same instrument track.");
  if (!clipboard.notes.length || !Number.isInteger(totalNoteCount) || totalNoteCount < track.notes.length ||
    totalNoteCount + clipboard.notes.length > MAX_PROJECT_NOTES) throw new RangeError("This project can hold at most " + MAX_PROJECT_NOTES.toLocaleString() + " notes.");
  const copies = previewCopiedNotes(clipboard, anchorBeat, track.quantize);
  if (!copies.every(isValidNote)) throw new RangeError("The entire copied group must fit inside the eight-bar timeline.");
  const rows = new Map<number, { note: Note; copied: boolean }[]>();
  for (const [notes, copied] of [[track.notes, false], [copies, true]] as const) for (const note of notes) {
    const row = rows.get(note.midi) ?? [];
    row.push({ note, copied }); rows.set(note.midi, row);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.note.startBeat - b.note.startBeat);
    let existingEnd = -Infinity, copiedEnd = -Infinity;
    for (const { note, copied } of row) {
      if (note.startBeat < copiedEnd - 1e-6 || (copied && note.startBeat < existingEnd - 1e-6))
        throw new RangeError("Copied notes overlap another note on the same pitch. Choose an empty section.");
      if (copied) copiedEnd = Math.max(copiedEnd, note.startBeat + note.durationBeats);
      else existingEnd = Math.max(existingEnd, note.startBeat + note.durationBeats);
    }
  }
  return copies;
}

/** Full-track insertion is atomic and preserves every drum lane. IDs are checked against the whole project. */
export function pasteCopiedNotes(track: Track, clipboard: NoteClipboard, anchorBeat: number, totalNoteCount: number,
  usedIds: Iterable<string> = track.notes.map(note => note.id), createId: () => string = noteId): Note[] {
  const copies = validateCopiedPlacement(track, clipboard, anchorBeat, totalNoteCount);
  const seen = new Set(usedIds);
  const inserted = copies.map(note => {
    const id = createId();
    if (seen.has(id) || !isValidNote({ ...note, id })) throw new RangeError("Copied notes require fresh unique IDs.");
    seen.add(id);
    return { ...note, id };
  });
  return [...track.notes, ...inserted].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi || a.id.localeCompare(b.id));
}
