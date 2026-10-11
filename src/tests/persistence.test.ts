import assert from "node:assert/strict";
import { test } from "node:test";
import ToneMidi from "@tonejs/midi";
import { midiBytes } from "../lib/midi.ts";
import { DEFAULT_HARMONY } from "../lib/music/harmony.ts";
import { createNoteClipboard, pasteCopiedNotes } from "../lib/note-clipboard.ts";
import { type LoadedProject, LEGACY_STORAGE_KEYS, STORAGE_KEY, MAX_PROJECT_BYTES, MAX_PROJECT_NOTES, parseProject, readAutosave, serializeProject, toProject } from "../lib/persistence/project.ts";
import { INSTRUMENTS, initialTracks, toggleTrackFlag } from "../lib/tracks.ts";

const { Midi } = ToneMidi; // CommonJS package: Node has no named export

const project = (): LoadedProject => ({
  meta: { id: "p1", name: "Idea", createdAt: "2026-10-10T00:00:00.000Z" },
  bpm: 96,
  harmony: DEFAULT_HARMONY,
  tracks: initialTracks().map(original => { const t = { ...original, quantize: "1/8" as const, sensitivity: "high" as const }; return (t.instrument.id === "melody"
    ? { ...t, notes: [{ id: "m1", midi: 64, startBeat: 2, durationBeats: 1, velocity: 0.8 }], muted: true }
    : t); }),
});
const json = (patch: (p: Record<string, unknown>) => void) => {
  const p = JSON.parse(serializeProject(project()));
  patch(p);
  return JSON.stringify(p);
};

test("T-08: a project round-trips every track, setting and the harmony", () => {
  const before = project();
  const after = parseProject(serializeProject(before));
  assert.deepEqual(after.meta, before.meta);
  assert.equal(after.bpm, 96);
  assert.equal(after.tracks[0].quantize, "1/8");
  assert.equal(after.tracks[0].sensitivity, "high");
  assert.deepEqual(after.harmony, before.harmony);
  assert.deepEqual(after.tracks, before.tracks);
  assert.equal(after.tracks.find(track => track.instrument.id === "drums")?.drumPart, "kick");
});

function unicodeProjectAfterPaste(): LoadedProject {
  const before = project();
  before.tracks = before.tracks.map(track => ({ ...track, notes: [], sample: false, quantize: "off" }));
  before.tracks[0].notes = Array.from({ length: 4500 }, (_, i) => ({
    id: "音".repeat(100) + i, midi: 60 + i % 25, startBeat: Math.floor(i / 25) / 16, durationBeats: 0.03125, velocity: 0.8,
  }));
  const saved = serializeProject(before);
  assert.ok(new Blob([saved]).size <= MAX_PROJECT_BYTES);
  const imported = parseProject(saved), melody = imported.tracks[0];
  let sequence = 0;
  melody.notes = pasteCopiedNotes(melody, createNoteClipboard("melody", melody.notes), 16, 4500,
    melody.notes.map(note => note.id), () => "copy-" + ++sequence);
  return imported;
}

test("Unicode projects that exceed the file byte limit after paste cannot be saved", () => {
  const large = unicodeProjectAfterPaste(), json = JSON.stringify(toProject(large));
  assert.ok(json.length < MAX_PROJECT_BYTES);
  assert.ok(new Blob([json]).size > MAX_PROJECT_BYTES);
  assert.throws(() => serializeProject(large), /too large/);
});

test("the parser and autosave reject Unicode JSON over the file byte limit", () => {
  const json = JSON.stringify(toProject(unicodeProjectAfterPaste()));
  assert.throws(() => parseProject(json), /file is too large/);
  const legacy = serializeProject(project());
  const entries = new Map([[STORAGE_KEY, json], [LEGACY_STORAGE_KEYS[0], legacy]]), before = new Map(entries);
  assert.deepEqual(readAutosave({ getItem: key => entries.get(key) ?? null }), parseProject(legacy));
  assert.deepEqual(entries, before);
});

test("Open accepts exactly the UTF-8 byte limit and rejects one extra byte", () => {
  for (const name of ["ASCII", "Café", "音", "🎵"]) {
    const p = project();
    p.meta.name = name;
    p.tracks[0].notes[0].id = name + "-note";
    const saved = serializeProject(p);
    assert.deepEqual(parseProject(saved).tracks, p.tracks);
    const exact = saved + " ".repeat(MAX_PROJECT_BYTES - new Blob([saved]).size);
    assert.equal(new Blob([exact]).size, MAX_PROJECT_BYTES);
    assert.deepEqual(parseProject(exact).tracks, p.tracks);
    assert.throws(() => parseProject(exact + " "), /file is too large/);
  }
});

