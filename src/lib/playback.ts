import { createPlaybackEngine, type PlaybackEngine } from "./audio/playback-engine.ts";

let engine: PlaybackEngine | null = null;
let initializing: Promise<PlaybackEngine> | null = null;
let lifecycle = 0;

/** The live engine after a user gesture unlocks audio; null before that and after dispose. */
export const getEngine = () => engine;

/** Initialize browser audio from a Play, Record, or Sound-selection gesture; concurrent calls share one engine. */
export async function ensureAudio(): Promise<PlaybackEngine> {
  if (typeof window === "undefined") throw new Error("Playback is only available in a browser.");
  if (initializing) return initializing;
  const revision = lifecycle;
  const pending = (initializing = (async () => {
    const { createToneBackend, unlockAudio } = await import("./audio/tone-backend");
    await unlockAudio();
    if (revision !== lifecycle) throw new Error("Audio initialization was cancelled.");
    return (engine ??= createPlaybackEngine(createToneBackend()));
  })());
  try {
    return await pending;
  } finally {
    if (initializing === pending) initializing = null;
  }
}

/** Tone's audio context for the mic, so hum frames and the click share a clock. Call after ensureAudio(). */
export async function micContext() {
  const { micContext } = await import("./audio/tone-backend");
  return micContext();
}

/** Release this studio's audio resources and cancel any pending initialization. */
export function dispose(): void {
  lifecycle++;
  initializing = null;
  engine?.dispose();
  engine = null;
}
