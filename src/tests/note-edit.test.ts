import assert from "node:assert/strict";
import { test } from "node:test";
import { addNote, fits, moveNote, repeatFirstHalf, resizeNote } from "../lib/note-edit.ts";
import type { Note } from "../lib/tracks.ts";

const n = (id: string, midi: number, startBeat: number, durationBeats = 1): Note => ({ id, midi, startBeat, durationBeats, velocity: 0.8 });
const lane = [n("a", 60, 0, 2), n("b", 60, 4, 2), n("c", 62, 2, 1)];

test("notes on one pitch may touch but not overlap; other pitches and chords are free", () => {
  assert.ok(fits(n("x", 60, 2, 2), lane)); // fills the gap exactly
  assert.ok(!fits(n("x", 60, 1, 1), lane));
  assert.ok(fits(n("x", 64, 0, 4), lane)); // a chord tone over "a"
  assert.ok(!fits(n("x", 61, 31.5, 1), lane)); // past the end
});

test("moving onto another note slides to the nearest free spot or stays put", () => {
  const moved = moveNote(lane[2], { startBeat: 1, midi: 60 }, lane, 1)!;
  assert.deepEqual([moved.midi, moved.startBeat], [60, 2]); // slid right off "a" into the gap
  assert.equal(moveNote(n("c", 62, 2, 2), { startBeat: 0.5, midi: 60 }, lane, 0.25, 0.25), null); // nowhere near
  assert.equal(moveNote(lane[0], { startBeat: 30.5, midi: 60 }, lane, 1)!.startBeat, 30); // clamped to the timeline
});

test("stretching stops at the next note on the row and keeps a minimum length", () => {
  assert.equal(resizeNote(lane[0], "end", 9, lane, 0.25).durationBeats, 4); // up to "b"
  assert.equal(resizeNote(lane[0], "end", -3, lane, 0.25).durationBeats, 0.25);
  const left = resizeNote(lane[1], "start", 0, lane, 0.25);
  assert.deepEqual([left.startBeat, left.durationBeats], [2, 4]); // back to "a"'s end, end fixed
});

test("adding a note fits it into the gap or refuses", () => {
  assert.equal(addNote(n("x", 60, 3, 2), lane, 0.25)!.durationBeats, 1); // shortened to "b"
  assert.equal(addNote(n("x", 60, 1, 1), lane, 0.25), null); // inside "a"
});

test("repeat copies bars 1-4 onto 5-8 with new ids and replaces what was there", () => {
  let k = 0;
  const out = repeatFirstHalf([n("a", 60, 0, 2), n("long", 62, 15, 4), n("old", 64, 20)], () => `new${k++}`);
  assert.deepEqual(out.map((x) => [x.id, x.startBeat, x.durationBeats]), [["a", 0, 2], ["long", 15, 1], ["new0", 16, 2], ["new1", 31, 1]]);
});

test("invalid pitches, non-finite values and negative timeline positions never fit or move", () => {
  for (const patch of [
    { midi: NaN }, { midi: 128 }, { midi: 60.5 }, { startBeat: NaN }, { startBeat: -0.0000001 },
    { durationBeats: Infinity }, { durationBeats: NaN }, { velocity: NaN }, { velocity: 2 }, { id: "" },
  ]) {
    const invalid = { ...lane[0], ...patch };
    assert.equal(fits(invalid, lane), false);
    assert.equal(moveNote(invalid, { startBeat: 8, midi: 60 }, lane, 0.25), null);
  }
  for (const target of [{ startBeat: NaN, midi: 60 }, { startBeat: 8, midi: 60.5 }, { startBeat: 8, midi: 128 }])
    assert.equal(moveNote(lane[0], target, lane, 0.25), null);
});

test("invalid editing controls reject instead of hanging a note search or producing corrupt durations", () => {
  for (const step of [-1, NaN, Infinity, 0.00000001])
    assert.throws(() => moveNote(lane[2], { startBeat: 1, midi: 60 }, lane, step), RangeError);
  for (const reach of [-1, NaN, Infinity, 33])
    assert.throws(() => moveNote(lane[2], { startBeat: 1, midi: 60 }, lane, 0.25, reach), RangeError);
  for (const minLen of [0, -1, NaN, Infinity, 33]) {
    assert.throws(() => resizeNote(lane[0], "end", 3, lane, minLen), RangeError);
    assert.throws(() => addNote(n("new", 60, 8), lane, minLen), RangeError);
  }
  assert.throws(() => resizeNote(lane[0], "end", NaN, lane, 0.25), RangeError);
});

test("a coarser grid minimum cannot stretch finer notes through a neighbour or past beat 32", () => {
  const last = n("last", 60, 31.8, 0.2);
  const endClamped = resizeNote(last, "end", 40, [last], 1);
  assert.ok(endClamped.startBeat + endClamped.durationBeats <= 32);
  assert.ok(endClamped.durationBeats > 0);
  const short = n("short", 60, 3.8, 0.2);
  const next = n("next", 60, 4, 1);
  const neighbourClamped = resizeNote(short, "end", 10, [short, next], 1);
  assert.ok(neighbourClamped.startBeat + neighbourClamped.durationBeats <= next.startBeat);
  assert.ok(fits(neighbourClamped, [short, next]));
  const left = n("left", 60, 0, 0.5);
  const right = n("right", 60, 0.75, 0.25);
  const startClamped = resizeNote(right, "start", -1, [left, right], 1);
  assert.equal(startClamped.startBeat, 0.5);
  assert.ok(fits(startClamped, [left, right]));
});

test("adding and repeating reject reused ids and all successful operations keep input immutable", () => {
  assert.equal(addNote(n("a", 64, 8), lane, 0.25), null);
  assert.throws(() => repeatFirstHalf(lane, () => "a"), RangeError);
  assert.throws(() => repeatFirstHalf(lane, () => "same-new-id"), RangeError);
  assert.throws(() => repeatFirstHalf(lane, () => ""), RangeError);
  assert.throws(() => repeatFirstHalf([lane[0], { ...lane[0] }], () => "new"), RangeError);
  const frozen = Object.freeze(lane.map(note => Object.freeze({ ...note })));
  const before = structuredClone(frozen);
  let id = 0;
  const repeated = repeatFirstHalf(frozen, () => `copy-${id++}`);
  assert.equal(new Set(repeated.map(note => note.id)).size, repeated.length);
  moveNote(frozen[2], { startBeat: 8, midi: 60 }, frozen, 0.25);
  resizeNote(frozen[0], "end", 3, frozen, 0.25);
  addNote(n("new", 60, 8), frozen, 0.25);
  assert.deepEqual(frozen, before);
  assert.notEqual(repeated[0], frozen[0]);
});
