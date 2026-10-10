// Editing rules for the zoomed lane. Pure, so the gestures in TrackRow stay thin and testable.
import { type Note, TOTAL_BEATS } from "./tracks.ts";

const EPS = 1e-6;
const end = (n: Note) => n.startBeat + n.durationBeats;
const sameRow = (a: Note, b: Note) => a.id !== b.id && a.midi === b.midi;

/** True when `n` stays inside the timeline and touches no other note on its pitch (end-to-start is fine). */
export function fits(n: Note, notes: readonly Note[]): boolean {
  if (n.startBeat < -EPS || end(n) > TOTAL_BEATS + EPS || n.durationBeats <= 0) return false;
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
 */
export function moveNote(n: Note, target: { startBeat: number; midi: number }, notes: readonly Note[], step: number, reach = 1): Note | null {
  const start = Math.min(TOTAL_BEATS - n.durationBeats, Math.max(0, target.startBeat));
  const want = { ...n, startBeat: start, midi: target.midi };
  if (fits(want, notes)) return want;
  const s = step || 0.25;
  for (let k = 1; k * s <= reach + EPS; k++)
    for (const d of [-k * s, k * s]) {
      const c = { ...want, startBeat: start + d };
      if (fits(c, notes)) return c;
    }
  return null;
}

/** Stretch the end (or the start, keeping the end) to `beat`, stopping at neighbours on the row and at `minLen`. */
export function resizeNote(n: Note, edge: "start" | "end", beat: number, notes: readonly Note[], minLen: number): Note {
  const { from, to } = room(n, notes);
  if (edge === "end") {
    const e = Math.min(to, Math.max(n.startBeat + minLen, beat));
    return { ...n, durationBeats: Math.max(minLen, e - n.startBeat) };
  }
  const e = end(n);
  const s = Math.max(from, Math.min(e - minLen, beat));
  return { ...n, startBeat: s, durationBeats: e - s };
}

/** A new note at `start` on `midi`: shortened to the next note on the row, or null when there's no room. */
export function addNote(n: Note, notes: readonly Note[], minLen: number): Note | null {
  if (!fits({ ...n, durationBeats: minLen / 2 }, notes)) return null;
  const { to } = room(n, notes);
  const len = Math.min(n.durationBeats, to - n.startBeat);
  return len >= minLen / 2 - EPS ? { ...n, durationBeats: len } : null;
}

/** Copy bars 1-4 onto bars 5-8 (replacing them) with fresh ids. */
export function repeatFirstHalf(notes: readonly Note[], newId: () => string): Note[] {
  const half = TOTAL_BEATS / 2;
  // Bars 1-4 end at the halfway line so they can't run into their own copies.
  const first = notes.filter((n) => n.startBeat < half - EPS).map((n) => ({ ...n, durationBeats: Math.min(n.durationBeats, half - n.startBeat) }));
  const copies = first.map((n) => ({
    ...n,
    id: newId(),
    startBeat: n.startBeat + half,
  }));
  return [...first, ...copies];
}
