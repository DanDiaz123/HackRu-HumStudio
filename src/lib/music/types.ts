/** Canonical musical time unit: quarter-note beats, never seconds. */
export type QuantizeDivision = "off" | "1/4" | "1/8" | "1/16";

export interface Note {
  id: string;
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}
