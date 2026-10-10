import type { PlaybackBackend, PlaybackVoice } from "./playback-engine";

/** Audio-clock clicks shared by transport metronome and a cancellable four-beat count-in. */
export function createClickTrack(backend: PlaybackBackend) {
  let metronomeVoice: PlaybackVoice | null = null;
  let lastClickSec = -Infinity;
  let cancelCountIn: (() => void) | null = null;

  function silenceMetronome() {
    metronomeVoice?.dispose();
    metronomeVoice = null;
    lastClickSec = -Infinity;
  }

  return {
    click(time: number, accent: boolean) {
      // Transport clock catch-up can repeat a tick. Tone's single click voice
      // requires increasing attack times (with a 1 microsecond comparison margin).
      if (!Number.isFinite(time) || time <= lastClickSec + 1e-6) return;
      metronomeVoice ??= backend.createVoice("metronome");
      metronomeVoice.attack(accent ? 84 : 76, time, accent ? 0.65 : 0.4);
      lastClickSec = time;
    },
    silenceMetronome,
    countIn(bpm: number, onBeat: (remaining: number) => void): Promise<boolean> {
      cancelCountIn?.();
      const voice = backend.createVoice("metronome");
      const startSec = backend.now();
      const beatSec = 60 / bpm;
      const timers: number[] = [];
      let finished = false;
      return new Promise((resolve, reject) => {
        const finish = (completed: boolean) => {
          if (finished) return;
          finished = true;
          timers.forEach((id) => backend.clearTimeout(id));
          voice.dispose();
          cancelCountIn = null;
          resolve(completed);
        };
        cancelCountIn = () => finish(false);
        // Schedule sound in advance on the audio clock; UI countdown timers do not drive sound.
        try {
          for (let beat = 0; beat < 4; beat++) {
            voice.attack(beat === 0 ? 84 : 76, startSec + beat * beatSec, beat === 0 ? 0.65 : 0.4);
            timers.push(backend.setTimeout(() => { if (!finished) onBeat(4 - beat); }, beat * beatSec));
          }
          timers.push(backend.setTimeout(() => finish(true), 4 * beatSec));
        } catch (error) {
          reject(error); // settles first, so finish()'s resolve is a no-op
          finish(false);
        }
      });
    },
    cancelCountIn() { cancelCountIn?.(); },
    dispose() {
      cancelCountIn?.();
      silenceMetronome();
    },
  };
}
