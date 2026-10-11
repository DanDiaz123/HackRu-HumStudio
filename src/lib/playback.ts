import { createPlaybackEngine, type PlaybackEngine } from "./audio/playback-engine.ts";
import { createAudioLifecycle } from "./audio/audio-lifecycle.ts";

const audio = createAudioLifecycle(async () => {
  const { createToneBackend, unlockAudio } = await import("./audio/tone-backend");
  return { createEngine: () => createPlaybackEngine(createToneBackend()), unlock: unlockAudio };
});

/** The live engine after browser startup; initialization never resumes or starts playback. */
export const getEngine = audio.getEngine;

/** Create the shared browser engine for background sample loading, without resuming audio. */
export function initializeAudio(): Promise<PlaybackEngine> {
  if (typeof window === "undefined") return Promise.reject(new Error("Playback is only available in a browser."));
  return audio.initialize();
}

/** Initialize browser audio from a Play, Record, or Sound-selection gesture; concurrent calls share one engine. */
export async function ensureAudio(): Promise<PlaybackEngine> {
  if (typeof window === "undefined") throw new Error("Playback is only available in a browser.");
  return audio.ensure();
}

/** Tone's audio context for the mic, so hum frames and the click share a clock. Call after ensureAudio(). */
export async function micContext() {
  const { micContext } = await import("./audio/tone-backend");
  return micContext();
}

/** Release this studio's audio resources and cancel any pending initialization. */
export function dispose(): void {
  audio.dispose();
}
