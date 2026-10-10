import type { HumFrame } from "../hum";

/** Analysis data needed for segmentation; spectrogram bins are deliberately ignored. */
export type SegmentationFrame = Pick<HumFrame, "tSec" | "hz" | "rms">;

/** A detected note in seconds, before instrument fitting or beat quantization. */
export interface SegmentedNote {
  midi: number;
  startSec: number;
  endSec: number;
  /** Changes after a confirmed rest, so pitch correction cannot erase repeated attacks. */
  phraseId: number;
}

/** Timing thresholds are milliseconds, independent of project tempo and frame rate. */
export interface SegmentationConfig {
  stableMs: number;
  silenceHoldMs: number;
  minNoteMs: number;
  medianWindow: number;
  pitchToleranceSemitones: number;
}

export const SEGMENTATION_DEFAULTS: Readonly<SegmentationConfig> = {
  stableMs: 120,
  silenceHoldMs: 150,
  minNoteMs: 100,
  medianWindow: 5,
  pitchToleranceSemitones: 0.7,
};

export const MAX_SEGMENTATION_FRAMES = 10_000;
const EPSILON_SEC = 1e-9;

/**
 * Converts ordered, gated pitch frames into stable monophonic notes without browser APIs.
 * Brief unvoiced gaps preserve pitch history; longer rests start a new phrase.
 * Invalid/non-increasing timestamps are skipped, invalid pitches are unvoiced,
 * and oversized inputs or invalid configuration throw without modifying the input.
 */
export function segmentPitchFrames(
  frames: readonly SegmentationFrame[],
  options: Partial<SegmentationConfig> = {},
): SegmentedNote[] {
  if (!Array.isArray(frames) || frames.length > MAX_SEGMENTATION_FRAMES)
    throw new RangeError("Too many analysis frames.");
  const config = { ...SEGMENTATION_DEFAULTS, ...options };
  for (const ms of [config.stableMs, config.silenceHoldMs, config.minNoteMs]) {
    if (!Number.isFinite(ms) || ms <= 0 || ms > 1000)
      throw new RangeError("Segmentation timing must be between 0 and 1000 ms.");
  }
  if (!Number.isInteger(config.medianWindow) || config.medianWindow < 1 || config.medianWindow > 31)
    throw new RangeError("Median window must contain 1 to 31 frames.");
  if (!Number.isFinite(config.pitchToleranceSemitones) || config.pitchToleranceSemitones < 0.5 || config.pitchToleranceSemitones >= 1)
    throw new RangeError("Pitch tolerance must be at least 0.5 and less than 1 semitone.");

  const stableSec = config.stableMs / 1000;
  const silenceSec = config.silenceHoldMs / 1000;
  const minNoteSec = config.minNoteMs / 1000;
  const segments: SegmentedNote[] = [];
  let recent: number[] = [];
  let active: SegmentedNote | null = null;
  let candidate: { midi: number; startSec: number } | null = null;
  let lastFrameSec = -Infinity;
  let lastVoicedSec: number | null = null;
  let silenceStartSec: number | null = null;
  let phraseId = 0;

  const closeActive = (endSec: number) => {
    if (active && endSec - active.startSec + EPSILON_SEC >= minNoteSec)
      segments.push({ ...active, endSec });
    active = null;
  };

  for (const frame of frames) {
    if (!frame || !Number.isFinite(frame.tSec) || frame.tSec < 0 || frame.tSec <= lastFrameSec) continue;
    const tSec = frame.tSec;
    const previousFrameSec = lastFrameSec;
    lastFrameSec = tSec;
    const hz = frame.hz;
    const voiced = hz !== null && Number.isFinite(hz) && hz >= 80 && hz <= 1000 && Number.isFinite(frame.rms) && frame.rms >= 0.01;
    if (!voiced && silenceStartSec === null) silenceStartSec = tSec;

    // Measure explicit dropouts from their first frame, without adding one voiced hop.
    // A stalled analysis loop still breaks the phrase even without unvoiced frames.
    const gapStartSec = silenceStartSec ?? lastVoicedSec;
    if (lastVoicedSec !== null && gapStartSec !== null &&
      (tSec - gapStartSec > silenceSec + EPSILON_SEC || tSec - previousFrameSec > silenceSec + EPSILON_SEC)) {
      closeActive(lastVoicedSec);
      recent = [];
      candidate = null;
      lastVoicedSec = null;
      silenceStartSec = null;
      phraseId++;
    }

    if (!voiced || hz === null) {
      silenceStartSec ??= tSec;
      candidate = null;
      continue;
    }
    silenceStartSec = null;

    recent.push(69 + 12 * Math.log2(hz / 440));
    if (recent.length > config.medianWindow) recent.shift();
    const sorted = [...recent].sort((a, b) => a - b);
    const smoothed = sorted[sorted.length >> 1];
    const anchor: number | undefined = active?.midi ?? candidate?.midi;
    // A wider hold region keeps vibrato around a semitone boundary from alternating notes.
    const midi: number = anchor !== undefined && Math.abs(smoothed - anchor) <= config.pitchToleranceSemitones
      ? anchor : Math.round(smoothed);

    if (active && active.midi === midi) {
      active.endSec = tSec;
      candidate = null;
    } else {
      if (!candidate || candidate.midi !== midi) candidate = { midi, startSec: tSec };
      if (tSec - candidate.startSec + EPSILON_SEC >= stableSec) {
        closeActive(candidate.startSec);
        active = { midi, startSec: candidate.startSec, endSec: tSec, phraseId };
        candidate = null;
      } else if (active) {
        // Unconfirmed changes remain part of the held note instead of leaving holes.
        active.endSec = tSec;
      }
    }
    lastVoicedSec = tSec;
  }

  if (lastVoicedSec !== null) closeActive(lastVoicedSec);
  return segments;
}
