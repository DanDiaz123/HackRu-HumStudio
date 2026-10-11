// Editing rules for the zoomed lane. Pure, so the gestures in TrackRow stay thin and testable.
import { isValidNote } from "./persistence/project.ts";
import { DRUM_PARTS, type DrumPart, type Note, TOTAL_BEATS } from "./tracks.ts";

const EPS = 1e-6;
const MAX_SEARCH_STEPS = 10_000;
const end = (n: Note) => n.startBeat + n.durationBeats;
const sameRow = (a: Note, b: Note) => a.id !== b.id && a.midi === b.midi;
const validNote = (n: Note) => isValidNote(n);
// Same bounds, but a new note may ask for more length than the song has left; addNote trims it.
const validFields = (n: Note) => isValidNote({ ...n, durationBeats: Math.min(n?.durationBeats, TOTAL_BEATS - n?.startBeat) }) &&
  n.durationBeats <= TOTAL_BEATS;
const minimumLength = (minLen: number) => {
  if (!Number.isFinite(minLen) || minLen <= 0 || minLen > TOTAL_BEATS)
    throw new RangeError("Minimum note length must be positive and within the song.");
};

/** Delete exactly one ID from the full track, including an unselected drum lane. Never mutates notes. */
export function deleteNoteById(notes: readonly Note[], id: string): Note[] {
  return notes.filter(note => note.id !== id);
}

/** Replace only the selected drum lane; reject cross-lane edits and preserve the other note objects. */
export function replaceDrumPartNotes(notes: readonly Note[], part: DrumPart, replacement: readonly Note[]): Note[] {
  const selected = DRUM_PARTS.find(option => option.id === part);
  if (!selected || !replacement.every(note => validNote(note) && note.midi === selected.midi))
    throw new RangeError("Drum edits must belong to the selected part.");
  const next = [...notes.filter(note => note.midi !== selected.midi), ...replacement];
  if (new Set(next.map(note => note.id)).size !== next.length)
    throw new RangeError("Drum edits require unique note ids.");
  return next.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi || a.id.localeCompare(b.id));
}

/** True when `n` stays inside the timeline and touches no other note on its pitch (end-to-start is fine). */
export function fits(n: Note, notes: readonly Note[]): boolean {
  if (!validNote(n) || !Array.isArray(notes) || !notes.every(validNote)) return false;
  return !notes.some((o) => sameRow(n, o) && n.startBeat < end(o) - EPS && o.startBeat < end(n) - EPS);
}

/** Free span [from, to) on `n`'s row around `n`, ignoring `n` itself. */
function room(n: Note, notes: readonly Note[]) {
  let from = 0;
  let to = TOTAL_BEATS;
  for (const o of notes) {
    if (!sameRow(n, o)) continue;
    if (end(o) <= n.startBeat + EPS) from = Math.max(from, end(o));
    else if (o.startBeat >= n.startBeat - EPS) to = Math.min(to, o.startBeat);
  }
  return { from, to };
}

/**
 * Move a note toward `target` (new start + pitch). If the spot is taken it slides to the nearest free
 * start on that row within `reach` beats; otherwise the move is refused (null) and the note stays put.
 * Step 0 uses a quarter-beat search. Invalid/unbounded search controls throw; invalid candidates return null.
 */
export function moveNote(n: Note, target: { startBeat: number; midi: number }, notes: readonly Note[], step: number, reach = 1): Note | null {
  if (!Number.isFinite(step) || step < 0 || step > TOTAL_BEATS || !Number.isFinite(reach) || reach < 0 || reach > TOTAL_BEATS)
    throw new RangeError("Note search step and reach must be finite and within the song.");
  const s = step || 0.25;
  // Bounds pointer work even if a future numeric input supplies an extremely small step.
  if (reach / s > MAX_SEARCH_STEPS) throw new RangeError("Note search has too many steps.");
  if (!validNote(n) || !target || !Number.isFinite(target.startBeat) ||
    !Number.isInteger(target.midi) || target.midi < 0 || target.midi > 127) return null;
  const start = Math.min(TOTAL_BEATS - n.durationBeats, Math.max(0, target.startBeat));
  const want = { ...n, startBeat: start, midi: target.midi };
  if (fits(want, notes)) return want;
  for (let k = 1; k * s <= reach + EPS; k++)
    for (const d of [-k * s, k * s]) {
      const c = { ...want, startBeat: start + d };
      if (fits(c, notes)) return c;
    }
  return null;
}

/** Stretch the end (or the start, keeping the end) to `beat`, stopping at neighbours on the row and at `minLen`. */
export function resizeNote(n: Note, edge: "start" | "end", beat: number, notes: readonly Note[], minLen: number): Note {
  minimumLength(minLen);
  if (!validNote(n) || !Number.isFinite(beat) || (edge !== "start" && edge !== "end"))
    throw new RangeError("Cannot resize an invalid note or boundary.");
  const { from, to } = room(n, notes);
  if (edge === "end") {
    // Existing finer-grid notes may have less room than the newly selected minimum.
    const availableMin = Math.min(minLen, Math.max(0, to - n.startBeat));
    const e = Math.min(to, Math.max(n.startBeat + availableMin, beat));
    const candidate = { ...n, durationBeats: e - n.startBeat };
    return fits(candidate, notes) ? candidate : { ...n };
  }
  const e = end(n);
  const s = Math.max(from, Math.min(e - Math.min(minLen, e - from), beat));
  const candidate = { ...n, startBeat: s, durationBeats: e - s };
  return fits(candidate, notes) ? candidate : { ...n };
}

/** A new note at `start` on `midi`: shortened to the next note on the row, or null when there's no room. */
export function addNote(n: Note, notes: readonly Note[], minLen: number): Note | null {
  minimumLength(minLen);
  if (!validFields(n) || !Array.isArray(notes) || notes.some((other) => other.id === n.id)) return null;
  if (!fits({ ...n, durationBeats: minLen / 2 }, notes)) return null;
  const { to } = room(n, notes);
  const len = Math.min(n.durationBeats, to - n.startBeat);
  return len >= minLen / 2 - EPS ? { ...n, durationBeats: len } : null;
}

/** Copy bars 1-4 onto bars 5-8 (replacing them) with fresh ids. */
export function repeatFirstHalf(notes: readonly Note[], newId: () => string): Note[] {
  if (!Array.isArray(notes) || !notes.every(validNote) || typeof newId !== "function")
    throw new RangeError("Cannot repeat invalid notes.");
  const ids = new Set(notes.map((note) => note.id));
  if (ids.size !== notes.length) throw new RangeError("Cannot repeat duplicate note ids.");
  const half = TOTAL_BEATS / 2;
  // Bars 1-4 end at the halfway line so they can't run into their own copies.
  const first = notes.filter((n) => n.startBeat < half - EPS).map((n) => ({ ...n, durationBeats: Math.min(n.durationBeats, half - n.startBeat) }));
  const copies = first.map((n) => {
    const id = newId();
    if (typeof id !== "string" || !id.length || id.length > 200 || ids.has(id))
      throw new RangeError("Repeated notes require fresh unique ids.");
    ids.add(id);
    return { ...n, id, startBeat: n.startBeat + half };
  });
  return [...first, ...copies];
}
