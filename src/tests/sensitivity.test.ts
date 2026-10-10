import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_NOTE_SENSITIVITY, NOTE_SENSITIVITY_LEVELS, isNoteSensitivity, noteSensitivityConfig, type NoteSensitivity } from "../lib/audio/note-sensitivity.ts";
import { SEGMENTATION_DEFAULTS, segmentPitchFrames } from "../lib/audio/segment-notes.ts";
import { generateNotes, generateTrack } from "../lib/generate.ts";
import { DEFAULT_HARMONY } from "../lib/music/harmony.ts";
import { INSTRUMENTS, type Note } from "../lib/tracks.ts";
import { pitchFrames } from "./fixtures/transcription.ts";

const instrument = (id: string) => INSTRUMENTS.find(inst => inst.id === id)!;
const values = (notes: Note[]) => notes.map(({ midi, startBeat, durationBeats, velocity }) => ({ midi, startBeat, durationBeats, velocity }));
const shiftedHum = (shift: number) => pitchFrames([
  { midi: 64, durationSec: 0.8 }, { midi: 64 + shift, durationSec: 0.8 },
]);

test("Low needs large changes, Medium accepts normal changes, and High accepts small changes", () => {
  const expected: Record<NoteSensitivity, number[]> = { low: [1, 1, 2], medium: [1, 2, 2], high: [2, 2, 2] };
  for (const level of NOTE_SENSITIVITY_LEVELS) {
    const counts = [0.6, 1, 2].map(shift => segmentPitchFrames(shiftedHum(shift), noteSensitivityConfig(level)).length);
    assert.deepEqual(counts, expected[level], level);
    // Downward movement has the same thresholds as upward movement.
    const falling = [-0.6, -1, -2].map(shift => segmentPitchFrames(shiftedHum(shift), noteSensitivityConfig(level)).length);
    assert.deepEqual(falling, expected[level], `${level} falling`);
  }
});

test("omitting sensitivity uses the original Medium thresholds and equals explicit Medium generation", () => {
  assert.equal(DEFAULT_NOTE_SENSITIVITY, "medium");
  assert.deepEqual(SEGMENTATION_DEFAULTS, { stableMs: 120, silenceHoldMs: 150, minNoteMs: 100, medianWindow: 5, pitchToleranceSemitones: 0.7 });
  const frames = shiftedHum(1);
  assert.deepEqual(segmentPitchFrames(frames), segmentPitchFrames(frames, noteSensitivityConfig("medium")));
  assert.deepEqual(values(generateNotes(instrument("melody"), frames, 120, "off", DEFAULT_HARMONY)),
    values(generateNotes(instrument("melody"), frames, 120, "off", DEFAULT_HARMONY, "medium")));
});

test("all levels ignore a single noisy pitch spike", () => {
  const frames = pitchFrames([
    { midi: 64, durationSec: 0.8 }, { midi: 67, durationSec: 0.02 }, { midi: 64, durationSec: 0.8 },
  ]);
  for (const level of NOTE_SENSITIVITY_LEVELS) {
    const notes = segmentPitchFrames(frames, noteSensitivityConfig(level));
    assert.equal(notes.length, 1, level);
    assert.equal(notes[0].midi, 64);
    assert.equal(notes[0].endSec, frames.at(-1)!.tSec);
  }
});

test("High reacts sooner while Low suppresses brief pitch changes", () => {
  const frames = pitchFrames([
    { midi: 64, durationSec: 0.8 }, { midi: 67, durationSec: 0.1 }, { midi: 64, durationSec: 0.8 },
  ]);
  assert.equal(segmentPitchFrames(frames, noteSensitivityConfig("low")).length, 1);
  assert.equal(segmentPitchFrames(frames, noteSensitivityConfig("medium")).length, 1);
  const high = segmentPitchFrames(frames, noteSensitivityConfig("high"));
  assert.deepEqual(high.map(note => note.midi), [64, 67, 64]);
  assert.equal(high[0].endSec, high[1].startSec);
  assert.equal(high[1].endSec, high[2].startSec);
});

test("all sensitivity levels bridge short dropouts but preserve real rests at different frame hops", () => {
  for (const level of NOTE_SENSITIVITY_LEVELS) for (const hopSec of [0.01, 0.02, 0.04]) {
    const config = noteSensitivityConfig(level);
    const short = pitchFrames([{ midi: 64, durationSec: 0.8 }, { midi: null, durationSec: 0.12 }, { midi: 64, durationSec: 0.8 }], hopSec);
    assert.equal(segmentPitchFrames(short, config).length, 1, `${level} ${hopSec}`);
    const rest = pitchFrames([{ midi: 64, durationSec: 0.8 }, { midi: null, durationSec: 0.24 }, { midi: 64, durationSec: 0.8 }], hopSec);
    const notes = segmentPitchFrames(rest, config);
    assert.equal(notes.length, 2, `${level} ${hopSec}`);
    assert.notEqual(notes[0].phraseId, notes[1].phraseId);
  }
});

