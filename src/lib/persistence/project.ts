// Versioned multi-track project files. Pure: validation never touches the browser, so a bad file
// can be rejected before any app state changes.
import { DEFAULT_NOTE_SENSITIVITY, type NoteSensitivity, isNoteSensitivity } from "../audio/note-sensitivity.ts";
import { presetForTrack } from "../audio/instrument-presets.ts";
import { DEFAULT_HARMONY, type Harmony, inferHarmony } from "../music/harmony.ts";
import type { Note, QuantizeDivision } from "../music/types.ts";
import { DRUM_PARTS, INSTRUMENTS, QUANT_BEATS, TOTAL_BEATS, drumPart, type DrumPart, type Track } from "../tracks.ts";

export const STORAGE_KEY = "humstudio:project:v2";
export const MAX_PROJECT_CHARS = 2_000_000;
export const MAX_PROJECT_NOTES = 10_000;
const MAX_TEXT = 200;

/** Saved multi-track project (TECHNICAL_SPEC 3.1). v1 files (one melody note list) still load. */
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

/** Everything the studio restores from a file. */
export interface LoadedProject {
  meta: { id: string; name: string; createdAt: string };
  bpm: number;
  quantize: QuantizeDivision;
  sensitivity: NoteSensitivity;
  harmony: Harmony;
  tracks: Track[];
}

/** Copy trusted studio state into an independent v2 save snapshot; no capture data is included. */
export function toProject(p: LoadedProject, now = new Date()): ProjectV2 {
  return {
    schemaVersion: 2,
    id: p.meta.id,
    name: p.meta.name,
    createdAt: p.meta.createdAt,
    bpm: p.bpm,
    quantize: p.quantize,
    sensitivity: p.sensitivity,
    harmony: { tonic: p.harmony.tonic, mode: p.harmony.mode, bars: p.harmony.bars.map((chord) => [...chord]) },
    tracks: p.tracks.map((t) => ({
      instrumentId: t.instrument.id, presetId: t.presetId,
      ...(t.instrument.kind === "drums" ? { drumPart: drumPart(t.drumPart).id } : {}),
      notes: t.notes.map(({ id, midi, startBeat, durationBeats, velocity }) => ({ id, midi, startBeat, durationBeats, velocity })),
      muted: t.muted, solo: t.solo, sample: t.sample,
    })),
    updatedAt: now.toISOString(),
  };
}

export const serializeProject = (p: LoadedProject, now?: Date) => JSON.stringify(toProject(p, now));

class ProjectError extends Error {}
const fail = (why: string): never => {
  throw new ProjectError(`This is not a valid HumStudio project: ${why}.`);
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const onlyFields = (v: Record<string, unknown>, fields: readonly string[]) => Object.keys(v).every((key) => fields.includes(key));
const NOTE_FIELDS = ["id", "midi", "startBeat", "durationBeats", "velocity"];
const PROJECT_FIELDS = ["schemaVersion", "id", "name", "bpm", "quantize", "createdAt", "updatedAt"];
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
  ({ instrument: i, presetId: presetForTrack(i.id).id, ...(i.kind === "drums" ? { drumPart: drumPart(undefined).id } : {}), notes: [], muted: false, solo: false, sample: false });

/** Validate untrusted JSON fully, or throw with a user-facing message. Never partially applies. */
export function parseProject(input: string): LoadedProject {
  if (typeof input !== "string") fail("file must be JSON text");
  if (input.length > MAX_PROJECT_CHARS) fail("file is too large");
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return fail("not JSON");
  }
  if (!isObj(raw)) return fail("not a project");
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) fail("unknown version");
  strictObject(raw, [...PROJECT_FIELDS, ...(raw.schemaVersion === 1 ? ["notes"] : ["sensitivity", "harmony", "tracks"])], "project");
  const bpm = raw.bpm;
  if (!Number.isFinite(bpm) || (bpm as number) < 60 || (bpm as number) > 180) fail("BPM must be 60 to 180");
  const quantize = raw.quantize;
  if (typeof quantize !== "string" || !Object.hasOwn(QUANT_BEATS, quantize)) fail("bad snap");
  const meta = { id: text(raw.id, "id"), name: text(raw.name, "name"), createdAt: time(raw.createdAt, "createdAt") };
  time(raw.updatedAt, "updatedAt");
  const seen = new Set<string>();
  const base = { meta, bpm: bpm as number, quantize: quantize as QuantizeDivision };

  if (raw.schemaVersion === 1) {
    const melody = notes(raw.notes, seen);
    return {
      ...base,
      sensitivity: DEFAULT_NOTE_SENSITIVITY,
      harmony: melody.length ? inferHarmony(melody) : harmony(DEFAULT_HARMONY),
      tracks: INSTRUMENTS.map((i) => (i.id === "melody" ? { ...emptyTrack(i), notes: melody } : emptyTrack(i))),
    };
  }
  const sensitivity = raw.sensitivity === undefined ? DEFAULT_NOTE_SENSITIVITY : raw.sensitivity;
  if (!isNoteSensitivity(sensitivity)) fail("bad sensitivity");
  if (!Array.isArray(raw.tracks) || raw.tracks.length > INSTRUMENTS.length) fail("bad track list");
  const saved = new Map<string, Track>();
  for (const t of raw.tracks as unknown[]) {
    const rec = strictObject(t, ["instrumentId", "presetId", "drumPart", "notes", "muted", "solo", "sample"], "track");
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
    saved.set(inst.id, {
      instrument: inst, presetId, ...(selectedDrumPart ? { drumPart: selectedDrumPart } : {}), notes: notes(rec.notes, seen),
      muted: bool(rec.muted, "mute"), solo: bool(rec.solo, "solo"), sample: bool(rec.sample, "sample"),
    });
  }
  return {
    ...base,
    sensitivity: sensitivity as NoteSensitivity,
    harmony: harmony(raw.harmony),
    tracks: INSTRUMENTS.map((i) => saved.get(i.id) ?? emptyTrack(i)),
  };
}

export const newProjectMeta = (now = new Date()) => ({
  id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p${now.getTime()}`,
  name: "HumStudio project",
  createdAt: now.toISOString(),
});
