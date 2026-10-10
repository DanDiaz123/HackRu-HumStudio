import type { SegmentationConfig } from "./segment-notes.ts";

export const NOTE_SENSITIVITY_LEVELS = ["low", "medium", "high"] as const;
export type NoteSensitivity = typeof NOTE_SENSITIVITY_LEVELS[number];
export const DEFAULT_NOTE_SENSITIVITY: NoteSensitivity = "medium";

/**
 * Fine-tune hum-to-note response here. A smaller pitch tolerance detects smaller
 * shifts; shorter stability/minimum durations and median windows react faster.
 * Pitch is measured from the held integer MIDI note; time values are milliseconds.
 * Silence hold, re-attack and octave hold stay independent of sensitivity so breath gaps keep the same behavior.
 */
export const NOTE_SENSITIVITY_PRESETS: Readonly<Record<NoteSensitivity, {
  label: string;
  description: string;
  config: Readonly<SegmentationConfig>;
}>> = {
  low: {
    label: "Low",
    description: "Only large, sustained pitch changes create a new note.",
    config: { pitchToleranceSemitones: 1.5, stableMs: 200, medianWindow: 7, minNoteMs: 100, silenceHoldMs: 150, reattackRatio: 1.8, octaveHoldMs: 250 },
  },
  medium: {
    label: "Medium",
    description: "Balanced response to normal pitch changes.",
    config: { pitchToleranceSemitones: 0.7, stableMs: 120, medianWindow: 5, minNoteMs: 100, silenceHoldMs: 150, reattackRatio: 1.8, octaveHoldMs: 250 },
  },
  high: {
    label: "High",
    description: "Small pitch changes create notes more readily; may capture more wobble.",
    config: { pitchToleranceSemitones: 0.5, stableMs: 60, medianWindow: 3, minNoteMs: 60, silenceHoldMs: 150, reattackRatio: 1.8, octaveHoldMs: 250 },
  },
};

/** Allow only fixed sensitivity levels, including at future project-import boundaries. */
export function isNoteSensitivity(value: unknown): value is NoteSensitivity {
  return typeof value === "string" && Object.hasOwn(NOTE_SENSITIVITY_PRESETS, value);
}

/** Return the selected tuning profile; missing arguments use the original Medium thresholds. */
export function noteSensitivityConfig(level: NoteSensitivity = DEFAULT_NOTE_SENSITIVITY): Readonly<SegmentationConfig> {
  if (!isNoteSensitivity(level)) throw new RangeError("Unsupported note sensitivity.");
  return NOTE_SENSITIVITY_PRESETS[level].config;
}
