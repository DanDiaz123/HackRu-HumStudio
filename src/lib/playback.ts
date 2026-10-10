import { createPlaybackEngine, type PlaybackEngine, type PlaybackState } from "./audio/playback-engine";
import type { Track } from "./tracks";

let engine: PlaybackEngine | null = null;
let initializing: Promise<void> | null = null;
let lifecycle = 0;

/** Initialize browser-only synthesis from a real Play click; concurrent calls share one engine. */
export async function ensureAudio(): Promise<void> {
  if (typeof window === "undefined") throw new Error("Playback is only available in a browser.");
  if (initializing) return initializing;
  const revision = lifecycle;
  initializing = (async () => {
    const { createToneBackend, unlockAudio } = await import("./audio/tone-backend");
    await unlockAudio();
    if (revision !== lifecycle) throw new Error("Audio initialization was cancelled.");
    engine ??= createPlaybackEngine(createToneBackend());
  })();
  const pending = initializing;
  try {
    await pending;
  } finally {
    if (initializing === pending) initializing = null;
  }
}

/** Derive tick-aligned playback from canonical tracks at a validated BPM of 60..180. */
export function schedule(tracks: readonly Track[], bpm: number): void {
  if (!engine) throw new Error("Initialize audio before scheduling playback.");
  engine.schedule(tracks, bpm);
}

/** Start/resume the initialized arrangement. */
export function play(): void {
  if (!engine) throw new Error("Initialize audio before playback.");
  engine.play();
}

/** Pause while preserving the beat position. Safe before audio has been initialized. */
export function pause(): void { engine?.pause(); }

/** Halt playback, silence pending voices, and reset the position. */
export function stop(): void { engine?.stop(); }

/** Reset to beat zero; running playback continues from the start. */
export function rewind(): void { engine?.rewind(); }

/** Audible playhead position in quarter-note beats, zero before initialization. */
export function positionBeats(): number { return engine?.positionBeats() ?? 0; }

/** Actual transport state, rather than an independent UI flag. */
export function state(): PlaybackState { return engine?.state() ?? "stopped"; }

/** Toggle the beat-aligned metronome after initializing audio. */
export function setMetronome(enabled: boolean): void { engine?.setMetronome(enabled); }

/** Count four beats without moving the playhead; false means Stop/unmount cancelled it. */
export function countIn(bpm: number, onBeat?: (remaining: number) => void): Promise<boolean> {
  if (!engine) throw new Error("Initialize audio before counting in.");
  return engine.countIn(bpm, onBeat);
}

/** Release this studio's audio resources and cancel any pending initialization. */
export function dispose(): void {
  lifecycle++;
  initializing = null;
  engine?.dispose();
  engine = null;
}
