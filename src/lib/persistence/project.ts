// Versioned multi-track project files. Pure: validation never touches the browser, so a bad file
// can be rejected before any app state changes.
import { DEFAULT_NOTE_SENSITIVITY, type NoteSensitivity, isNoteSensitivity } from "../audio/note-sensitivity.ts";
import { presetForTrack } from "../audio/instrument-presets.ts";
import type { RegenerationData, TakeSource } from "../music/arrangement-settings.ts";
import { DEFAULT_HARMONY, type Harmony, type Key, inferHarmony } from "../music/harmony.ts";
import type { Note, QuantizeDivision } from "../music/types.ts";
import { DRUM_PARTS, INSTRUMENTS, QUANT_BEATS, TOTAL_BEATS, drumPart, normalizeSoloTracks, type DrumPart, type Track } from "../tracks.ts";

export const STORAGE_KEY = "humstudio:project:v3";
export const LEGACY_STORAGE_KEYS = ["humstudio:project:v2", "humstudio:project:v1"] as const;
export const MAX_REGENERATION_NOTES = 30_000;
export const MAX_PROJECT_BYTES = 2_000_000;
export const MAX_PROJECT_NOTES = 10_000;
const MAX_TEXT = 200;

/** Legacy v2 import contract. New saves use ProjectV3; v1 files remain supported. */
export interface ProjectV2 {
  schemaVersion: 2;
  id: string;
  name: string;
  bpm: number;
  quantize: QuantizeDivision;
  sensitivity: NoteSensitivity;
  harmony: Harmony;
  tracks: { instrumentId: string; presetId: string; drumPart?: DrumPart; notes: Note[]; muted: boolean; solo: boolean; sample: boolean }[];
  createdAt: string;
  updatedAt: string;
}

/** v3 stores independent settings and bounded musical detections. */
export interface ProjectV3 {
  schemaVersion: 3;
  id: string; name: string; bpm: number;
  harmony: Harmony;
  tracks: { instrumentId: string; presetId: string; drumPart?: DrumPart; sensitivity: NoteSensitivity;
    quantize: QuantizeDivision; notes: Note[]; muted: boolean; solo: boolean; sample: boolean }[];
  regeneration?: RegenerationData;
  createdAt: string; updatedAt: string;
}
/** State restored only after full validation. */
export interface LoadedProject {
  meta: { id: string; name: string; createdAt: string };
  bpm: number; harmony: Harmony; tracks: Track[];
  regeneration?: RegenerationData;
}
const copyNotes = (notes: readonly Note[]): Note[] =>
  notes.map(({ id, midi, startBeat, durationBeats, velocity }) => ({ id, midi, startBeat, durationBeats, velocity }));
/** Explicit musical fields prevent runtime frames, buffers and previews leaking into a save. */
export function toProject(p: LoadedProject, now = new Date()): ProjectV3 {
  return {
    schemaVersion: 3, id: p.meta.id, name: p.meta.name, createdAt: p.meta.createdAt, bpm: p.bpm,
    harmony: { tonic: p.harmony.tonic, mode: p.harmony.mode, bars: p.harmony.bars.map(chord => [...chord]) },
    tracks: normalizeSoloTracks(p.tracks).map(t => ({
      instrumentId: t.instrument.id, presetId: t.presetId, sensitivity: t.sensitivity, quantize: t.quantize,
      ...(t.instrument.kind === "drums" ? { drumPart: drumPart(t.drumPart).id } : {}),
      notes: copyNotes(t.notes), muted: t.muted, solo: t.solo, sample: t.sample,
    })),
    ...(p.regeneration ? { regeneration: {
      takes: Object.fromEntries(Object.entries(p.regeneration.takes).map(([id, take]) => [id, {
        bpm: take.bpm, ...(take.drumPart ? { drumPart: take.drumPart } : {}),
        sources: Object.fromEntries(["low", "medium", "high"].map(level => {
          const source = take.sources[level as NoteSensitivity];
          return [level, { notes: copyNotes(source.notes), phraseIds: [...source.phraseIds] }];
        })) as TakeSource["sources"],
      }])),
      snapSources: Object.fromEntries(Object.entries(p.regeneration.snapSources).map(([id, notes]) => [id, copyNotes(notes)])),
      pickedKey: p.regeneration.pickedKey ? { tonic: p.regeneration.pickedKey.tonic, mode: p.regeneration.pickedKey.mode } : null,
      harmonyDriver: p.regeneration.harmonyDriver,
    } } : {}),
    updatedAt: now.toISOString(),
  };
}
/** Bound exports so every successful save can be reopened by the importer. */
export function serializeProject(p: LoadedProject, now?: Date): string {
  const json = JSON.stringify(toProject(p, now));
  if (isProjectTooLarge(json)) throw new RangeError("This project file is too large. Clear unused parts before saving.");
  return json;
}
/** UTF-8 matches File.size and downloaded Blobs; reject huge strings before allocating an encoded copy. */
function isProjectTooLarge(json: string): boolean {
  return json.length > MAX_PROJECT_BYTES || new TextEncoder().encode(json).byteLength > MAX_PROJECT_BYTES;
}
/** Recover valid legacy autosaves without deleting any older storage entries. */
export function readAutosave(storage: Pick<Storage, "getItem">): LoadedProject | null {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    const json = storage.getItem(key);
    if (json) { try { return parseProject(json); } catch {} }
  }
  return null;
}

