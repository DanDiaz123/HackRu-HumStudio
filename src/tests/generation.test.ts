import assert from "node:assert/strict";
import { test } from "node:test";
import { type GenTrace, generateNotes, generateTrack, snapNotesToGrid } from "../lib/generate.ts";
import type { HumFrame } from "../lib/hum.ts";
import { DEFAULT_HARMONY } from "../lib/music/harmony.ts";
import { INSTRUMENTS, type Note, type QuantizeDivision } from "../lib/tracks.ts";
import { pitchFrames } from "./fixtures/transcription.ts";

const instrument = (id: string) => INSTRUMENTS.find(i => i.id === id)!;
/** Highest note at each start beat: the hummed line inside a Keys chord part. */
const topVoice = (notes: Note[]) =>
  notes.filter(n => !notes.some(o => o.startBeat === n.startBeat && o.midi > n.midi));
const timing = (notes: Note[]) => notes.map(({ midi, startBeat, durationBeats }) => ({ midi, startBeat, durationBeats }));

test("the reported held-note fragmentation stays one note across tempos and grids", () => {
  const frames = pitchFrames(Array.from({ length: 6 }, () => [
    { midi: 60, durationSec: 0.4 }, { midi: 61, durationSec: 0.1 },
  ]).flat());
  for (const bpm of [60, 120, 180]) for (const grid of ["off", "1/4", "1/8", "1/16"] as const) {
    const notes = generateNotes(instrument("melody"), frames, bpm, grid, DEFAULT_HARMONY);
    assert.equal(notes.length, 1, `${bpm} ${grid}`);
    assert.ok(notes[0].durationBeats >= 2.9 * bpm / 60);
  }
});

test("short dropouts have the same continuity at 60, 120, and 180 BPM", () => {
  const frames = pitchFrames([
    { midi: 60, durationSec: 0.8 }, { midi: null, durationSec: 0.12 },
    { midi: 60, durationSec: 0.8 },
  ]);
  for (const bpm of [60, 120, 180])
    assert.equal(generateNotes(instrument("melody"), frames, bpm, "1/16", DEFAULT_HARMONY).length, 1);
});

test("harmony correction merges contiguous raw pitches that become identical", () => {
  const frames = pitchFrames([
    { midi: 60, durationSec: 0.6 }, { midi: 61, durationSec: 0.6 }, { midi: 60, durationSec: 0.6 },
  ]);
  // Keys plays a triad per hummed note; the hummed line is its top voice.
  const notes = generateNotes(instrument("keys"), frames, 120, "off", DEFAULT_HARMONY);
  assert.equal(notes.length, 3);
  assert.ok(notes.every(n => n.startBeat === 0));
  const top = topVoice(notes);
  assert.equal(top.length, 1);
  assert.equal(top[0].midi, 60);
  assert.ok(Math.abs(top[0].durationBeats - frames.at(-1)!.tSec * 2) < 1e-9);
});

test("real rests survive harmony correction even when coarse snapping closes the gap", () => {
  const frames = pitchFrames([
    { midi: 60, durationSec: 0.4 }, { midi: null, durationSec: 0.2 },
    { midi: 61, durationSec: 0.4 },
  ]);
  const notes = topVoice(generateNotes(instrument("keys"), frames, 120, "1/4", DEFAULT_HARMONY));
  assert.equal(notes.length, 2);
  assert.equal(notes[0].midi, notes[1].midi);
  assert.equal(notes[0].startBeat + notes[0].durationBeats, notes[1].startBeat);
});

test("Off retains real onset and duration while quantized grids snap boundaries", () => {
  const frames = pitchFrames([{ midi: 60, durationSec: 1.36 }], 0.02, 0.13);
  const notes = generateNotes(instrument("melody"), frames, 120, "off", DEFAULT_HARMONY);
  assert.equal(notes.length, 1);
  assert.ok(Math.abs(notes[0].startBeat - 0.26) < 1e-9);
  assert.ok(Math.abs(notes[0].durationBeats - 2.68) < 1e-9);
  for (const [division, grid] of [["1/4", 1], ["1/8", 0.5], ["1/16", 0.25]] as const) {
    const snapped = generateNotes(instrument("melody"), frames, 120, division, DEFAULT_HARMONY);
    assert.equal(snapped[0].startBeat % grid, 0);
    assert.equal(snapped[0].durationBeats % grid, 0);
  }
});

test("a genuine melodic change is retained and quantization never makes overlapping notes", () => {
  const frames = pitchFrames([{ midi: 60, durationSec: 0.8 }, { midi: 64, durationSec: 0.8 }]);
  const notes = generateNotes(instrument("melody"), frames, 120, "1/16", DEFAULT_HARMONY);
  assert.equal(notes.length, 2);
  assert.notEqual(notes[0].midi, notes[1].midi);
  assert.ok(notes[0].startBeat + notes[0].durationBeats <= notes[1].startBeat);
});

