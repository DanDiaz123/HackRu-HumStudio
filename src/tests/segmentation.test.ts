import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SEGMENTATION_FRAMES, segmentPitchFrames } from "../lib/audio/segment-notes.ts";
import { pitchFrames } from "./fixtures/transcription.ts";

test("a held pitch with repeated 100 ms semitone wobbles remains one continuous note", () => {
  const frames = pitchFrames(Array.from({ length: 6 }, () => [
    { midi: 60, durationSec: 0.4 }, { midi: 61, durationSec: 0.1 },
  ]).flat());
  const notes = segmentPitchFrames(frames);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].midi, 60);
  assert.equal(notes[0].startSec, 0);
  assert.equal(notes[0].endSec, frames.at(-1)!.tSec);
});

test("vibrato crossing the rounding boundary stays in the active pitch region", () => {
  const frames = pitchFrames([{ midi: 60.49, durationSec: 3 }]);
  for (const f of frames) f.hz = 440 * Math.pow(2, (60.49 + 0.15 * Math.sin(f.tSec * 2 * Math.PI * 6) - 69) / 12);
  assert.equal(segmentPitchFrames(frames).length, 1);
});

test("120 ms dropouts preserve the note and pitch history at different frame rates", () => {
  for (const hopSec of [0.01, 0.02, 0.04]) {
    const frames = pitchFrames([
      { midi: 60, durationSec: 0.8 }, { midi: null, durationSec: 0.12 },
      { midi: 60, durationSec: 0.8 },
    ], hopSec);
    const notes = segmentPitchFrames(frames);
    assert.equal(notes.length, 1, `hop ${hopSec}`);
    assert.equal(notes[0].endSec, frames.at(-1)!.tSec);
  }
});

test("a sustained change confirms a new note with contiguous backdated boundaries", () => {
  const notes = segmentPitchFrames(pitchFrames([
    { midi: 60, durationSec: 0.8 }, { midi: 62, durationSec: 0.8 },
  ]));
  assert.deepEqual(notes.map(n => n.midi), [60, 62]);
  assert.equal(notes[0].endSec, notes[1].startSec);
  assert.ok(notes[1].startSec >= 0.8 && notes[1].startSec <= 0.86);
  assert.equal(notes[0].phraseId, notes[1].phraseId);
});

test("silence at the hold threshold is bridged but longer silence separates notes", () => {
  for (const durationSec of [0.15, 0.16]) {
    const frames = pitchFrames([
      { midi: 60, durationSec: 0.6 }, { midi: null, durationSec },
      { midi: 60, durationSec: 0.6 },
    ], 0.01);
    assert.equal(segmentPitchFrames(frames).length, durationSec === 0.15 ? 1 : 2);
  }
});

test("low-confidence pitch dropouts use the same hold as explicit silence", () => {
  const frames = pitchFrames([
    { midi: 60, durationSec: 0.6 }, { midi: 60, durationSec: 0.12, rms: 0.005 },
    { midi: 60, durationSec: 0.6 },
  ], 0.04);
  assert.equal(segmentPitchFrames(frames).length, 1);
});

test("a real rest separates repeated notes and resets pitch history", () => {
  const notes = segmentPitchFrames(pitchFrames([
    { midi: 60, durationSec: 0.6 }, { midi: null, durationSec: 0.22 },
    { midi: 60, durationSec: 0.6 },
  ]));
  assert.equal(notes.length, 2);
  assert.notEqual(notes[0].phraseId, notes[1].phraseId);
  assert.ok(notes[1].startSec - notes[0].endSec >= 0.22);
});

test("a missing-frame gap is a rest even without explicit unvoiced frames", () => {
  const frames = [...pitchFrames([{ midi: 60, durationSec: 0.6 }]),
    ...pitchFrames([{ midi: 62, durationSec: 0.6 }], 0.02, 1)];
  const notes = segmentPitchFrames(frames);
  assert.deepEqual(notes.map(n => n.midi), [60, 62]);
  assert.notEqual(notes[0].phraseId, notes[1].phraseId);
});

test("empty, unvoiced, and short unconfirmed input emits no notes", () => {
  assert.deepEqual(segmentPitchFrames([]), []);
  assert.deepEqual(segmentPitchFrames(pitchFrames([{ midi: null, durationSec: 1 }])), []);
  assert.deepEqual(segmentPitchFrames(pitchFrames([{ midi: 60, durationSec: 0.08 }])), []);
});

