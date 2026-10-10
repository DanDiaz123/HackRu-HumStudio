import { TOTAL_BEATS, type Track } from "../tracks.ts";
import { createClickTrack } from "./click-track.ts";

export type PlaybackState = "started" | "paused" | "stopped";

/** Browser audio adapter. Times passed to voices are AudioContext seconds. */
export interface PlaybackVoice {
  attack(midi: number, time: number, velocity: number): void;
  release(midi: number, time: number): void;
  releaseAll(time: number): void;
  dispose(): void;
}

/** Narrow transport boundary so lifecycle/timing can be tested without Web Audio. */
export interface PlaybackBackend {
  readonly ppq: number;
  readonly state: PlaybackState;
  now(): number;
  positionTicks(): number;
  seekTicks(ticks: number): void;
  setBpm(bpm: number): void;
  setLoop(endTicks: number): void;
  schedule(callback: (time: number) => void, ticks: number): number;
  clear(id: number): void;
  start(): void;
  pause(): void;
  stop(): void;
  setTimeout(callback: () => void, delaySec: number): number;
  clearTimeout(id: number): void;
  onLoopEnd(callback: (time: number) => void): () => void;
  createVoice(instrumentId: string): PlaybackVoice;
}

interface ScheduledNote {
  instrumentId: string;
  voiceKey: string;
  midi: number;
  velocity: number;
  startTick: number;
  endTick: number;
}

function arrangement(tracks: readonly Track[], ppq: number): ScheduledNote[] {
  const solo = tracks.some((track) => track.solo);
  const notes = tracks.flatMap((track) => {
    if (track.muted || (solo && !track.solo)) return [];
    return track.notes.filter((note) => note.startBeat < TOTAL_BEATS && note.velocity > 0).map((note) => {
      const startTick = Math.min(TOTAL_BEATS * ppq - 1, Math.round(note.startBeat * ppq));
      return {
        instrumentId: track.instrument.id,
        voiceKey: track.instrument.id,
        midi: note.midi,
        velocity: note.velocity,
        startTick,
        endTick: Math.min(TOTAL_BEATS * ppq, Math.max(startTick + 1, Math.round((note.startBeat + note.durationBeats) * ppq))),
      };
    });
  });
  const pitchLanes = new Map<string, number[]>();
  // PolySynth releases the oldest matching pitch. Isolate overlapping equal pitches
  // so a short later note cannot release a longer earlier one.
  for (const note of [...notes].sort((a, b) => a.startTick - b.startTick)) {
    const key = `${note.instrumentId}:${note.midi}`;
    const lanes = pitchLanes.get(key) ?? [];
    let lane = lanes.findIndex((end) => end <= note.startTick);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = note.endTick;
    pitchLanes.set(key, lanes);
    note.voiceKey = `${note.instrumentId}:${lane}`;
  }
  return notes;
}

