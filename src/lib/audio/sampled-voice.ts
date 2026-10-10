import type { NoteEvent, StopFn } from "smplr";
import type { PlaybackVoice } from "./playback-engine";

/** The small smplr boundary used by the loader and test doubles. */
export interface SampledInstrument {
  ready: Promise<void>;
  start(event: NoteEvent): StopFn;
  dispose(): void;
  drumMap?: ReadonlyMap<number, string>;
}

let stopSequence = 0;

/**
 * Lease a shared sampler without owning its lifetime. Each attack has a unique stopId.
 * Tone supplies absolute AudioContext times; velocity is converted from 0..1 to 0..127.
 * Drum note-offs are ignored, while pause/disposal still cancels all owned one-shots.
 */
export function createSampledVoice(sample: SampledInstrument, now: () => number, releaseLease: () => void): PlaybackVoice {
  type Started = { midi: number; startSec: number; stop: StopFn };
  const owned = new Set<Started>();
  const releases = new Map<number, Started[]>();
  let disposed = false;
  function stopAll(time: number, immediate = false) {
    // A past Web Audio stop time is immediate. At/before attack smplr cancels
    // the source without a release tail, so Pause cannot leave old notes ringing.
    for (const entry of owned) entry.stop(immediate ? Math.min(time, entry.startSec) : time);
    releases.clear();
  }
  return {
    attack(midi, time, velocity) {
      if (disposed || !Number.isInteger(midi) || midi < 0 || midi > 127 || !Number.isFinite(time) || time < 0 || !Number.isFinite(velocity)) return;
      const note = sample.drumMap ? sample.drumMap.get(midi) : midi;
      const midiVelocity = Math.round(Math.max(0, Math.min(1, velocity)) * 127);
      if (note === undefined || midiVelocity === 0) return;
      const entry: Started = { midi, startSec: time, stop: () => {} };
      owned.add(entry);
      const queue = releases.get(midi) ?? [];
      queue.push(entry);
      releases.set(midi, queue);
      entry.stop = sample.start({
        note, time, velocity: midiVelocity, stopId: `humstudio-${++stopSequence}`,
        onEnded: () => {
          owned.delete(entry);
          const remaining = releases.get(midi)?.filter(item => item !== entry) ?? [];
          if (remaining.length) releases.set(midi, remaining);
          else releases.delete(midi);
        },
      });
    },
    release(midi, time) {
      if (disposed || sample.drumMap) return;
      // Keep released handles owned until onEnded: a later Pause must cancel lookahead audio.
      releases.get(midi)?.shift()?.stop(time);
    },
    releaseAll: stopAll,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopAll(now(), true);
      owned.clear();
      releaseLease();
    },
  };
}