test("invalid frequency/amplitude/timestamps cannot produce invalid notes", () => {
  const base = pitchFrames([{ midi: 60, durationSec: 0.6 }])[0];
  for (const hz of [NaN, Infinity, -1, 0, 1001])
    assert.deepEqual(segmentPitchFrames([{ ...base, hz, tSec: 0 }, { ...base, hz, tSec: 1 }]), []);
  for (const rms of [NaN, Infinity, -1, 0.005])
    assert.deepEqual(segmentPitchFrames([{ ...base, rms, tSec: 0 }, { ...base, rms, tSec: 1 }]), []);
  const frames = pitchFrames([{ midi: 60, durationSec: 0.6 }]);
  const input = [frames[0], { ...base, tSec: NaN }, { ...base, tSec: Infinity },
    { ...base, tSec: -1 }, frames[0], ...frames.slice(1), { ...base, tSec: 0.1 }];
  assert.deepEqual(segmentPitchFrames(input), segmentPitchFrames(frames));
});

test("bounded configuration and input size reject pathological work", () => {
  for (const stableMs of [NaN, Infinity, 0, -1, 1001])
    assert.throws(() => segmentPitchFrames([], { stableMs }), RangeError);
  assert.throws(() => segmentPitchFrames([], { medianWindow: 0 }), RangeError);
  assert.throws(() => segmentPitchFrames([], { medianWindow: 32 }), RangeError);
  for (const pitchToleranceSemitones of [NaN, Infinity, -1, 0.49, 3.01])
    assert.throws(() => segmentPitchFrames([], { pitchToleranceSemitones }), RangeError);
  const frame = pitchFrames([{ midi: 60, durationSec: 0.2 }])[0];
  assert.throws(() => segmentPitchFrames(Array(MAX_SEGMENTATION_FRAMES + 1).fill(frame)), RangeError);
});

test("segmentation accepts immutable input and a single-frame median window", () => {
  const frames = Object.freeze(pitchFrames([{ midi: 60, durationSec: 0.6 }]).map(f => Object.freeze(f)));
  assert.equal(segmentPitchFrames(frames, { medianWindow: 1 }).length, 1);
});

test("repeated syllables on one pitch re-strike when the level dips and returns", () => {
  const syllable = [{ midi: 57, durationSec: 0.3 }, { midi: 57, durationSec: 0.06, rms: 0.03 }];
  const notes = segmentPitchFrames(pitchFrames([...syllable, ...syllable, { midi: 57, durationSec: 0.3 }]));
  assert.deepEqual(notes.map(n => n.midi), [57, 57, 57]);
  assert.equal(new Set(notes.map(n => n.phraseId)).size, 3); // generation must not merge them back
  assert.ok(Math.abs(notes[1].startSec - 0.36) < 1e-9, `re-strike at ${notes[1].startSec}`);
});

test("a dip older than the re-attack window cannot split a held note after a short frame stall", () => {
  const frames = [
    ...pitchFrames([{ midi: 60, durationSec: 0.5 }]),
    { ...pitchFrames([{ midi: 60, durationSec: 0.02, rms: 0.03 }])[0], tSec: 0.5 },
    ...pitchFrames([{ midi: 60, durationSec: 0.6 }], 0.02, 0.64),
  ];
  const notes = segmentPitchFrames(frames);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].endSec, frames.at(-1)!.tSec);
});

test("a short octave slip folds back into the held note, a sustained leap does not", () => {
  const slip = segmentPitchFrames(pitchFrames([
    { midi: 57, durationSec: 0.5 }, { midi: 69, durationSec: 0.2 }, { midi: 57, durationSec: 0.5 },
  ]));
  assert.deepEqual(slip.map(n => n.midi), [57]);
  const leap = segmentPitchFrames(pitchFrames([{ midi: 57, durationSec: 0.5 }, { midi: 69, durationSec: 0.6 }]));
  assert.deepEqual(leap.map(n => n.midi), [57, 69]);
  assert.ok(Math.abs(leap[1].startSec - 0.5) <= 0.02, `leap starts at ${leap[1].startSec}`);
});

test("a scoop into a phrase's first note does not delay its start", () => {
  const notes = segmentPitchFrames(pitchFrames([
    { midi: null, durationSec: 0.3 }, { midi: 54, durationSec: 0.08 }, { midi: 57, durationSec: 0.6 },
  ]));
  assert.deepEqual(notes.map(n => n.midi), [57]);
  assert.equal(notes[0].startSec, 0.3);
});

test("a pitch change starts where it was sung, not where the median noticed it", () => {
  for (const hopSec of [0.01, 0.02, 0.04]) {
    const notes = segmentPitchFrames(pitchFrames([{ midi: 60, durationSec: 0.8 }, { midi: 64, durationSec: 0.8 }], hopSec));
    assert.ok(Math.abs(notes[1].startSec - 0.8) < 1e-9, `hop ${hopSec}: ${notes[1].startSec}`);
  }
});