test("legacy multi-solo imports select the first fixed category without dropping any drum or project notes", () => {
  const before = JSON.parse(serializeProject(project()));
  before.tracks.reverse();
  for (const track of before.tracks) track.solo = ["bass", "keys", "drums"].includes(track.instrumentId);
  const after = parseProject(JSON.stringify(before));
  assert.deepEqual(after.tracks.filter(track => track.solo).map(track => track.instrument.id), ["bass"]);
  for (const track of after.tracks) {
    const saved = before.tracks.find((item: { instrumentId: string }) => item.instrumentId === track.instrument.id);
    assert.deepEqual(track.notes, saved.notes);
    assert.equal(track.muted, saved.muted);
    assert.equal(track.presetId, saved.presetId);
  }
  assert.equal(after.tracks.find(track => track.instrument.id === "drums")?.drumPart, "kick");
});

test("saving writes one solo without mutating state, and exclusive solo selections round-trip", () => {
  const original = project();
  original.tracks = original.tracks.map(track => ({ ...track, solo: true }));
  const before = structuredClone(original);
  assert.deepEqual(toProject(original).tracks.filter(track => track.solo).map(track => track.instrumentId), ["melody"]);
  assert.deepEqual(original, before);
  const valid = project();
  valid.tracks = toggleTrackFlag(valid.tracks, "drums", "solo");
  assert.deepEqual(parseProject(serializeProject(valid)).tracks, valid.tracks);
});

test("T-09: invalid files throw instead of loading part of them", () => {
  const bad = [
    "", "{", "[]", "null", " ".repeat(MAX_PROJECT_BYTES + 1),
    json((p) => { p.schemaVersion = 4; }),
    json((p) => { p.bpm = 400; }),
    json((p) => { (p.tracks as Record<string, unknown>[])[0].quantize = "1/3"; }),
    json((p) => { (p.tracks as Record<string, unknown>[])[0].sensitivity = "__proto__"; }),
    json((p) => { p.updatedAt = "yesterday"; }),
    json((p) => { (p.harmony as { bars: unknown[] }).bars.pop(); }),
    json((p) => { (p.tracks as { instrumentId: string }[])[0].instrumentId = "kazoo"; }),
    json((p) => { (p.tracks as { presetId: string }[])[0].presetId = "drums.808"; }),
    json((p) => { (p.tracks as unknown[]).push((p.tracks as unknown[])[0]); }),
    json((p) => { (p.tracks as { notes: { durationBeats: number }[] }[])[0].notes[0].durationBeats = -1; }),
    json((p) => { (p.tracks as { notes: { midi: number }[] }[])[0].notes[0].midi = 60.5; }),
    json((p) => { const t = p.tracks as { notes: unknown[] }[]; t[1].notes.push(t[0].notes[0]); }),
    json((p) => { (p.tracks as Record<string, unknown>[]).find(t => t.instrumentId === "drums")!.drumPart = "piano"; }),
    json((p) => { (p.tracks as Record<string, unknown>[])[0].drumPart = "kick"; }),
  ];
  for (const text of bad) assert.throws(() => parseProject(text), /not a valid HumStudio project/, text.slice(0, 80));
});

test("missing tracks and legacy preset ids get defaults", () => {
  const p = parseProject(json((p) => {
    const tracks = p.tracks as Record<string, unknown>[];
    p.tracks = [{ ...tracks[0], presetId: undefined }];
  }));
  assert.equal(p.tracks.length, INSTRUMENTS.length);
  assert.equal(p.tracks[0].presetId, "melody.flute");
  assert.deepEqual(Object.keys(p.tracks[0].notes[0]).sort(), ["durationBeats", "id", "midi", "startBeat", "velocity"]);
  assert.deepEqual(p.tracks[1].notes, []);
});

