import type { PlaybackEngine } from "./playback-engine";

interface AudioModule {
  createEngine(): PlaybackEngine;
  unlock(): Promise<unknown>;
}

/** Share startup and gesture requests; disposal prevents pending work from reviving an old studio. */
export function createAudioLifecycle(load: () => Promise<AudioModule>) {
  let current: { engine: PlaybackEngine; unlock: AudioModule["unlock"] } | null = null;
  let initializing: Promise<PlaybackEngine> | null = null;
  let unlocking: Promise<PlaybackEngine> | null = null;
  let revision = 0;

  async function initialize(): Promise<PlaybackEngine> {
    if (current) return current.engine;
    if (initializing) return initializing;
    const generation = revision;
    const pending = (initializing = (async () => {
      const backendModule = await load();
      if (generation !== revision) throw new Error("Audio initialization was cancelled.");
      const engine = backendModule.createEngine();
      current = { engine, unlock: backendModule.unlock };
      return engine;
    })());
    try {
      return await pending;
    } finally {
      if (initializing === pending) initializing = null;
    }
  }

  return {
    initialize,
    getEngine: () => current?.engine ?? null,
    /** Resume only from a user gesture; a failed resume can be retried without reloading samples. */
    async ensure(): Promise<PlaybackEngine> {
      if (unlocking) return unlocking;
      const generation = revision;
      const pending = (unlocking = (async () => {
        const engine = await initialize();
        if (generation !== revision || current?.engine !== engine) throw new Error("Audio initialization was cancelled.");
        await current.unlock();
        if (generation !== revision || current?.engine !== engine) throw new Error("Audio initialization was cancelled.");
        return engine;
      })());
      try {
        return await pending;
      } finally {
        if (unlocking === pending) unlocking = null;
      }
    },
    dispose() {
      revision++;
      initializing = null;
      unlocking = null;
      current?.engine.dispose();
      current = null;
    },
  };
}
