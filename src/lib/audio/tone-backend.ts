import * as Tone from "tone";
import type { PlaybackBackend, PlaybackVoice } from "./playback-engine";
import type { MicContext } from "../hum";

/** Resume the shared AudioContext only after a user gesture. */
export const unlockAudio = () => Tone.start();

function synth(type: "triangle" | "sawtooth" | "square" | "sine", release: number, volume: number): PlaybackVoice {
  const instrument = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type },
    envelope: { attack: type === "sine" ? 0.12 : 0.01, decay: 0.1, sustain: 0.7, release },
  }).toDestination();
  instrument.volume.value = volume;
  const frequency = (midi: number) => Tone.Frequency(midi, "midi").toFrequency();
  return {
    attack: (midi, time, velocity) => { instrument.triggerAttack(frequency(midi), time, velocity); },
    release: (midi, time) => { instrument.triggerRelease(frequency(midi), time); },
    releaseAll: (time) => { instrument.releaseAll(time); },
    dispose: () => { instrument.dispose(); },
  };
}

function drumKit(): PlaybackVoice {
  const kick = new Tone.MembraneSynth({ volume: -10 }).toDestination();
  const noise = (type: "white" | "pink", decay: number, volume: number) => new Tone.NoiseSynth({
    volume, noise: { type }, envelope: { attack: 0.001, decay, sustain: 0, release: 0.03 },
  }).toDestination();
  // Separate open/closed hats and crash voices keep their simultaneous hits independent.
  const snare = noise("white", 0.18, -14);
  const hat = noise("pink", 0.05, -22);
  const openHat = noise("pink", 0.3, -22);
  const crash = noise("white", 0.8, -24);
  const all = [kick, snare, hat, openHat, crash];
  return {
    attack: (midi, time, velocity) => {
      if (midi === 36) kick.triggerAttackRelease("C1", 0.15, time, velocity);
      else if (midi === 38) snare.triggerAttackRelease(0.12, time, velocity);
      else if (midi === 42) hat.triggerAttackRelease(0.04, time, velocity);
      else if (midi === 46) openHat.triggerAttackRelease(0.3, time, velocity);
      else if (midi === 49) crash.triggerAttackRelease(0.7, time, velocity);
    },
    // Drum durations use short percussive envelopes; note-off must not cut a later hit.
    release: () => {},
    releaseAll: (time) => { all.forEach((instrument) => instrument.triggerRelease(time)); },
    dispose: () => { all.forEach((instrument) => instrument.dispose()); },
  };
}

/** Tone's context for mic capture, so hum frames are stamped on the same clock as the click. */
export function micContext(): MicContext {
  const ctx = Tone.getContext();
  const raw = ctx.rawContext as AudioContext;
  return {
    sampleRate: ctx.sampleRate,
    outputLatencySec: raw.outputLatency || raw.baseLatency || 0,
    addModule: (url) => {
      // Tone's addAudioWorkletModule only ever loads its first URL, so load ours on the raw context.
      if (!raw.audioWorklet) throw new DOMException("AudioWorklet needs a secure page", "SecurityError");
      return raw.audioWorklet.addModule(url);
    },
    createMediaStreamSource: (stream) => ctx.createMediaStreamSource(stream),
    createAnalyser: () => ctx.createAnalyser(),
    createWorklet: (name, options) => ctx.createAudioWorkletNode(name, options),
  };
}

/** Adapt Tone 15 transport to tick scheduling; owns no canonical project state. */
export function createToneBackend(): PlaybackBackend {
  const transport = Tone.getTransport();
  return {
    ppq: transport.PPQ,
    get state() { return transport.state; },
    now: () => Tone.now(),
    // The default ticks getter includes lookahead; display the position heard at the output.
    positionTicks: () => transport.getTicksAtTime(Tone.immediate()),
    seekTicks: (ticks) => { transport.ticks = ticks; },
    setBpm: (bpm) => { transport.bpm.value = bpm; },
    setLoop: (endTicks) => {
      transport.timeSignature = 4;
      transport.loop = true;
      transport.loopStart = "0i";
      transport.loopEnd = `${endTicks}i`;
    },
    schedule: (callback, ticks) => transport.schedule(callback, `${ticks}i`),
    clear: (id) => { transport.clear(id); },
    start: () => { transport.start(); },
    pause: () => { transport.pause(Tone.immediate()); },
    stop: () => { transport.stop(Tone.immediate()); },
    setTimeout: (callback, delaySec) => Tone.getContext().setTimeout(callback, delaySec),
    clearTimeout: (id) => { Tone.getContext().clearTimeout(id); },
    onLoopEnd: (callback) => {
      transport.on("loopEnd", callback);
      return () => { transport.off("loopEnd", callback); };
    },
    createVoice: (id) => {
      switch (id) {
        case "melody": return synth("sawtooth", 0.15, -18);
        case "bass": return synth("square", 0.1, -18);
        case "keys": return synth("triangle", 0.3, -18);
        case "strings": return synth("sine", 0.6, -16);
        case "drums": return drumKit();
        case "metronome": {
          const click = new Tone.Synth({ volume: -20, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 } }).toDestination();
          return {
            attack: (midi, time, velocity) => { click.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), 0.025, time, velocity); },
            release: () => {},
            releaseAll: (time) => { click.triggerRelease(time); },
            dispose: () => { click.dispose(); },
          };
        }
        default: throw new RangeError("Unsupported playback instrument.");
      }
    },
  };
}
