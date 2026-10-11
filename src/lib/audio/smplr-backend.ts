import {
  DrumMachine, ElectricPiano, SampleLoader, Soundfont, SplendidGrandPiano,
  getDrumMachineNames, getElectricPianoNames, getSoundfontNames,
  type SampleLoaderLoadOptions, type Storage,
} from "smplr";
import { INSTRUMENTS } from "../tracks.ts";
import { drumMapForPreset, validatePresetCatalog, type InstrumentPreset } from "./instrument-presets.ts";
import type { SampledInstrument } from "./sampled-voice";

/** Fetch only fixed sample hosts; manifests cannot redirect requests outside that boundary. */
export async function fetchSampleAsset(url: string): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !["gleitz.github.io", "smpldsnds.github.io"].includes(parsed.hostname)
    || parsed.username || parsed.password || parsed.port) {
    throw new Error("Unexpected sample asset source.");
  }
  const response = await fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Sample asset could not be fetched.");
  return response;
}

/**
 * Browser-only factory on Tone's underlying context. A shared loader reuses decoded buffers.
 * Load the category's playable range (all velocities), rather than every preset/keyboard note.
 */
export function createSmplrFactory(context: AudioContext): (preset: InstrumentPreset) => SampledInstrument {
  const catalogs = { soundfont: getSoundfontNames(), electric: getElectricPianoNames(), drums: getDrumMachineNames() };
  const storage: Storage = { fetch: fetchSampleAsset };
  const loader = SampleLoader(context, { storage });
  // smplr can resolve ready with missing buffers; treat partial downloads as a load failure.
  const checkedLoader: SampleLoader = {
    async load(json, options?: SampleLoaderLoadOptions | ((loaded: number, total: number) => void)) {
      const expected = new Set(json.groups.flatMap(group => group.regions.map(region => region.sample)));
      if (!expected.size || expected.size > 256)
        throw new Error("Unexpected sample manifest size.");
      const buffers = await loader.load(json, typeof options === "function" ? { onProgress: options } : options);
      if ([...expected].some(name => !buffers.has(name)))
        throw new Error("Required sample buffers are missing.");
      return buffers;
    },
  };

  return preset => {
    validatePresetCatalog(preset, catalogs);
    const instrument = INSTRUMENTS.find(i => i.id === preset.category)!;
    const notes = Array.from({ length: instrument.hi - instrument.lo + 1 }, (_, i) => instrument.lo + i);
    const common = { loader: checkedLoader, storage, destination: context.destination, volume: 70,
      notesToLoad: { notes, velocityRange: [1, 127] as [number, number] } };
    if (preset.family === "drum-machine") {
      const kit = DrumMachine(context, { ...common, instrument: preset.instrument,
        notesToLoad: { notes: Object.values(preset.drumGroups) } });
      const sample: SampledInstrument = { ready: kit.ready.then(() => {
        sample.drumMap = drumMapForPreset(preset, kit.getGroupNames(), kit.getSampleNames());
      }), start: event => kit.start(event), dispose: () => kit.dispose() };
      return sample;
    }
    const sound = preset.family === "soundfont" ? Soundfont(context, { ...common, instrument: preset.instrument, kit: preset.kit })
      : preset.family === "electric-piano" ? ElectricPiano(context, { ...common, instrument: preset.instrument })
      : SplendidGrandPiano(context, common);
    return { ready: sound.ready, start: event => sound.start(event), dispose: () => sound.dispose() };
  };
}