test("every melodic instrument stays in range with valid finite notes and unique ids", () => {
  const frames = pitchFrames([{ midi: 48, durationSec: 0.8 }, { midi: 55, durationSec: 0.8 }]);
  for (const inst of INSTRUMENTS.filter(i => i.kind === "synth")) {
    const notes = generateNotes(inst, frames, 120, "1/16", DEFAULT_HARMONY);
    assert.ok(notes.length > 0);
    assert.equal(new Set(notes.map(n => n.id)).size, notes.length);
    for (const n of notes) {
      assert.ok(Number.isInteger(n.midi) && n.midi >= inst.lo && n.midi <= inst.hi);
      assert.ok(Number.isFinite(n.startBeat) && n.startBeat >= 0);
      assert.ok(Number.isFinite(n.durationBeats) && n.durationBeats > 0);
      assert.ok(n.startBeat + n.durationBeats <= 32);
    }
  }
});

test("empty/invalid melodic input returns [] and timeline ends clip at beat 32", () => {
  const inst = instrument("melody");
  assert.deepEqual(generateNotes(inst, [], 120, "off", DEFAULT_HARMONY), []);
  assert.deepEqual(generateNotes(inst, pitchFrames([{ midi: null, durationSec: 1 }]), 120, "off", DEFAULT_HARMONY), []);
  assert.deepEqual(generateNotes(inst, pitchFrames([{ midi: NaN, durationSec: 1 }]), 120, "off", DEFAULT_HARMONY), []);
  const notes = generateNotes(inst, pitchFrames([{ midi: 60, durationSec: 1 }], 0.02, 15.8), 120, "off", DEFAULT_HARMONY);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].startBeat + notes[0].durationBeats, 32);
});

test("invalid BPM/grid and oversized frames reject before producing notes", () => {
  const inst = instrument("melody");
  for (const bpm of [NaN, Infinity, 0, 59, 181])
    assert.throws(() => generateNotes(inst, [], bpm, "off", DEFAULT_HARMONY), RangeError);
  for (const division of ["constructor", "1/32"])
    assert.throws(() => generateNotes(inst, [], 120, division as QuantizeDivision, DEFAULT_HARMONY), RangeError);
  const frame = pitchFrames([{ midi: 60, durationSec: 0.2 }])[0];
  assert.throws(() => generateNotes(inst, Array(10_001).fill(frame), 120, "off", DEFAULT_HARMONY), RangeError);
});

test("generation never mutates source frames and drum Off onsets are unsnapped", () => {
  const frames = Object.freeze(pitchFrames([{ midi: 60, durationSec: 0.6 }], 0.02, 0.13).map(f => Object.freeze(f)));
  assert.ok(generateNotes(instrument("melody"), frames, 120, "off", DEFAULT_HARMONY).length);
  const drums = generateNotes(instrument("drums"), frames, 120, "off", DEFAULT_HARMONY);
  assert.ok(drums.some(n => n.midi !== 42 && n.startBeat === 0.26));
});

test("the existing async recording seam uses the same stable generation path", async () => {
  const frames = pitchFrames([{ midi: 60, durationSec: 0.6 }]);
  const expected = generateNotes(instrument("melody"), frames, 120, "off", DEFAULT_HARMONY);
  const actual = await generateTrack(instrument("melody"), frames, 120, "off", DEFAULT_HARMONY);
  assert.deepEqual(timing(actual), timing(expected));
});

test("a silent drum take returns no notes, not fill-in hats", () => {
  const frames = pitchFrames([{ midi: null, durationSec: 2 }]);
  assert.deepEqual(generateNotes(instrument("drums"), frames, 120, "1/8", DEFAULT_HARMONY), []);
});

test("malformed drum analysis cannot create non-finite notes or crash classification", () => {
  const frame = pitchFrames([{ midi: 60, durationSec: 0.2 }])[0];
  for (const rms of [NaN, Infinity, -1])
    assert.deepEqual(generateNotes(instrument("drums"), [{ ...frame, rms }], 120, "off", DEFAULT_HARMONY), []);
  for (const tSec of [NaN, Infinity, -1])
    assert.deepEqual(generateNotes(instrument("drums"), [{ ...frame, tSec }], 120, "off", DEFAULT_HARMONY), []);
  const malformed = [null, { ...frame, bins: null, zcrHz: NaN }, { ...frame, tSec: -1 }] as unknown as HumFrame[];
  const notes = generateNotes(instrument("drums"), malformed, 120, "off", DEFAULT_HARMONY);
  for (const note of notes) {
    assert.ok(Number.isFinite(note.startBeat) && note.startBeat >= 0);
    assert.ok(Number.isFinite(note.durationBeats) && note.durationBeats > 0);
    assert.ok(Number.isFinite(note.velocity) && note.velocity >= 0 && note.velocity <= 1);
  }
});

