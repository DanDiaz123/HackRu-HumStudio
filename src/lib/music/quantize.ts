import type { QuantizeDivision } from "./types";

const GRID_STEPS: Record<QuantizeDivision, number | null> = {
  off: null,
  "1/4": 1,
  "1/8": 0.5,
  "1/16": 0.25,
};

/** The grid is expressed in quarter-note beats. */
export function getGridStep(division: QuantizeDivision): number | null {
  const step = GRID_STEPS[division];
  if (step === undefined) {
    throw new RangeError("Unsupported quantization division");
  }
  return step;
}

/** Snap an onset/boundary to a grid, clamping negative beats to zero. */
export function snapBeat(beat: number, division: QuantizeDivision): number {
  if (!Number.isFinite(beat)) {
    throw new RangeError("Beat must be finite");
  }
  const value = Math.max(0, beat);
  const step = getGridStep(division);
  return step === null ? value : Math.round(value / step) * step;
}
