import * as Tone from "tone";
import { TOTAL_BEATS, type Track } from "./tracks";

type Voice = { play: (midi: number, durSec: number, time: number, vel: number) => void; dispose: () => void };

let voices: Record<string, Voice> | null = null;
let eventIds: number[] = [];

function synth(type: "triangle" | "sawtooth" | "square" | "sine", release: number, vol: number): Voice {
  const s = new Tone.PolySynth(Tone.Synth, { oscillator: { type }, envelope: { attack: 0.01, release } }).toDestination();
  s.volume.value = vol;
  return {
    play: (m, d, t, v) => s.triggerAttackRelease(Tone.Frequency(m, "midi").toFrequency(), d, t, v),
    dispose: () => s.dispose(),
  };
}

function drumKit(): Voice {
  const kick = new Tone.MembraneSynth().toDestination();
  const snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).toDestination();
  const hat = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }).toDestination();
  snare.volume.value = -8;
  hat.volume.value = -18;
  return {
    play: (m, _d, t, v) => {
      if (m === 36) kick.triggerAttackRelease("C1", "8n", t, v);
      else if (m === 38) snare.triggerAttackRelease("16n", t, v);
      else hat.triggerAttackRelease(m === 42 ? "32n" : "8n", t, v);
    },
    dispose: () => [kick, snare, hat].forEach((x) => x.dispose()),
  };
}

const transport = () => Tone.getTransport();
const ticks = (beat: number) => `${Math.round(beat * transport().PPQ)}i`;

/** Must run inside a user gesture. */
export async function ensureAudio() {
  await Tone.start();
  voices ??= {
    melody: synth("sawtooth", 0.3, -14),
    bass: synth("square", 0.2, -12),
    keys: synth("triangle", 0.8, -14),
    strings: synth("sine", 1.2, -10),
    drums: drumKit(),
  };
}

export function schedule(tracks: Track[], bpm: number) {
  const tr = transport();
  eventIds.forEach((id) => tr.clear(id));
  eventIds = [];
  tr.bpm.value = bpm;
  tr.loop = true;
  tr.loopStart = 0;
  tr.loopEnd = ticks(TOTAL_BEATS);
  if (!voices) return;
  const anySolo = tracks.some((t) => t.solo);
  for (const t of tracks) {
    if (t.muted || (anySolo && !t.solo)) continue;
    const v = voices[t.instrument.id];
    for (const n of t.notes) {
      const durSec = (n.durationBeats * 60) / bpm;
      eventIds.push(tr.schedule((time) => v.play(n.midi, durSec, time, n.velocity), ticks(n.startBeat)));
    }
  }
}

export const play = () => transport().start();
export const stop = () => transport().pause();
export function rewind() {
  transport().ticks = 0;
}
export const positionBeats = () => transport().ticks / transport().PPQ;
