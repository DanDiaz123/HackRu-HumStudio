// Versioned multi-track project files. Pure: validation never touches the browser, so a bad file
// can be rejected before any app state changes.
import { DEFAULT_NOTE_SENSITIVITY, type NoteSensitivity, isNoteSensitivity } from "../audio/note-sensitivity.ts";
import { presetForTrack } from "../audio/instrument-presets.ts";
import { DEFAULT_HARMONY, type Harmony, inferHarmony } from "../music/harmony.ts";
import type { Note, QuantizeDivision } from "../music/types.ts";
import { INSTRUMENTS, QUANT_BEATS, TOTAL_BEATS, type Track, noteId } from "../tracks.ts";

export const STORAGE_KEY = "humstudio:project:v2";
export const MAX_PROJECT_CHARS = 2_000_000;
const MAX_PROJECT_NOTES = 10_000;
const MAX_TEXT = 200;

/** Saved multi-track project (TECHNICAL_SPEC 3.1). v1 files (one melody note list) still load. */
interface ProjectV2 {
  schemaVersion: 2;
  id: string;
  name: string;
  bpm: number;
  quantize: QuantizeDivision;
  sensitivity: NoteSensitivity;
  harmony: Harmony;
  tracks: { instrumentId: string; presetId: string; notes: Note[]; muted: boolean; solo: boolean; sample: boolean }[];
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

export function serializeProject(p: LoadedProject, now = new Date()): string {
  const project: ProjectV2 = {
    schemaVersion: 2,
    ...p.meta,
    bpm: p.bpm,
    quantize: p.quantize,
    sensitivity: p.sensitivity,
    harmony: p.harmony,
    tracks: p.tracks.map((t) => ({ instrumentId: t.instrument.id, presetId: t.presetId, notes: t.notes, muted: t.muted, solo: t.solo, sample: t.sample })),
    updatedAt: now.toISOString(),
  };
  return JSON.stringify(project);
}

class ProjectError extends Error {}
const fail = (why: string): never => {
  throw new ProjectError(`This is not a valid HumStudio project: ${why}.`);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, field: string) =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_TEXT ? v : fail(`bad ${field}`);
const time = (v: unknown, field: string) => {
  const s = text(v, field);
  return Number.isFinite(Date.parse(s)) ? s : fail(`bad ${field}`);
};
const bool = (v: unknown, field: string) => (v === undefined ? false : typeof v === "boolean" ? v : fail(`bad ${field}`));
const pcInt = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 11;

function isValidNote(n: unknown): n is Note {
  if (!isObj(n)) return false;
  const { id, midi, startBeat, durationBeats, velocity } = n;
  return typeof id === "string" && id.length > 0 && id.length <= MAX_TEXT &&
    Number.isInteger(midi) && (midi as number) >= 0 && (midi as number) <= 127 &&
    Number.isFinite(startBeat) && (startBeat as number) >= 0 && (startBeat as number) < TOTAL_BEATS &&
    Number.isFinite(durationBeats) && (durationBeats as number) > 0 && (durationBeats as number) <= TOTAL_BEATS &&
    Number.isFinite(velocity) && (velocity as number) >= 0 && (velocity as number) <= 1;
}

function notes(v: unknown, seen: Set<string>): Note[] {
  if (!Array.isArray(v)) fail("notes must be a list");
  return (v as unknown[]).map((n) => {
    if (!isValidNote(n)) fail("a note is malformed");
    const note = n as Note;
    if (seen.has(note.id)) fail("duplicate note id");
    seen.add(note.id);
    if (seen.size > MAX_PROJECT_NOTES) fail("too many notes");
    // Copy only known fields: nothing else from the file reaches app state.
    return { id: note.id, midi: note.midi, startBeat: note.startBeat, durationBeats: note.durationBeats, velocity: note.velocity };
  });
}

function harmony(v: unknown): Harmony {
  if (!isObj(v) || !pcInt(v.tonic) || (v.mode !== "major" && v.mode !== "minor") || !Array.isArray(v.bars) || v.bars.length !== 8 ||
    !v.bars.every((c) => Array.isArray(c) && c.length === 3 && c.every(pcInt)))
    fail("bad harmony");
  const h = v as unknown as Harmony;
  return { tonic: h.tonic, mode: h.mode, bars: h.bars.map((c) => [...c]) };
}

const emptyTrack = (i: (typeof INSTRUMENTS)[number]): Track =>
  ({ instrument: i, presetId: presetForTrack(i.id).id, notes: [], muted: false, solo: false, sample: false });

/** Validate untrusted JSON fully, or throw with a user-facing message. Never partially applies. */
export function parseProject(input: string): LoadedProject {
  if (input.length > MAX_PROJECT_CHARS) fail("file is too large");
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return fail("not JSON");
  }
  if (!isObj(raw)) return fail("not a project");
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
      harmony: melody.length ? inferHarmony(melody) : DEFAULT_HARMONY,
      tracks: INSTRUMENTS.map((i) => (i.id === "melody" ? { ...emptyTrack(i), notes: melody } : emptyTrack(i))),
    };
  }
  if (raw.schemaVersion !== 2) fail("unknown version");
  const sensitivity = raw.sensitivity === undefined ? DEFAULT_NOTE_SENSITIVITY : raw.sensitivity;
  if (!isNoteSensitivity(sensitivity)) fail("bad sensitivity");
  if (!Array.isArray(raw.tracks) || raw.tracks.length > INSTRUMENTS.length) fail("bad track list");
  const saved = new Map<string, Track>();
  for (const t of raw.tracks as unknown[]) {
    if (!isObj(t)) fail("bad track");
    const rec = t as Record<string, unknown>;
    const inst = INSTRUMENTS.find((i) => i.id === rec.instrumentId) ?? fail("unknown instrument");
    if (saved.has(inst.id)) fail("duplicate track");
    let presetId: string;
    try {
      presetId = presetForTrack(inst.id, rec.presetId === undefined ? undefined : String(rec.presetId)).id;
    } catch {
      return fail("unknown sound");
    }
    saved.set(inst.id, {
      instrument: inst, presetId, notes: notes(rec.notes, seen),
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
  id: noteId(),
  name: "HumStudio project",
  createdAt: now.toISOString(),
});
