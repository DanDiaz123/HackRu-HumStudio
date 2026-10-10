import type { HumFrame } from "./hum";
import { MAX_SEGMENTATION_FRAMES, SEGMENTATION_DEFAULTS, segmentPitchFrames } from "./audio/segment-notes.ts";
import { type Harmony, detectKey, fitToHarmony } from "./music/harmony.ts";
import { DRUM_ROWS, type Instrument, type Note, type QuantizeDivision, QUANT_BEATS, TOTAL_BEATS, noteId } from "./tracks.ts";

/** Generates canonical notes with the existing loading delay; raw audio stays local. */
export async function generateTrack(
  inst: Instrument,
  frames: HumFrame[],
  bpm: number,
  quantize: QuantizeDivision,
  harmony: Harmony,
): Promise<Note[]> {
  const notes = generateNotes(inst, frames, bpm, quantize, harmony);
  await new Promise((r) => setTimeout(r, 2400));
  return notes;
}

/**
 * Pure generation path: segment seconds, fit pitch/harmony, merge fragments, then snap beats.
 * Off preserves unsnapped timing. Invalid tempo/grid or oversized input throws;
 * unusable melodic frames return [] so the recording UI can preserve existing notes.
 */
export function generateNotes(
  inst: Instrument,
  frames: readonly HumFrame[],
  bpm: number,
  quantize: QuantizeDivision,
  harmony: Harmony,
): Note[] {
  if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180) throw new RangeError("BPM must be between 60 and 180.");
  if (!Object.hasOwn(QUANT_BEATS, quantize)) throw new RangeError("Unsupported quantization.");
  if (!Array.isArray(frames) || frames.length > MAX_SEGMENTATION_FRAMES) throw new RangeError("Too many analysis frames.");
  const grid = QUANT_BEATS[quantize];
  const beatOf = (tSec: number) => (tSec * bpm) / 60;
  const snap = (b: number) => grid ? Math.round(b / grid) * grid : b;
  if (inst.kind === "drums") return drums(frames, beatOf, snap);
  return melodic(inst, frames, beatOf, snap, grid, harmony);
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
  frames: readonly HumFrame[],
  beatOf: (t: number) => number,
  snap: (b: number) => number,
  grid: number,
  harmony: Harmony,
): Note[] {
  const segments = segmentPitchFrames(frames);
  const shift = octaveShift(inst, segments.map((r) => r.midi));
  const staged = segments.map((r) => {
    let midi = r.midi + shift;
    while (midi < inst.lo) midi += 12;
    while (midi > inst.hi) midi -= 12;
    const startBeat = beatOf(r.startSec);
    const endBeat = Math.min(TOTAL_BEATS, beatOf(r.endSec));
    return {
      phraseId: r.phraseId,
      note: { id: noteId(), midi, startBeat, durationBeats: endBeat - startBeat, velocity: 0.8 },
    };
  }).filter(({ note }) => note.startBeat < TOTAL_BEATS && note.durationBeats > 0);
  const raw = staged.map(({ note }) => note);
  // Correction can make different raw pitches identical; merging must follow it.
  const fitted = fitToHarmony(raw, inst, inst.id === "melody" ? { ...harmony, ...detectKey(raw) } : harmony);
  const merged: { note: Note; phraseId: number }[] = [];
  const mergeGapBeats = beatOf(SEGMENTATION_DEFAULTS.silenceHoldMs / 1000);
  for (let i = 0; i < fitted.length; i++) {
    const note = fitted[i];
    const phraseId = staged[i].phraseId;
    const prev = merged[merged.length - 1];
    if (prev && prev.phraseId === phraseId && prev.note.midi === note.midi &&
      note.startBeat - (prev.note.startBeat + prev.note.durationBeats) <= mergeGapBeats + 1e-9) {
      prev.note.durationBeats = Math.max(prev.note.startBeat + prev.note.durationBeats, note.startBeat + note.durationBeats) - prev.note.startBeat;
    } else {
      merged.push({ note: { ...note }, phraseId });
    }
  }

  const out: Note[] = [];
  for (const { note } of merged) {
    const startBeat = snap(note.startBeat);
    const endBeat = Math.min(TOTAL_BEATS, Math.max(startBeat + grid, snap(note.startBeat + note.durationBeats)));
    if (startBeat >= TOTAL_BEATS || endBeat <= startBeat) continue;
    const prev = out[out.length - 1];
    if (prev && prev.startBeat + prev.durationBeats > startBeat) prev.durationBeats = startBeat - prev.startBeat;
    if (prev && prev.durationBeats <= 0) out.pop();
    out.push({ ...note, startBeat, durationBeats: endBeat - startBeat });
  }
  return out;
}

function drums(frames: readonly HumFrame[], beatOf: (t: number) => number, snap: (b: number) => number): Note[] {
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
