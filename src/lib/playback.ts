import { createPlaybackEngine, type PlaybackEngine } from "./audio/playback-engine.ts";

let engine: PlaybackEngine | null = null;
let initializing: Promise<PlaybackEngine> | null = null;
let lifecycle = 0;

/** The live engine once a Play click has unlocked audio; null before that and after dispose. */
export const getEngine = () => engine;

/** Initialize browser-only synthesis from a real Play click; concurrent calls share one engine. */
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

/** Release this studio's audio resources and cancel any pending initialization. */
export function dispose(): void {
  lifecycle++;
  initializing = null;
  engine?.dispose();
  engine = null;
}
