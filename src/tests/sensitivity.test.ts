import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_NOTE_SENSITIVITY, NOTE_SENSITIVITY_LEVELS, isNoteSensitivity, noteSensitivityConfig, type NoteSensitivity } from "../lib/audio/note-sensitivity.ts";
import { SEGMENTATION_DEFAULTS, segmentPitchFrames } from "../lib/audio/segment-notes.ts";
import { generateNotes, generateTrack, generateTrackVariants, type GenTrace } from "../lib/generate.ts";
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
  assert.deepEqual(SEGMENTATION_DEFAULTS, noteSensitivityConfig("medium"));
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

test("the post-dropout analysis RMS ramp stays one held note across sensitivity, tempo and grid", () => {
  // Shape observed through Edge's mic analysis: a zero gap, then partially filled windows
  // returning .063/.109/.141/.167/.185 RMS. This recovery is not a newly sung syllable.
  for (const firstRecoveredRms of [0.063, 0.109]) {
    const ramp = [firstRecoveredRms, 0.109, 0.141, 0.167, 0.185, 0.185];
    const frames = pitchFrames([
      { midi: 67, durationSec: 0.5, rms: 0.185 },
      { midi: null, durationSec: 0.04, rms: 0 },
      { midi: null, durationSec: 0.02, rms: 0.061 },
      ...ramp.map(rms => ({ midi: 67, durationSec: 0.02, rms })),
      { midi: 67, durationSec: 0.6, rms: 0.185 },
    ]);
    for (const level of NOTE_SENSITIVITY_LEVELS) {
      const segments = segmentPitchFrames(frames, noteSensitivityConfig(level));
      assert.equal(segments.length, 1, `${level} ${firstRecoveredRms}`);
      assert.equal(segments[0].endSec, frames.at(-1)!.tSec);
      for (const bpm of [60, 120, 180]) for (const grid of ["off", "1/4", "1/8", "1/16"] as const)
        assert.equal(generateNotes(instrument("melody"), frames, bpm, grid, DEFAULT_HARMONY, level).length,
          1, `${level} ${bpm} ${grid} ${firstRecoveredRms}`);
    }
  }
});

