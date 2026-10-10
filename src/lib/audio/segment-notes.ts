import type { HumFrame } from "../hum";
import { noteSensitivityConfig } from "./note-sensitivity.ts";

/** Analysis data needed for segmentation; spectrogram bins are deliberately ignored. */
export type SegmentationFrame = Pick<HumFrame, "tSec" | "hz" | "rms">;

/** A detected note in seconds, before instrument fitting or beat quantization. */
export interface SegmentedNote {
  midi: number;
  startSec: number;
  endSec: number;
  /** Changes after a confirmed rest or a re-attack, so pitch correction cannot erase repeated attacks. */
  phraseId: number;
}

/** Time thresholds are milliseconds; pitch tolerance is semitones from the held MIDI note. */
export interface SegmentationConfig {
  stableMs: number;
  silenceHoldMs: number;
  minNoteMs: number;
  medianWindow: number;
  pitchToleranceSemitones: number;
  /** A held note whose level jumps to this many times its dip in the last 100 ms is re-struck ("da-da"). */
  reattackRatio: number;
  /** A jump of about an octave off the held note is folded back as a tracker error unless it lasts this long. */
  octaveHoldMs: number;
}

export const SEGMENTATION_DEFAULTS: Readonly<SegmentationConfig> = noteSensitivityConfig();

export const MAX_SEGMENTATION_FRAMES = 10_000;
const EPSILON_SEC = 1e-9;
/** How far back a re-attack looks for the level dip. */
const REATTACK_WINDOW_SEC = 0.1;
/** Below this level a dip is a dropout, which the silence hold bridges instead. */
const MIN_VOICED_RMS = 0.01;

