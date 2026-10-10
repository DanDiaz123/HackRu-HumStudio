/** Convert a fundamental frequency to a MIDI note number (0..127). */
export function frequencyToMidi(hz: number): number | null {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return midi >= 0 && midi <= 127 ? midi : null;
}

/** The MVP supports tempos from 60 to 180 quarter-note beats per minute. */
function assertValidTime(value: number, bpm: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Musical time must be a finite nonnegative number");
  }
  if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180) {
    throw new RangeError("BPM must be finite and between 60 and 180");
  }
}

export function secondsToBeats(sec: number, bpm: number): number {
  assertValidTime(sec, bpm);
  return (sec * bpm) / 60;
}

export function beatsToSeconds(beats: number, bpm: number): number {
  assertValidTime(beats, bpm);
  return (beats * 60) / bpm;
}