test("a genuine voiced re-attack still splits the note after dropout recovery ends", () => {
  const frames = pitchFrames([
    { midi: 67, durationSec: 0.5, rms: 0.185 },
    { midi: null, durationSec: 0.06 },
    { midi: 67, durationSec: 0.02, rms: 0.063 },
    { midi: 67, durationSec: 0.02, rms: 0.109 },
    { midi: 67, durationSec: 0.02, rms: 0.141 },
    { midi: 67, durationSec: 0.02, rms: 0.167 },
    { midi: 67, durationSec: 0.5, rms: 0.185 },
    { midi: 67, durationSec: 0.06, rms: 0.03 },
    { midi: 67, durationSec: 0.4, rms: 0.185 },
  ]);
  for (const level of NOTE_SENSITIVITY_LEVELS) {
    const notes = segmentPitchFrames(frames, noteSensitivityConfig(level));
    assert.deepEqual(notes.map(note => note.midi), [67, 67], level);
    assert.notEqual(notes[0].phraseId, notes[1].phraseId, level);
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

test("strong drum hits retain pitches and rhythm snapping across onset sensitivity levels", () => {
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

test("Low preserves confirmed chromatic pitches instead of adding an extra scale correction", () => {
  const frames = pitchFrames([
    { midi: 60, durationSec: 3 }, { midi: 66, durationSec: 0.8 }, { midi: 60, durationSec: 0.8 },
  ]);
  for (const level of NOTE_SENSITIVITY_LEVELS) {
    const notes = generateNotes(instrument("melody"), frames, 120, "off", DEFAULT_HARMONY, level);
    assert.equal(notes.length, 3, level);
    assert.equal(notes[1].midi - notes[0].midi, 6, level);
    assert.equal(notes[2].midi, notes[0].midi, level);
  }
});

test("each sensitivity retains re-attacks and distinguishes octave slips from sustained leaps", () => {
  const syllable = [{ midi: 57, durationSec: 0.3 }, { midi: 57, durationSec: 0.06, rms: 0.03 }];
  for (const level of NOTE_SENSITIVITY_LEVELS) {
    const config = noteSensitivityConfig(level);
    const repeated = segmentPitchFrames(pitchFrames([...syllable, ...syllable, { midi: 57, durationSec: 0.3 }]), config);
    assert.deepEqual(repeated.map(note => note.midi), [57, 57, 57], level);
    assert.equal(new Set(repeated.map(note => note.phraseId)).size, 3, level);
    const slip = segmentPitchFrames(pitchFrames([
      { midi: 57, durationSec: 0.5 }, { midi: 69, durationSec: 0.2 }, { midi: 57, durationSec: 0.5 },
    ]), config);
    assert.deepEqual(slip.map(note => note.midi), [57], level);
    const leap = segmentPitchFrames(pitchFrames([{ midi: 57, durationSec: 0.5 }, { midi: 69, durationSec: 0.6 }]), config);
    assert.deepEqual(leap.map(note => note.midi), [57, 69], level);
    assert.ok(Math.abs(leap[1].startSec - 0.5) <= 0.02, level);
  }
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
      assert.throws(() => generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, {} as GenTrace, value as NoteSensitivity), RangeError);
    assert.throws(() => generateTrackVariants(instrument("melody"), frames, 120, "off", DEFAULT_HARMONY, value as NoteSensitivity), RangeError);
  }
  assert.deepEqual(frames, before);
});

test("the trace API and sensitivity shorthand both remain supported and reject malformed arguments", () => {
  const frames = shiftedHum(0.6);
  const inst = instrument("melody");
  const trace = {} as GenTrace;
  const expected = generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, "high");
  assert.deepEqual(values(generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, trace, "high")), values(expected));
  assert.ok(trace.raw.length > 0);
  const upstreamTrace = {} as GenTrace;
  assert.deepEqual(values(generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, "high", upstreamTrace)), values(expected));
  assert.deepEqual(values(upstreamTrace.raw), values(trace.raw));
  const defaultTrace = {} as GenTrace;
  assert.deepEqual(values(generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, undefined, defaultTrace)),
    values(generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY)));
  for (const value of [null, 1, ["high"], true, new Date()])
    assert.throws(() => generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, value as unknown as GenTrace), RangeError);
  assert.throws(() => generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, "high", "low"), RangeError);
  assert.throws(() => generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, {} as GenTrace, {} as GenTrace), RangeError);
});

test("all cached variants match direct generation and only the selected profile writes the trace", () => {
  const frames = Object.freeze(shiftedHum(0.6).map(frame => Object.freeze(frame)));
  const before = structuredClone(frames);
  for (const id of ["melody", "bass", "keys", "strings", "drums"]) {
    const inst = instrument(id);
    const trace = {} as GenTrace;
    const variants = generateTrackVariants(inst, frames, 120, "1/16", DEFAULT_HARMONY, "high", trace);
    for (const level of NOTE_SENSITIVITY_LEVELS) {
      assert.deepEqual(values(variants[level]), values(generateNotes(inst, frames, 120, "1/16", DEFAULT_HARMONY, level)));
      assert.notEqual(variants[level], variants[NOTE_SENSITIVITY_LEVELS.find(other => other !== level)!]);
    }
    const expectedTrace = {} as GenTrace;
    generateNotes(inst, frames, 120, "1/16", DEFAULT_HARMONY, expectedTrace, "high");
    assert.deepEqual(values(trace.raw), values(expectedTrace.raw));
    assert.deepEqual(trace.key, expectedTrace.key);
    assert.equal(trace.grid, expectedTrace.grid);
  }
  assert.deepEqual(frames, before);
});

test("the async recording API rejects invalid sensitivity instead of interpreting it as a trace", async () => {
  for (const value of [null, 1, {}, ["low"]])
    await assert.rejects(generateTrack(instrument("melody"), shiftedHum(0.6), 120, "off", DEFAULT_HARMONY, value as NoteSensitivity), RangeError);
});

test("the async recording seam forwards the selected High sensitivity to generation", async () => {
  const frames = shiftedHum(0.6);
  const inst = instrument("melody");
  const expected = generateNotes(inst, frames, 120, "off", DEFAULT_HARMONY, "high");
  const actual = await generateTrack(inst, frames, 120, "off", DEFAULT_HARMONY, "high");
  assert.equal(actual.length, 2);
  assert.deepEqual(values(actual), values(expected));
});