test("drum attacks clip at beat 32 and out-of-song hits cannot create fill-in hats", () => {
  const frames = pitchFrames([{ midi: 45, durationSec: 0.04 }], 0.02, 15.9);
  for (const quantize of ["off", "1/4", "1/8", "1/16"] as const) {
    for (const note of generateNotes(instrument("drums"), frames, 120, quantize, DEFAULT_HARMONY))
      assert.ok(note.startBeat + note.durationBeats <= 32, quantize);
    assert.deepEqual(generateNotes(instrument("drums"), frames.map(frame => ({ ...frame, tSec: frame.tSec + 10 })),
      120, quantize, DEFAULT_HARMONY), []);
  }
});

test("Snap preserves hand-edited polyphonic overlaps and ids while bounding the timeline", () => {
  const notes = Object.freeze([
    Object.freeze({ id: "a", midi: 60, startBeat: 0.26, durationBeats: 2.5, velocity: 0.8 }),
    Object.freeze({ id: "b", midi: 64, startBeat: 0.8, durationBeats: 2.1, velocity: 0.6 }),
  ]);
  const snapped = snapNotesToGrid(instrument("keys"), notes, "1/4");
  assert.deepEqual(snapped.map(note => note.id), ["a", "b"]);
  assert.deepEqual(snapped.map(note => note.midi), [60, 64]);
  assert.ok(snapped[0].startBeat + snapped[0].durationBeats > snapped[1].startBeat);
  assert.equal(notes[0].startBeat, 0.26);
  const off = snapNotesToGrid(instrument("keys"), notes, "off");
  assert.deepEqual(off, notes);
  assert.notEqual(off[0], notes[0]);
  const lastHit = { id: "hit", midi: 36, startBeat: 31.65, durationBeats: 0.35, velocity: 0.8 };
  for (const quantize of ["1/4", "1/8", "1/16"] as const) {
    const [hit] = snapNotesToGrid(instrument("drums"), [lastHit], quantize);
    assert.ok(hit.startBeat + hit.durationBeats <= 32);
    assert.ok(hit.durationBeats > 0);
  }
});

test("the trace records the unsnapped hummed line, and melody ids come from it", () => {
  const frames = pitchFrames([
    { midi: 60, durationSec: 0.55 }, { midi: 64, durationSec: 0.55 }, { midi: 67, durationSec: 0.55 }, { midi: 72, durationSec: 0.55 },
  ]);
  const trace = {} as GenTrace;
  const notes = generateNotes(instrument("melody"), frames, 120, "1/4", DEFAULT_HARMONY, undefined, trace);
  assert.ok(trace.voicedFrames > 0);
  assert.equal(trace.grid, 1);
  assert.deepEqual(trace.key, { tonic: 0, mode: "major" });
  assert.ok(trace.raw.length >= notes.length && notes.length >= 1);
  const rawIds = new Set(trace.raw.map((n) => n.id));
  for (const n of notes) assert.ok(rawIds.has(n.id), n.id);
  // Bass splits at barlines and Keys/Strings add voices, so only some of their ids come from raw.
  const drumTrace = {} as GenTrace;
  generateNotes(instrument("drums"), frames, 120, "1/4", DEFAULT_HARMONY, undefined, drumTrace);
  assert.ok(Array.isArray(drumTrace.raw));
});

test("Snap never creates same-pitch overlaps from hand-edited notes", () => {
  const notes = [
    { id: "a", midi: 60, startBeat: 0, durationBeats: 1.1, velocity: 0.8 },
    { id: "b", midi: 60, startBeat: 1.15, durationBeats: 1, velocity: 0.8 },
    { id: "c", midi: 62, startBeat: 0.5, durationBeats: 2, velocity: 0.8 },
  ];
  const snapped = snapNotesToGrid(instrument("keys"), notes, "1/4");
  const [a, b] = snapped.filter(n => n.midi === 60).sort((x, y) => x.startBeat - y.startBeat);
  assert.ok(a.startBeat + a.durationBeats <= b.startBeat + 1e-9);
  assert.equal(snapped.length, 3);
  const dupes = snapNotesToGrid(instrument("keys"), [notes[0], { ...notes[0], id: "d", startBeat: 0.05 }], "1/4");
  assert.equal(dupes.length, 1);
});

test("Snap never creates same-pitch overlaps from hand-edited notes", () => {
  const notes = [
    { id: "a", midi: 60, startBeat: 0, durationBeats: 1.1, velocity: 0.8 },
    { id: "b", midi: 60, startBeat: 1.15, durationBeats: 1, velocity: 0.8 },
    { id: "c", midi: 62, startBeat: 0.5, durationBeats: 2, velocity: 0.8 },
  ];
  const snapped = snapNotesToGrid(instrument("keys"), notes, "1/4");
  const [a, b] = snapped.filter(n => n.midi === 60).sort((x, y) => x.startBeat - y.startBeat);
  assert.ok(a.startBeat + a.durationBeats <= b.startBeat + 1e-9);
  assert.equal(snapped.length, 3);
  const dupes = snapNotesToGrid(instrument("keys"), [notes[0], { ...notes[0], id: "d", startBeat: 0.05 }], "1/4");
  assert.equal(dupes.length, 1);
});
