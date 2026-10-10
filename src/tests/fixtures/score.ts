import type { Note } from "../../lib/tracks.ts";

export type ExpectedNote = Pick<Note, "midi" | "startBeat">;

/**
 * Note-level F1, as in transcription benchmarks: a note counts when its pitch matches and it starts
 * within toleranceSec of an unmatched expected note.
 */
export function scoreNotes(expected: readonly ExpectedNote[], actual: readonly Note[], bpm: number, toleranceSec = 0.05) {
  const tolBeats = (toleranceSec * bpm) / 60;
  const used = new Set<number>();
  let hits = 0;
  for (const e of expected) {
    const i = actual.findIndex((a, k) => !used.has(k) && a.midi === e.midi && Math.abs(a.startBeat - e.startBeat) <= tolBeats + 1e-9);
    if (i >= 0) {
      used.add(i);
      hits++;
    }
  }
  const precision = actual.length ? hits / actual.length : expected.length ? 0 : 1;
  const recall = expected.length ? hits / expected.length : 1;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}
