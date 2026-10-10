type TrackCategory = "melody" | "bass" | "keys" | "strings" | "drums";
type DrumMidi = 36 | 38 | 42 | 46 | 49;

/** Fixed catalog options, never URLs or code supplied by a project file. */
export type InstrumentPreset = {
  id: string;
  name: string;
  category: TrackCategory;
} & (
  | { family: "soundfont"; instrument: string; kit: "FluidR3_GM" }
  | { family: "grand-piano" }
  | { family: "electric-piano"; instrument: string }
  | { family: "drum-machine"; instrument: string; drumGroups: Record<DrumMidi, string> }
);

export const INSTRUMENT_PRESETS: readonly InstrumentPreset[] = [
  { id: "melody.flute", name: "Flute", category: "melody", family: "soundfont", instrument: "flute", kit: "FluidR3_GM" },
  { id: "melody.marimba", name: "Marimba", category: "melody", family: "soundfont", instrument: "marimba", kit: "FluidR3_GM" },
  { id: "melody.trumpet", name: "Trumpet", category: "melody", family: "soundfont", instrument: "trumpet", kit: "FluidR3_GM" },
  { id: "melody.guitar", name: "Clean Electric Guitar", category: "melody", family: "soundfont", instrument: "electric_guitar_clean", kit: "FluidR3_GM" },
  { id: "melody.lead", name: "Synth Lead", category: "melody", family: "soundfont", instrument: "lead_1_square", kit: "FluidR3_GM" },
  { id: "bass.finger", name: "Fingered Electric Bass", category: "bass", family: "soundfont", instrument: "electric_bass_finger", kit: "FluidR3_GM" },
  { id: "bass.pick", name: "Picked Electric Bass", category: "bass", family: "soundfont", instrument: "electric_bass_pick", kit: "FluidR3_GM" },
  { id: "bass.acoustic", name: "Acoustic Bass", category: "bass", family: "soundfont", instrument: "acoustic_bass", kit: "FluidR3_GM" },
  { id: "bass.synth", name: "Synth Bass", category: "bass", family: "soundfont", instrument: "synth_bass_1", kit: "FluidR3_GM" },
  { id: "keys.grand", name: "Splendid Grand Piano", category: "keys", family: "grand-piano" },
  { id: "keys.wurlitzer", name: "Wurlitzer EP200", category: "keys", family: "electric-piano", instrument: "WurlitzerEP200" },
  { id: "keys.pianet", name: "Pianet T", category: "keys", family: "electric-piano", instrument: "PianetT" },
  { id: "keys.fm", name: "TX81Z FM Piano", category: "keys", family: "electric-piano", instrument: "TX81Z" },
  { id: "strings.violin", name: "Violin", category: "strings", family: "soundfont", instrument: "violin", kit: "FluidR3_GM" },
  { id: "strings.cello", name: "Cello", category: "strings", family: "soundfont", instrument: "cello", kit: "FluidR3_GM" },
  { id: "strings.ensemble", name: "String Ensemble", category: "strings", family: "soundfont", instrument: "string_ensemble_1", kit: "FluidR3_GM" },
  { id: "strings.synth", name: "Synth Strings", category: "strings", family: "soundfont", instrument: "synth_strings_1", kit: "FluidR3_GM" },
  { id: "drums.tr808", name: "TR-808", category: "drums", family: "drum-machine", instrument: "TR-808",
    drumGroups: { 36: "kick", 38: "snare", 42: "hihat-close", 46: "hihat-open", 49: "cymbal" } },
  { id: "drums.lm2", name: "LinnDrum LM-2", category: "drums", family: "drum-machine", instrument: "LM-2",
    drumGroups: { 36: "kick", 38: "snare", 42: "hhclosed", 46: "hhopen", 49: "crash" } },
  { id: "drums.rz1", name: "Casio RZ-1", category: "drums", family: "drum-machine", instrument: "Casio-RZ1",
    drumGroups: { 36: "kick", 38: "snare", 42: "hihat-closed", 46: "hihat-open", 49: "crash" } },
];

export const DEFAULT_PRESET_IDS: Readonly<Record<TrackCategory, string>> = {
  melody: "melody.flute", bass: "bass.finger", keys: "keys.grand",
  strings: "strings.ensemble", drums: "drums.tr808",
};

/** Only sounds applicable to the fixed track category; safe to use during SSR. */
export const presetsForTrack = (category: string) => INSTRUMENT_PRESETS.filter(p => p.category === category);

/** Resolve a missing legacy field to its default; reject unknown or cross-category IDs. */
export function presetForTrack(category: string, presetId?: string): InstrumentPreset {
  if (!Object.hasOwn(DEFAULT_PRESET_IDS, category)) throw new RangeError("Unsupported track category.");
  const id = presetId ?? DEFAULT_PRESET_IDS[category as TrackCategory];
  const preset = INSTRUMENT_PRESETS.find(p => p.id === id && p.category === category);
  if (!preset) throw new RangeError("Unsupported sound for this track.");
  return preset;
}

/** Check identifiers against the installed smplr catalogs before creating sample nodes. */
export function validatePresetCatalog(preset: InstrumentPreset, catalogs: { soundfont: readonly string[]; electric: readonly string[]; drums: readonly string[] }): void {
  const names = preset.family === "soundfont" ? catalogs.soundfont
    : preset.family === "electric-piano" ? catalogs.electric
    : preset.family === "drum-machine" ? catalogs.drums : null;
  if (names && "instrument" in preset && !names.includes(preset.instrument))
    throw new RangeError("This sound is unavailable in the installed smplr catalog.");
}

/** Verify every GM drum mapping against the loaded kit's actual groups and samples. */
export function drumMapForPreset(preset: InstrumentPreset, groups: readonly string[], samples: readonly string[]): ReadonlyMap<number, string> {
  if (preset.family !== "drum-machine") throw new RangeError("Expected a drum preset.");
  const mapping = new Map<number, string>();
  for (const [midi, name] of Object.entries(preset.drumGroups)) {
    // Some kits expose hats as full sample aliases under one shared "hihat" group.
    if (!samples.includes(name) && (!groups.includes(name) || !samples.some(s => s.startsWith(`${name}/`) || s.startsWith(`${name}-`))))
      throw new RangeError("The drum kit is missing a required sample group.");
    mapping.set(Number(midi), name);
  }
  return mapping;
}
