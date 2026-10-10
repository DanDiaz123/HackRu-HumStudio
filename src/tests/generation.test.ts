import assert from "node:assert/strict";
import { test } from "node:test";
import { type GenTrace, generateNotes } from "../lib/generate.ts";
import { DEFAULT_HARMONY } from "../lib/music/harmony.ts";
import { INSTRUMENTS, type Note, type QuantizeDivision } from "../lib/tracks.ts";
import { pitchFrames } from "./fixtures/transcription.ts";

const instrument = (id: string) => INSTRUMENTS.find(i => i.id === id)!;
/** Highest note at each start beat: the hummed line inside a Keys chord part. */
const topVoice = (notes: Note[]) =>
  notes.filter(n => !notes.some(o => o.startBeat === n.startBeat && o.midi > n.midi));

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

test("a silent drum take returns no notes, not fill-in hats", () => {
  const frames = pitchFrames([{ midi: null, durationSec: 2 }]);
  assert.deepEqual(generateNotes(instrument("drums"), frames, 120, "1/8", DEFAULT_HARMONY), []);
});

test("the trace records the unsnapped hummed line, and melody ids come from it", () => {
  const frames = pitchFrames([
    { midi: 60, durationSec: 0.55 }, { midi: 64, durationSec: 0.55 }, { midi: 67, durationSec: 0.55 }, { midi: 72, durationSec: 0.55 },
  ]);
  const trace = {} as GenTrace;
  const notes = generateNotes(instrument("melody"), frames, 120, "1/4", DEFAULT_HARMONY, undefined, trace);
  assert.ok(trace.voicedFrames > 0);
  assert.equal(trace.grid, 1);
  assert.ok(trace.raw.length >= notes.length && notes.length >= 1);
  const rawIds = new Set(trace.raw.map((n) => n.id));
  for (const n of notes) assert.ok(rawIds.has(n.id), n.id);
  // Bass splits at barlines and Keys/Strings add voices, so only some of their ids come from raw.
  const drumTrace = {} as GenTrace;
  generateNotes(instrument("drums"), frames, 120, "1/4", DEFAULT_HARMONY, undefined, drumTrace);
  assert.ok(Array.isArray(drumTrace.raw));
});