class ProjectError extends Error {}
const fail = (why: string): never => {
  throw new ProjectError(`This is not a valid HumStudio project: ${why}.`);
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const onlyFields = (v: Record<string, unknown>, fields: readonly string[]) => Object.keys(v).every((key) => fields.includes(key));
const NOTE_FIELDS = ["id", "midi", "startBeat", "durationBeats", "velocity"];
const PROJECT_FIELDS = ["schemaVersion", "id", "name", "bpm", "createdAt", "updatedAt"];
const strictObject = (v: unknown, fields: readonly string[], field: string): Record<string, unknown> =>
  isObj(v) && onlyFields(v, fields) ? v : fail(`bad or unexpected ${field} fields`);
const text = (v: unknown, field: string) =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_TEXT ? v : fail(`bad ${field}`);
const time = (v: unknown, field: string) => {
  const s = text(v, field);
  return Number.isFinite(Date.parse(s)) ? s : fail(`bad ${field}`);
};
const bool = (v: unknown, field: string) => (v === undefined ? false : typeof v === "boolean" ? v : fail(`bad ${field}`));
const pcInt = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 11;

export function isValidNote(n: unknown): n is Note {
  if (!isObj(n) || !onlyFields(n, NOTE_FIELDS)) return false;
  const { id, midi, startBeat, durationBeats, velocity } = n;
  return typeof id === "string" && id.length > 0 && id.length <= MAX_TEXT &&
    Number.isInteger(midi) && (midi as number) >= 0 && (midi as number) <= 127 &&
    Number.isFinite(startBeat) && (startBeat as number) >= 0 && (startBeat as number) < TOTAL_BEATS &&
    Number.isFinite(durationBeats) && (durationBeats as number) > 0 && (durationBeats as number) <= TOTAL_BEATS &&
    (startBeat as number) + (durationBeats as number) <= TOTAL_BEATS &&
    Number.isFinite(velocity) && (velocity as number) >= 0 && (velocity as number) <= 1;
}

function notes(v: unknown, seen: Set<string>): Note[] {
  if (!Array.isArray(v)) fail("notes must be a list");
  if ((v as unknown[]).length > MAX_PROJECT_NOTES) fail("too many notes");
  return (v as unknown[]).map((n) => {
    if (!isValidNote(n)) fail("a note is malformed");
    const note = n as Note;
    if (seen.has(note.id)) fail("duplicate note id");
    seen.add(note.id);
    if (seen.size > MAX_PROJECT_NOTES) fail("too many notes");
    // Validation is complete before a separate note object reaches app state.
    return { id: note.id, midi: note.midi, startBeat: note.startBeat, durationBeats: note.durationBeats, velocity: note.velocity };
  });
}

function harmony(v: unknown): Harmony {
  const value = strictObject(v, ["tonic", "mode", "bars"], "harmony");
  if (!pcInt(value.tonic) || (value.mode !== "major" && value.mode !== "minor") || !Array.isArray(value.bars) || value.bars.length !== 8 ||
    !value.bars.every((c) => Array.isArray(c) && c.length === 3 && c.every(pcInt) && new Set(c).size === 3))
    fail("bad harmony");
  const h = value as unknown as Harmony;
  return { tonic: h.tonic, mode: h.mode, bars: h.bars.map((c) => [...c]) };
}

const emptyTrack = (i: (typeof INSTRUMENTS)[number]): Track =>
  ({ instrument: i, presetId: presetForTrack(i.id).id, sensitivity: DEFAULT_NOTE_SENSITIVITY, quantize: "1/4", ...(i.kind === "drums" ? { drumPart: drumPart(undefined).id } : {}), notes: [], muted: false, solo: false, sample: false });

/** Validate untrusted JSON fully, or throw with a user-facing message. Never partially applies. */
export function parseProject(input: string): LoadedProject {
  if (typeof input !== "string") fail("file must be JSON text");
  if (isProjectTooLarge(input)) fail("file is too large");
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return fail("not JSON");
  }
  if (!isObj(raw)) return fail("not a project");
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3) fail("unknown version");
  strictObject(raw, [...PROJECT_FIELDS, ...(raw.schemaVersion === 1 ? ["quantize", "notes"] : raw.schemaVersion === 2 ? ["quantize", "sensitivity", "harmony", "tracks"] : ["harmony", "tracks", "regeneration"])], "project");
  const bpm = raw.bpm;
  if (!Number.isFinite(bpm) || (bpm as number) < 60 || (bpm as number) > 180) fail("BPM must be 60 to 180");
  const quantize = raw.schemaVersion === 3 ? "1/4" : raw.quantize;
  if (typeof quantize !== "string" || !Object.hasOwn(QUANT_BEATS, quantize)) fail("bad snap");
  const meta = { id: text(raw.id, "id"), name: text(raw.name, "name"), createdAt: time(raw.createdAt, "createdAt") };
  time(raw.updatedAt, "updatedAt");
  const seen = new Set<string>();
  const base = { meta, bpm: bpm as number };

  if (raw.schemaVersion === 1) {
    const melody = notes(raw.notes, seen);
    return {
      ...base,
      harmony: melody.length ? inferHarmony(melody) : harmony(DEFAULT_HARMONY),
      tracks: INSTRUMENTS.map(i => ({ ...emptyTrack(i), quantize: quantize as QuantizeDivision, ...(i.id === "melody" ? { notes: melody } : {}) })),
    };
  }
  const sensitivity = raw.sensitivity === undefined ? DEFAULT_NOTE_SENSITIVITY : raw.sensitivity;
  if (!isNoteSensitivity(sensitivity)) fail("bad sensitivity");
  if (!Array.isArray(raw.tracks) || raw.tracks.length > INSTRUMENTS.length) fail("bad track list");
  const saved = new Map<string, Track>();
  for (const t of raw.tracks as unknown[]) {
    const rec = strictObject(t, ["instrumentId", "presetId", "drumPart", "notes", "muted", "solo", "sample", ...(raw.schemaVersion === 3 ? ["sensitivity", "quantize"] : [])], "track");
    const inst = INSTRUMENTS.find((i) => i.id === rec.instrumentId) ?? fail("unknown instrument");
    if (saved.has(inst.id)) fail("duplicate track");
    let presetId: string;
    if (rec.presetId !== undefined) text(rec.presetId, "sound");
    try {
      presetId = presetForTrack(inst.id, rec.presetId as string | undefined).id;
    } catch {
      return fail("unknown sound");
    }
    let selectedDrumPart: DrumPart | undefined;
    if (rec.drumPart !== undefined) {
      if (inst.kind !== "drums" || !DRUM_PARTS.some((part) => part.id === rec.drumPart)) fail("bad drum part");
      selectedDrumPart = rec.drumPart as DrumPart;
    } else if (inst.kind === "drums") {
      selectedDrumPart = drumPart(undefined).id;
    }
    const trackSensitivity = raw.schemaVersion === 3 ? rec.sensitivity : sensitivity;
    const trackQuantize = raw.schemaVersion === 3 ? rec.quantize : quantize;
    if (!isNoteSensitivity(trackSensitivity)) fail("bad track sensitivity");
    if (typeof trackQuantize !== "string" || !Object.hasOwn(QUANT_BEATS, trackQuantize)) fail("bad track snap");
    saved.set(inst.id, {
      instrument: inst, presetId, sensitivity: trackSensitivity as NoteSensitivity, quantize: trackQuantize as QuantizeDivision, ...(selectedDrumPart ? { drumPart: selectedDrumPart } : {}), notes: notes(rec.notes, seen),
      muted: bool(rec.muted, "mute"), solo: bool(rec.solo, "solo"), sample: bool(rec.sample, "sample"),
    });
  }
  return {
    ...base,
    harmony: harmony(raw.harmony),
    tracks: normalizeSoloTracks(INSTRUMENTS.map(i => saved.get(i.id) ?? { ...emptyTrack(i),
      sensitivity: sensitivity as NoteSensitivity, quantize: quantize as QuantizeDivision })),
    ...(raw.regeneration !== undefined ? { regeneration: regeneration(raw.regeneration, saved) } : {}),
  };
}

