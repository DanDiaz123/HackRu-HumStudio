/** Canonical musical time unit: quarter-note beats, never seconds. */
export type QuantizeDivision = "off" | "1/4" | "1/8" | "1/16";

export interface Note {
  id: string;
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  bpm: number;
  quantize: QuantizeDivision;
  notes: Note[];
  createdAt: string;
  updatedAt: string;
}

/** A pitch sample collected relative to the active recording start. */
export interface PitchFrame {
  tSec: number;
  hz: number | null;
  clarity: number;
  rms: number;
}

export interface NoteSegment {
  midi: number;
  startSec: number;
  endSec: number;
  confidence: number;
}

export interface DetectorConfig {
  frameSize: 4096;
  hopMs: number;
  minClarity: number;
  minRms: number;
  minHz: number;
  maxHz: number;
  medianWindow: number;
  stableMs: number;
  silenceHoldMs: number;
  mergeGapMs: number;
  minNoteMs: number;
}