test("tunable tolerances above one semitone hold intermediate pitches until a large enough change", () => {
  const frames = pitchFrames([
    { midi: 64, durationSec: 0.8 }, { midi: 66, durationSec: 0.8 }, { midi: 67, durationSec: 0.8 },
  ]);
  const config = { ...noteSensitivityConfig("medium"), pitchToleranceSemitones: 2.5 };
  assert.deepEqual(segmentPitchFrames(frames, config).map(note => note.midi), [64, 67]);
  assert.equal(config.pitchToleranceSemitones, 2.5);
});

test("selected sensitivity reaches generated melody notes across BPM and Snap settings without mutating input", () => {
  const frames = Object.freeze(shiftedHum(0.6).map(frame => Object.freeze(frame)));
  const before = structuredClone(frames);
  for (const bpm of [60, 120, 180]) for (const quantize of ["off", "1/4", "1/8", "1/16"] as const) {
    for (const level of NOTE_SENSITIVITY_LEVELS) {
      const inst = instrument("melody");
      const notes = generateNotes(inst, frames, bpm, quantize, DEFAULT_HARMONY, level);
      assert.equal(notes.length, level === "high" ? 2 : 1, `${bpm} ${quantize} ${level}`);
      for (const note of notes) {
        assert.ok(Number.isInteger(note.midi) && note.midi >= inst.lo && note.midi <= inst.hi);
        assert.ok(Number.isFinite(note.startBeat) && note.startBeat >= 0);
        assert.ok(Number.isFinite(note.durationBeats) && note.durationBeats > 0);
        assert.ok(note.startBeat + note.durationBeats <= 32);
      }
    }
  }
  assert.deepEqual(frames, before);
});

test("pitch sensitivity does not alter drum onsets, pitches, or rhythm snapping", () => {
  const frames = shiftedHum(0.6);
  for (const quantize of ["off", "1/4", "1/8", "1/16"] as const) {
    const expected = values(generateNotes(instrument("drums"), frames, 120, quantize, DEFAULT_HARMONY));
    for (const level of NOTE_SENSITIVITY_LEVELS)
      assert.deepEqual(values(generateNotes(instrument("drums"), frames, 120, quantize, DEFAULT_HARMONY, level)), expected);
  }
});

test("confirmed Melody semitone changes survive a dominant tonic instead of being merged by harmony", () => {
  const frames = pitchFrames([{ midi: 64, durationSec: 2 }, { midi: 65, durationSec: 0.8 }]);
  for (const level of ["medium", "high"] as const) {
    const notes = generateNotes(instrument("melody"), frames, 120, "off", DEFAULT_HARMONY, level);
    assert.equal(notes.length, 2, level);
    assert.equal(notes[1].midi - notes[0].midi, 1);
  }
  assert.equal(generateNotes(instrument("melody"), frames, 120, "off", DEFAULT_HARMONY, "low").length, 1);
});

test("unknown, wrong-type, and prototype sensitivity values reject without modifying notes or frames", () => {
  const frames = shiftedHum(1);
  const before = structuredClone(frames);
  assert.equal(isNoteSensitivity(undefined), false);
  assert.equal(noteSensitivityConfig(), noteSensitivityConfig("medium"));
  for (const value of ["constructor", "__proto__", "maximum", "x".repeat(10000), null, 1, {}, ["low"]]) {
    assert.equal(isNoteSensitivity(value), false);
    assert.throws(() => noteSensitivityConfig(value as NoteSensitivity), RangeError);
    for (const inst of [instrument("melody"), instrument("drums")])
      assert.throws(() => generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, value as NoteSensitivity), RangeError);
  }
  assert.deepEqual(frames, before);
});

test("the async recording seam forwards the selected High sensitivity to generation", async () => {
  const frames = shiftedHum(0.6);
  const inst = instrument("melody");
  const expected = generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, "high");
  const actual = await generateTrack(inst, frames, 120, "off", DEFAULT_HARMONY, "high");
  assert.equal(actual.length, 2);
  assert.deepEqual(values(actual), values(expected));
});
