import assert from "node:assert/strict";
import { test } from "node:test";
import ToneMidi from "@tonejs/midi";
import { midiBytes } from "../lib/midi.ts";
import { DEFAULT_HARMONY } from "../lib/music/harmony.ts";
import { type LoadedProject, MAX_PROJECT_CHARS, parseProject, serializeProject } from "../lib/persistence/project.ts";
import { INSTRUMENTS, initialTracks } from "../lib/tracks.ts";

const { Midi } = ToneMidi; // CommonJS package: Node has no named export

const project = (): LoadedProject => ({
  meta: { id: "p1", name: "Idea", createdAt: "2026-10-10T00:00:00.000Z" },
  bpm: 96,
  quantize: "1/8",
  sensitivity: "high",
  harmony: DEFAULT_HARMONY,
  tracks: initialTracks().map((t) => (t.instrument.id === "melody"
    ? { ...t, notes: [{ id: "m1", midi: 64, startBeat: 2, durationBeats: 1, velocity: 0.8 }], muted: true }
    : t)),
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
  assert.equal(after.quantize, "1/8");
  assert.equal(after.sensitivity, "high");
  assert.deepEqual(after.harmony, before.harmony);
  assert.deepEqual(after.tracks, before.tracks);
});

test("T-09: invalid files throw instead of loading part of them", () => {
  const bad = [
    "", "{", "[]", "null", " ".repeat(MAX_PROJECT_CHARS + 1),
    json((p) => { p.schemaVersion = 3; }),
    json((p) => { p.bpm = 400; }),
    json((p) => { p.quantize = "1/3"; }),
    json((p) => { p.sensitivity = "__proto__"; }),
    json((p) => { p.updatedAt = "yesterday"; }),
    json((p) => { (p.harmony as { bars: unknown[] }).bars.pop(); }),
    json((p) => { (p.tracks as { instrumentId: string }[])[0].instrumentId = "kazoo"; }),
    json((p) => { (p.tracks as { presetId: string }[])[0].presetId = "drums.808"; }),
    json((p) => { (p.tracks as unknown[]).push((p.tracks as unknown[])[0]); }),
    json((p) => { (p.tracks as { notes: { durationBeats: number }[] }[])[0].notes[0].durationBeats = -1; }),
    json((p) => { (p.tracks as { notes: { midi: number }[] }[])[0].notes[0].midi = 60.5; }),
    json((p) => { const t = p.tracks as { notes: unknown[] }[]; t[1].notes.push(t[0].notes[0]); }),
  ];
  for (const text of bad) assert.throws(() => parseProject(text), /not a valid HumStudio project/, text.slice(0, 80));
});

test("missing tracks and legacy preset ids get defaults; unknown fields are dropped", () => {
  const p = parseProject(json((p) => {
    const tracks = p.tracks as Record<string, unknown>[];
    p.tracks = [{ ...tracks[0], presetId: undefined, notes: [{ ...(tracks[0].notes as object[])[0], evil: 1 }] }];
  }));
  assert.equal(p.tracks.length, INSTRUMENTS.length);
  assert.equal(p.tracks[0].presetId, "melody.flute");
  assert.deepEqual(Object.keys(p.tracks[0].notes[0]).sort(), ["durationBeats", "id", "midi", "startBeat", "velocity"]);
  assert.deepEqual(p.tracks[1].notes, []);
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
