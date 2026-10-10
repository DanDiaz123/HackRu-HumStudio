import type { Track } from "../tracks";
import { presetForTrack, type InstrumentPreset } from "./instrument-presets.ts";
import type { PlaybackVoice } from "./playback-engine";
import { createSampledVoice, type SampledInstrument } from "./sampled-voice.ts";

/** Runtime loading state is kept outside serializable Track[]. */
export interface PresetStatus {
  trackId: string;
  presetId: string;
  state: "idle" | "loading" | "ready" | "fallback";
  activePresetId?: string;
  message?: string;
}

type Resource = { presetId: string; sample: SampledInstrument; users: number; retired: boolean };
type Entry = {
  preset: InstrumentPreset;
  status: PresetStatus;
  active?: Resource;
  pending?: { sample: SampledInstrument; promise: Promise<void>; cancel: () => void };
};

/**
 * Own sample resources per track, retain a working sound on failure, and ignore stale loads.
 * Factories and the clock are injected so switching/lifetimes are testable without a browser.
 */
export function createPresetManager(
  createSample: (preset: InstrumentPreset) => SampledInstrument,
  createFallback: (trackId: string) => PlaybackVoice,
  now: () => number,
  loadTimeoutMs = 20_000,
) {
  const entries = new Map<string, Entry>();
  const resources = new Set<Resource>();
  const statusListeners = new Set<(status: PresetStatus) => void>();
  const readyListeners = new Set<() => void>();
  let disposed = false;

  function emit(entry: Entry) {
    statusListeners.forEach(listener => listener({ ...entry.status }));
  }
  function retire(resource: Resource) {
    resource.retired = true;
    if (resource.users === 0) {
      resource.sample.dispose();
      resources.delete(resource);
    }
  }
  function sync(tracks: readonly Track[]) {
    if (disposed) return;
    // Validate all IDs before touching working resources.
    const selections = tracks.map(track => presetForTrack(track.instrument.id, track.presetId));
    selections.forEach(preset => {
      let entry = entries.get(preset.category);
      if (entry?.preset.id === preset.id) return;
      if (entry?.pending) {
        entry.pending.cancel();
        entry.pending.sample.dispose();
        entry.pending = undefined;
      }
      if (!entry) {
        entry = { preset, status: { trackId: preset.category, presetId: preset.id, state: "idle" } };
        entries.set(preset.category, entry);
      }
      entry.preset = preset;
      entry.status = { trackId: preset.category, presetId: preset.id, state: entry.active?.presetId === preset.id ? "ready" : "idle", activePresetId: entry.active?.presetId };
      emit(entry);
    });
  }

  function load(entry: Entry, retry: boolean): Promise<void> {
    if (entry.pending) return entry.pending.promise;
    if (entry.status.state === "ready" || (entry.status.state === "fallback" && !retry)) {
      // A repeated selection may have shown optimistic loading in the UI.
      emit(entry);
      return Promise.resolve();
    }
    entry.status = { ...entry.status, state: "loading", message: undefined };
    emit(entry);
    let sample: SampledInstrument;
    try {
      sample = createSample(entry.preset);
    } catch {
      fail(entry);
      return Promise.resolve();
    }
    let cancel = () => {};
    const waited = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Sample loading timed out.")), loadTimeoutMs);
      cancel = () => { clearTimeout(timer); reject(new Error("Sample loading cancelled.")); };
      sample.ready.then(() => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); });
    });
    const promise = waited.then(() => {
      if (disposed || entry.pending?.sample !== sample) return;
      const previous = entry.active;
      const resource: Resource = { presetId: entry.preset.id, sample, users: 0, retired: false };
      resources.add(resource);
      entry.active = resource;
      entry.pending = undefined;
      entry.status = { trackId: entry.preset.category, presetId: entry.preset.id, state: "ready", activePresetId: entry.preset.id };
      if (previous) retire(previous);
      emit(entry);
      readyListeners.forEach(listener => listener());
    }).catch(() => {
      sample.dispose();
      if (!disposed && entry.pending?.sample === sample) {
        entry.pending = undefined;
        fail(entry);
      }
    });
    entry.pending = { sample, promise, cancel };
    return promise;
  }

  function fail(entry: Entry) {
    const activeName = entry.active ? presetForTrack(entry.preset.category, entry.active.presetId).name : "the original synth";
    entry.status = { trackId: entry.preset.category, presetId: entry.preset.id, state: "fallback", activePresetId: entry.active?.presetId,
      message: `Could not load ${entry.preset.name}. Using ${activeName}. Check your connection or retry.` };
    emit(entry);
  }

  return {
    sync,
    /** Load only these requested tracks; failures resolve with explicit fallback status. */
    async prepare(tracks: readonly Track[], retry = false) {
      if (disposed) return;
      sync(tracks);
      await Promise.all(tracks.map(track => load(entries.get(track.instrument.id)!, retry)));
    },
    /** Borrow the current working sample; the manager retains ownership of shared nodes. */
    createVoice(trackId: string, presetId?: string): PlaybackVoice {
      if (disposed) throw new Error("Playback resources were disposed.");
      const preset = presetForTrack(trackId, presetId);
      const entry = entries.get(trackId);
      const resource = entry?.preset.id === preset.id ? entry.active : undefined;
      if (!resource) return createFallback(trackId);
      resource.users++;
      return createSampledVoice(resource.sample, now, () => {
        resource.users--;
        if (resource.retired) retire(resource);
      });
    },
    /** Subscribe to statuses, including the current snapshot; unsubscribe on UI unmount. */
    subscribe(listener: (status: PresetStatus) => void) {
      statusListeners.add(listener);
      entries.forEach(entry => listener({ ...entry.status }));
      return () => { statusListeners.delete(listener); };
    },
    /** Rebuild transport voices when a new resource becomes ready during playback. */
    onReady(listener: () => void) {
      readyListeners.add(listener);
      return () => { readyListeners.delete(listener); };
    },
    /** Cancel loads and release all samples; never closes the shared AudioContext. */
    dispose() {
      if (disposed) return;
      disposed = true;
      entries.forEach(entry => {
        entry.pending?.cancel();
        entry.pending?.sample.dispose();
      });
      resources.forEach(resource => resource.sample.dispose());
      resources.clear();
      entries.clear();
      statusListeners.clear();
      readyListeners.clear();
    },
  };
}