test("project import rejects unexpected fields and prototype-pollution keys at every object boundary", () => {
  for (const field of ["unexpected", "__proto__", "constructor", "prototype"]) {
    for (const boundary of ["project", "harmony", "track", "note"]) {
      const input = json((p) => {
        const track = (p.tracks as Record<string, unknown>[])[0];
        const target = boundary === "project" ? p : boundary === "harmony" ? p.harmony as object :
          boundary === "track" ? track : (track.notes as object[])[0];
        Object.defineProperty(target, field, { enumerable: true, value: { polluted: true } });
      });
      assert.throws(() => parseProject(input), /not a valid HumStudio project/, `${boundary} ${field}`);
    }
  }
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("project import uses strict field types without coercing preset ids or JSON inputs", () => {
  for (const value of [null, 1, {}, ["melody.flute"], true, new String("melody.flute")]) {
    // JSON.stringify(new String(...)) produces a primitive string; test the runtime input boundary separately.
    if (!(value instanceof String))
      assert.throws(() => parseProject(json(p => { (p.tracks as Record<string, unknown>[])[0].presetId = value; })), /not a valid HumStudio project/);
    assert.throws(() => parseProject(value as unknown as string), /not a valid HumStudio project/);
  }
  for (const value of [null, "false", 0, []]) for (const field of ["muted", "solo", "sample"])
    assert.throws(() => parseProject(json(p => { (p.tracks as Record<string, unknown>[])[0][field] = value; })), /not a valid HumStudio project/);
});

test("note and harmony schema boundaries reject oversized data and notes beyond the song", () => {
  const invalid = [
    json(p => { (p.tracks as { notes: { startBeat: number; durationBeats: number }[] }[])[0].notes[0] =
      { ...(p.tracks as { notes: { startBeat: number; durationBeats: number }[] }[])[0].notes[0], startBeat: 31.5, durationBeats: 1 }; }),
    json(p => { (p.harmony as { bars: number[][] }).bars[0] = [0, 0, 0]; }),
    json(p => { p.name = "x".repeat(201); }),
    json(p => { const tracks = p.tracks as { notes: unknown[] }[]; const note = tracks[0].notes[0] as object;
      tracks[0].notes = Array.from({ length: MAX_PROJECT_NOTES + 1 }, (_, i) => ({ ...note, id: `n${i}` })); }),
  ];
  for (const input of invalid) assert.throws(() => parseProject(input), /not a valid HumStudio project/);
  const exact = parseProject(json(p => { const note = (p.tracks as { notes: { startBeat: number; durationBeats: number }[] }[])[0].notes[0];
    note.startBeat = 31.5; note.durationBeats = 0.5; }));
  assert.equal(exact.tracks[0].notes[0].startBeat + exact.tracks[0].notes[0].durationBeats, 32);
});

test("save snapshots and empty legacy harmony do not share mutable arrays with studio state", () => {
  const state = project();
  const beforeHarmony = structuredClone(state.harmony);
  const snapshot = toProject(state);
  snapshot.tracks[0].notes[0].midi = 70;
  snapshot.harmony.bars[0][0] = 2;
  assert.equal(state.tracks[0].notes[0].midi, 64);
  assert.deepEqual(state.harmony, beforeHarmony);
  const v1 = { schemaVersion: 1, id: "empty", name: "Empty", bpm: 120, quantize: "off", notes: [],
    createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" };
  const first = parseProject(JSON.stringify(v1));
  first.harmony.bars[0][0] = 2;
  assert.deepEqual(parseProject(JSON.stringify(v1)).harmony, DEFAULT_HARMONY);
});

test("a v1 file loads as the Melody track with harmony inferred from it", () => {
  const v1 = {
    schemaVersion: 1, id: "sample-project", name: "First idea", bpm: 120, quantize: "1/16",
    notes: [60, 64, 67].map((midi, i) => ({ id: `n${i}`, midi, startBeat: i, durationBeats: 1, velocity: 0.8 })),
    createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z",
  };
  const p = parseProject(JSON.stringify(v1));
  assert.equal(p.tracks.find((t) => t.instrument.id === "melody")!.notes.length, 3);
  assert.ok(p.tracks.filter((t) => t.instrument.id !== "melody").every((t) => !t.notes.length));
  assert.equal(p.harmony.tonic, 0);
  assert.equal(p.harmony.mode, "major");
  assert.ok(p.tracks.every(track => track.sensitivity === "medium" && track.quantize === "1/16"));
});

test("T-10 / T-15: MIDI maps beats to seconds and puts drums on channel index 9", () => {
  const tracks = initialTracks().map((t) => (t.instrument.id === "keys"
    ? { ...t, notes: [{ id: "k", midi: 60, startBeat: 2, durationBeats: 1, velocity: 0.8 }] }
    : t.instrument.id === "drums" ? t : { ...t, notes: [] }));
  const midi = new Midi(midiBytes(tracks, 120));
  assert.equal(midi.tracks.length, 2);
  const [keys, drums] = midi.tracks;
  assert.equal(keys.name, "Keys");
  assert.equal(keys.notes[0].midi, 60);
  assert.ok(Math.abs(keys.notes[0].time - 1) < 1e-3);
  assert.ok(Math.abs(keys.notes[0].duration - 0.5) < 1e-3);
  assert.equal(drums.channel, 9);
  assert.equal(Math.round(midi.header.tempos[0].bpm), 120);
});
