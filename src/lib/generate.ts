import type { HumFrame } from "./hum";
import { type Harmony, detectKey, fitToHarmony } from "./music/harmony";
import { DRUM_ROWS, type Instrument, type Note, type QuantizeDivision, QUANT_BEATS, TOTAL_BEATS, noteId } from "./tracks";

// ponytail: mock; backend replaces this function. Same signature, return Note[] in beats.
export async function generateTrack(
  inst: Instrument,
  frames: HumFrame[],
  bpm: number,
  quantize: QuantizeDivision,
  harmony: Harmony,
): Promise<Note[]> {
  await new Promise((r) => setTimeout(r, 2400));
  const grid = QUANT_BEATS[quantize] || 0.25;
  const beatOf = (tSec: number) => (tSec * bpm) / 60;
  const snap = (b: number) => Math.round(b / grid) * grid;
  if (inst.kind === "drums") return drums(frames, beatOf, snap);
  const notes = melodic(inst, frames, beatOf, snap, grid);
  // Melody sets the key (Studio infers chords from it); every other part fits the current harmony.
  return fitToHarmony(notes, inst, inst.id === "melody" ? { ...harmony, ...detectKey(notes) } : harmony);
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

/** Octaves to add so the hum's median pitch lands mid-range for this instrument. */
export function octaveShift(inst: Instrument, midis: number[]): number {
  if (!midis.length) return 0;
  const sorted = [...midis].sort((a, b) => a - b);
  return Math.round(((inst.lo + inst.hi) / 2 - sorted[sorted.length >> 1]) / 12) * 12;
}

function melodic(
  inst: Instrument,
  frames: HumFrame[],
  beatOf: (t: number) => number,
  snap: (b: number) => number,
  grid: number,
): Note[] {
  // Median-smooth continuous pitch over the last 5 voiced frames, then collapse into runs of one semitone.
  const runs: { midi: number; start: number; end: number }[] = [];
  let recent: number[] = [];
  for (const f of frames) {
    if (!f.hz) {
      recent = [];
      continue;
    }
    recent = [...recent.slice(-4), hzToMidi(f.hz)];
    const midi = Math.round([...recent].sort((a, b) => a - b)[recent.length >> 1]);
    const b = beatOf(f.tSec);
    const last = runs[runs.length - 1];
    if (last && last.midi === midi && b - last.end < 0.3) last.end = b;
    else runs.push({ midi, start: b, end: b });
  }
  const kept = runs.filter((r) => r.end - r.start >= Math.max(0.15, grid / 2)); // shorter runs are slides
  if (!kept.length) return [];

  const shift = octaveShift(inst, kept.map((r) => r.midi));

  const out: Note[] = [];
  for (const r of kept) {
    let midi = r.midi + shift;
    while (midi < inst.lo) midi += 12;
    while (midi > inst.hi) midi -= 12;
    const startBeat = snap(r.start);
    const durationBeats = Math.max(grid, snap(r.end) - startBeat);
    if (startBeat >= TOTAL_BEATS) break;
    const prev = out[out.length - 1];
    if (prev && prev.midi === midi && prev.startBeat + prev.durationBeats >= startBeat) {
      prev.durationBeats = startBeat + durationBeats - prev.startBeat;
      continue;
    }
    if (prev && prev.startBeat + prev.durationBeats > startBeat) prev.durationBeats = startBeat - prev.startBeat;
    if (prev && prev.durationBeats <= 0) out.pop();
    out.push({ id: noteId(), midi, startBeat, durationBeats: Math.min(durationBeats, TOTAL_BEATS - startBeat), velocity: 0.8 });
  }
  return out;
}

function drums(frames: HumFrame[], beatOf: (t: number) => number, snap: (b: number) => number): Note[] {
  const out: Note[] = [];
  let prev = 0;
  let hits = 0;
  let lastBeat = -1;
  for (const f of frames) {
    const b = snap(beatOf(f.tSec));
    if (f.rms > 0.02 && prev <= 0.02 && b !== lastBeat && b < TOTAL_BEATS) {
      out.push({ id: noteId(), midi: hits++ % 2 ? DRUM_ROWS[3].midi : DRUM_ROWS[4].midi, startBeat: b, durationBeats: 0.5, velocity: 0.9 });
      lastBeat = b;
    }
    prev = f.rms;
  }
  const end = Math.min(TOTAL_BEATS, Math.ceil(beatOf(frames.at(-1)?.tSec ?? 0) / 4) * 4);
  for (let b = 0; b < end; b += 0.5)
    out.push({ id: noteId(), midi: DRUM_ROWS[2].midi, startBeat: b, durationBeats: 0.25, velocity: b % 1 ? 0.45 : 0.7 });
  return out.sort((a, b) => a.startBeat - b.startBeat);
}
