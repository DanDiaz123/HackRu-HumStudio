import type { HumFrame } from "../../lib/hum";

export interface PitchBlock {
  midi: number | null;
  durationSec: number;
  rms?: number;
}

/** Synthetic voiced/unvoiced frames at a fixed hop, with no microphone or random input. */
export function pitchFrames(blocks: readonly PitchBlock[], hopSec = 0.02, startSec = 0): HumFrame[] {
  const frames: HumFrame[] = [];
  for (const block of blocks) {
    const count = Math.round(block.durationSec / hopSec);
    for (let i = 0; i < count; i++) {
      frames.push({
        tSec: startSec + frames.length * hopSec,
        hz: block.midi === null ? null : 440 * Math.pow(2, (block.midi - 69) / 12),
        rms: block.rms ?? (block.midi === null ? 0.003 : 0.1),
        bins: new Float32Array(48),
      });
    }
  }
  return frames;
}