/** Owns derived callbacks/voices for the fixed eight-bar arrangement; never mutates Track[]. */
export function createPlaybackEngine(backend: PlaybackBackend) {
  let notes: ScheduledNote[] = [];
  let eventIds: number[] = [];
  const voices = new Map<string, PlaybackVoice>();
  const clicks = createClickTrack(backend);
  let metronome = false;
  let clickEventIds: number[] = [];

  function voice(note: ScheduledNote) {
    let value = voices.get(note.voiceKey);
    if (!value) {
      value = backend.createVoice(note.instrumentId);
      voices.set(note.voiceKey, value);
    }
    return value;
  }

  function silence() {
    // Disposal also cancels attacks already submitted during Tone's lookahead window.
    voices.forEach((value) => value.dispose());
    voices.clear();
    clicks.silenceMetronome();
  }

  function clearEvents() {
    eventIds.forEach((id) => backend.clear(id));
    eventIds = [];
  }

  function scheduleMetronome(enabled: boolean) {
    clickEventIds.forEach((id) => backend.clear(id));
    clickEventIds = [];
    clicks.silenceMetronome();
    metronome = enabled;
    if (!enabled) return;
    for (let beat = 0; beat < TOTAL_BEATS; beat++) {
      clickEventIds.push(backend.schedule((time) => {
        if (backend.state === "started") clicks.click(time, beat % 4 === 0);
      }, beat * backend.ppq));
    }
  }

  function resumeHeldNotes(tick = backend.positionTicks()) {
    const time = backend.now();
    for (const note of notes) {
      if (note.startTick < tick && note.endTick > tick) {
        voice(note).attack(note.midi, time, note.velocity);
      }
    }
  }

  // Tone loops before processing the loop-end tick, so releases at beat 32 need this hook.
  const removeLoopListener = backend.onLoopEnd((time) => {
    voices.forEach((value) => value.releaseAll(time));
  });

  return {
    /** Replace derived playback atomically. Invalid data preserves the previous arrangement. */
    schedule(tracks: readonly Track[], bpm: number) {
      if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180) {
        throw new RangeError("BPM must be finite and between 60 and 180.");
      }
      const next = arrangement(tracks, backend.ppq);
      clicks.cancelCountIn();
      const running = backend.state === "started";
      const tick = backend.positionTicks();
      if (running) backend.pause();
      clearEvents();
      silence();
      notes = next;
      backend.setBpm(bpm);
      backend.setLoop(TOTAL_BEATS * backend.ppq);
      scheduleMetronome(metronome);
      if (running) backend.seekTicks(tick);
      // Register releases first so adjacent equal-pitch notes release before re-attacking.
      for (const note of notes) {
        if (note.endTick < TOTAL_BEATS * backend.ppq) {
          eventIds.push(backend.schedule((time) => {
            if (backend.state === "started") voices.get(note.voiceKey)?.release(note.midi, time);
          }, note.endTick));
        }
      }
      for (const note of notes) {
        eventIds.push(backend.schedule((time) => {
          if (backend.state === "started") voice(note).attack(note.midi, time, note.velocity);
        }, note.startTick));
      }
      if (running) {
        resumeHeldNotes(tick);
        backend.start();
      }
    },
    /** Start or resume at the current beat, including any interrupted sustained notes. */
    play() {
      if (backend.state === "started") return;
      resumeHeldNotes();
      backend.start();
    },
    /** Pause at the current beat and silence all voices, including pending attacks. */
    pause() {
      clicks.cancelCountIn();
      backend.pause();
      silence();
    },
    /** Stop and return to beat zero. */
    stop() {
      clicks.cancelCountIn();
      backend.stop();
      backend.seekTicks(0);
      silence();
    },
    /** Return to beat zero, preserving whether the transport was running. */
    rewind() {
      clicks.cancelCountIn();
      const running = backend.state === "started";
      backend.pause();
      silence();
      backend.seekTicks(0);
      if (running) backend.start();
    },
    /** Enable/disable quarter-note clicks; accent each 4/4 downbeat. */
    setMetronome: scheduleMetronome,
    /** Four audio-clock beats before playback. Resolves false when cancelled. BPM is fixed for the count-in. */
    countIn(bpm: number, onBeat: (remaining: number) => void = () => {}) {
      backend.pause();
      silence();
      return clicks.countIn(bpm, onBeat);
    },
    /** Audio-clock seconds at which play() called now puts beat 0 (Tone adds its lookahead). */
    nowSec() {
      return backend.now();
    },
    /** Audible transport position in quarter-note beats, wrapped to the visible loop. */
    positionBeats() {
      return (backend.positionTicks() / backend.ppq) % TOTAL_BEATS;
    },
    state(): PlaybackState {
      return backend.state;
    },
    /** Stop audio, clear only owned callbacks, and free every synth/listener. */
    dispose() {
      backend.stop();
      clearEvents();
      scheduleMetronome(false);
      clicks.dispose();
      silence();
      removeLoopListener();
      notes = [];
    },
  };
}

export type PlaybackEngine = ReturnType<typeof createPlaybackEngine>;