/** IDs may repeat within a part's alternatives, but cannot be claimed by another instrument or drum lane. */
function regeneration(input: unknown, tracks: Map<string, Track>): RegenerationData {
  const raw = strictObject(input, ["takes", "snapSources", "pickedKey", "harmonyDriver"], "regeneration");
  const ids = [...tracks.keys()];
  const savedTakes = strictObject(raw.takes, ids, "take list");
  const savedSources = strictObject(raw.snapSources, ids, "snap sources");
  const owners = new Map<string, string>();
  const claimIds = (id: string, source: readonly Note[]) => {
    const track = tracks.get(id)!;
    for (const note of source) {
      // Other drum lanes survive a profile swap, so they must own different IDs too.
      const owner = track.instrument.kind === "drums" ? `${id}:${note.midi}` : id;
      const previous = owners.get(note.id);
      if (previous !== undefined && previous !== owner) fail("duplicate note id across parts");
      owners.set(note.id, owner);
    }
  };
  for (const [id, track] of tracks) claimIds(id, track.notes);
  const takes: Record<string, TakeSource> = {};
  let count = 0;
  for (const [id, value] of Object.entries(savedTakes)) {
    const take = strictObject(value, ["bpm", "sources", "drumPart"], "take");
    if (!Number.isFinite(take.bpm) || (take.bpm as number) < 60 || (take.bpm as number) > 180) fail("bad capture BPM");
    const track = tracks.get(id)!;
    if (take.drumPart !== undefined && (track.instrument.kind !== "drums" || !DRUM_PARTS.some(p => p.id === take.drumPart))) fail("bad take drum part");
    if (track.sample) fail("sample parts cannot contain recorded takes");
    const profiles = strictObject(take.sources, ["low", "medium", "high"], "profiles");
    const sources = {} as TakeSource["sources"];
    for (const level of ["low", "medium", "high"] as const) {
      const profile = strictObject(profiles[level], ["notes", "phraseIds"], "profile");
      const detected = notes(profile.notes, new Set());
      claimIds(id, detected);
      count += detected.length;
      if (count > MAX_REGENERATION_NOTES) fail("too many regeneration notes");
      if (!Array.isArray(profile.phraseIds) || profile.phraseIds.length !== detected.length ||
        !profile.phraseIds.every((phrase, index, list) => Number.isInteger(phrase) && phrase >= 0 && phrase <= MAX_REGENERATION_NOTES &&
          (index === 0 || phrase >= list[index - 1]))) fail("bad phrase boundaries");
      if (!detected.every((n, index) => (index === 0 || n.startBeat >= detected[index - 1].startBeat) &&
        (track.instrument.kind === "drums" ? DRUM_PARTS.some(p => p.midi === n.midi) &&
          (take.drumPart === undefined || n.midi === drumPart(take.drumPart as DrumPart).midi)
          : n.midi >= track.instrument.lo && n.midi <= track.instrument.hi))) fail("bad detected pitch or timing");
      sources[level] = { notes: detected, phraseIds: [...profile.phraseIds as number[]] };
    }
    takes[id] = { bpm: take.bpm as number, sources, ...(take.drumPart ? { drumPart: take.drumPart as DrumPart } : {}) };
  }
  const seen = new Set<string>();
  const snapSources = Object.fromEntries(Object.entries(savedSources).map(([id, value]) => {
    const source = notes(value, seen);
    claimIds(id, source);
    return [id, source];
  }));
  let pickedKey: Key | null = null;
  if (raw.pickedKey !== null) {
    const key = strictObject(raw.pickedKey, ["tonic", "mode"], "picked key");
    if (!pcInt(key.tonic) || (key.mode !== "major" && key.mode !== "minor")) fail("bad picked key");
    pickedKey = { tonic: key.tonic as number, mode: key.mode as Key["mode"] };
  }
  if (raw.harmonyDriver !== null && raw.harmonyDriver !== "melody" && raw.harmonyDriver !== "keys") fail("bad harmony driver");
  return { takes, snapSources, pickedKey, harmonyDriver: raw.harmonyDriver as RegenerationData["harmonyDriver"] };
}

export const newProjectMeta = (now = new Date()) => ({
  id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p${now.getTime()}`,
  name: "HumStudio project",
  createdAt: now.toISOString(),
});