/**
 * Converts ordered, gated pitch frames into stable monophonic notes without browser APIs.
 * Brief unvoiced gaps preserve pitch history; longer rests start a new phrase. A level dip and
 * return on the same pitch re-strikes the note, and short octave slips are folded back.
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
  for (const ms of [config.stableMs, config.silenceHoldMs, config.minNoteMs, config.octaveHoldMs]) {
    if (!Number.isFinite(ms) || ms <= 0 || ms > 1000)
      throw new RangeError("Segmentation timing must be between 0 and 1000 ms.");
  }
  if (!Number.isInteger(config.medianWindow) || config.medianWindow < 1 || config.medianWindow > 31)
    throw new RangeError("Median window must contain 1 to 31 frames.");
  if (!Number.isFinite(config.pitchToleranceSemitones) || config.pitchToleranceSemitones < 0.5 || config.pitchToleranceSemitones > 3)
    throw new RangeError("Pitch tolerance must be between 0.5 and 3 semitones.");
  if (!Number.isFinite(config.reattackRatio) || config.reattackRatio <= 1 || config.reattackRatio > 10)
    throw new RangeError("Re-attack ratio must be above 1 and at most 10.");

  const stableSec = config.stableMs / 1000;
  const silenceSec = config.silenceHoldMs / 1000;
  const minNoteSec = config.minNoteMs / 1000;
  const octaveHoldSec = config.octaveHoldMs / 1000;
  const segments: SegmentedNote[] = [];
  let recent: { midi: number; tSec: number }[] = [];
  let active: SegmentedNote | null = null;
  // startSec times the stability check; onsetSec is where the new pitch was first sung, which the median only sees a few frames later.
  let candidate: { midi: number; startSec: number; onsetSec: number } | null = null;
  let lastFrameSec = -Infinity;
  let lastVoicedSec: number | null = null;
  let silenceStartSec: number | null = null;
  let phraseId = 0;
  let levels: { tSec: number; rms: number }[] = [];
  let phraseOnsetSec: number | null = null;
  let octaveSinceSec: number | null = null;
  let reattackRecoverySec: number | null = null;

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
      levels = [];
      phraseOnsetSec = null;
      octaveSinceSec = null;
      reattackRecoverySec = null;
    }
    if (voiced && silenceStartSec !== null && lastVoicedSec !== null) {
      // A bridged dropout refills the analysis window gradually. Its recovery ramp
      // belongs to the held note; wait until its first low frame has left the dip window.
      levels = [];
      reattackRecoverySec = tSec;
    }
    // Expire dips before lookup so a briefly stalled frame loop cannot create a false re-attack.
    levels = levels.filter((l) => tSec - l.tSec <= REATTACK_WINDOW_SEC + EPSILON_SEC);
    // Quietest recent frame, before this one joins the history.
    const dip = levels.reduce<{ tSec: number; rms: number } | null>((m, l) => (!m || l.rms < m.rms ? l : m), null);
    if (Number.isFinite(frame.rms)) levels.push({ tSec, rms: frame.rms });

    if (!voiced || hz === null) {
      silenceStartSec ??= tSec;
      candidate = null;
      continue;
    }
    silenceStartSec = null;
    phraseOnsetSec ??= tSec;

    let raw = 69 + 12 * Math.log2(hz / 440);
    // Pitch trackers slip by an octave for a few frames; fold that back onto the held note.
    // A jump that lasts octaveHoldMs was sung, so it becomes a note starting where the jump did.
    const jump = active ? raw - active.midi : 0;
    const octaves = Math.round(jump / 12);
    if (octaves !== 0 && Math.abs(jump - 12 * octaves) <= 2) {
      const sinceSec: number = (octaveSinceSec ??= tSec);
      if (tSec - sinceSec + EPSILON_SEC < octaveHoldSec) {
        raw -= 12 * octaves;
      } else {
        recent = [];
        candidate = { midi: Math.round(raw), startSec: sinceSec, onsetSec: sinceSec };
        octaveSinceSec = null;
      }
    } else {
      octaveSinceSec = null;
    }

    recent.push({ midi: raw, tSec });
    if (recent.length > config.medianWindow) recent.shift();
    const sorted = recent.map((r) => r.midi).sort((a, b) => a - b);
    const smoothed = sorted[sorted.length >> 1];
    const anchor: number | undefined = active?.midi ?? candidate?.midi;
    // A wider hold region keeps vibrato around a semitone boundary from alternating notes.
    const midi: number = anchor !== undefined && Math.abs(smoothed - anchor) <= config.pitchToleranceSemitones
      ? anchor : Math.round(smoothed);

    if (active && active.midi === midi) {
      // Same pitch, but the level dipped and came back: a new syllable, not a held note.
      const recovered = reattackRecoverySec === null || tSec - reattackRecoverySec > REATTACK_WINDOW_SEC + EPSILON_SEC;
      if (recovered && dip && dip.rms >= MIN_VOICED_RMS && frame.rms >= config.reattackRatio * dip.rms &&
        dip.tSec - active.startSec + EPSILON_SEC >= minNoteSec) {
        // The old note ends where the level fell; the new one starts where it came back.
        closeActive(dip.tSec);
        phraseId++;
        active = { midi, startSec: tSec, endSec: tSec, phraseId };
        levels = [];
      } else {
        active.endSec = tSec;
      }
      candidate = null;
    } else {
      if (!candidate || candidate.midi !== midi) {
        let j = recent.length - 1;
        while (j > 0 && Math.abs(recent[j - 1].midi - midi) <= config.pitchToleranceSemitones) j--;
        candidate = { midi, startSec: tSec, onsetSec: recent[j].tSec };
      }
      if (tSec - candidate.startSec + EPSILON_SEC >= stableSec) {
        // A phrase's first note may start with a scoop too short to confirm; the note starts with the voice.
        const startSec: number = !active && phraseOnsetSec !== null && candidate.onsetSec - phraseOnsetSec <= stableSec + EPSILON_SEC
          ? phraseOnsetSec : candidate.onsetSec;
        closeActive(startSec);
        active = { midi, startSec, endSec: tSec, phraseId };
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
