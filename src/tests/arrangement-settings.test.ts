import assert from "node:assert/strict";
import { test } from "node:test";
import { generateTrackVariants } from "../lib/generate.ts";
import { applyNoteSettings, type NoteSettingsInput, type RecordedTake } from "../lib/music/arrangement-settings.ts";
import { DEFAULT_HARMONY, fitToHarmony, inferHarmony } from "../lib/music/harmony.ts";
import { INSTRUMENTS, initialTracks, type Note } from "../lib/tracks.ts";
import { pitchFrames } from "./fixtures/transcription.ts";

const inst = (id: string) => INSTRUMENTS.find(instrument => instrument.id === id)!;
const values = (notes: Note[]) => notes.map(({ midi, startBeat, durationBeats, velocity }) => ({ midi, startBeat, durationBeats, velocity }));
const note = (midi: number, startBeat = 0.28, durationBeats = 0.71): Note =>
  ({ id: `manual-${midi}`, midi, startBeat, durationBeats, velocity: 0.8 });
const input = (patch: Partial<NoteSettingsInput> = {}): NoteSettingsInput => ({
  tracks: initialTracks(), harmony: DEFAULT_HARMONY, takes: {}, snapSources: {},
  sensitivity: "medium", quantize: "off", harmonyDriver: null, keyOverride: null, ...patch,
});
function take(id: string, bpm = 120): RecordedTake {
  const frames = pitchFrames([{ midi: 64, durationSec: 0.83 }, { midi: 64.6, durationSec: 0.79 }]);
  return { frames, bpm, variants: generateTrackVariants(inst(id), frames, bpm, "off", DEFAULT_HARMONY) };
}

test("profile switching uses precomputed note IDs and leaves original input/cache intact", () => {
  const melody = take("melody");
  const state = input({ takes: { melody }, sensitivity: "high" });
  const before = structuredClone(state);
  const next = applyNoteSettings(state);
  assert.equal(next.tracks.find(track => track.instrument.id === "melody")!.notes, melody.variants.high);
  assert.equal(next.takes.melody.variants, melody.variants);
  assert.deepEqual(state, before);
  assert.equal(next.tracks.find(track => track.instrument.id === "melody")!.notes.length, 2);
});

test("Snap regenerates each take at its capture tempo and Off returns original beat timing", () => {
  const melody = take("melody", 90);
  const state = input({ takes: { melody }, sensitivity: "high", quantize: "1/16", resnap: true });
  const snapped = applyNoteSettings(state);
  const expected = generateTrackVariants(inst("melody"), melody.frames, 90, "1/16", DEFAULT_HARMONY).high;
  assert.deepEqual(values(snapped.tracks.find(track => track.instrument.id === "melody")!.notes), values(expected));
  const restored = applyNoteSettings({ ...state, tracks: snapped.tracks, takes: snapped.takes,
    snapSources: snapped.snapSources, quantize: "off" });
  assert.deepEqual(values(restored.tracks.find(track => track.instrument.id === "melody")!.notes), values(melody.variants.high));
  assert.equal(restored.takes.melody.bpm, 90);
});

test("a picked key continues to correct a cached Melody after switching sensitivity", () => {
  const melody = take("melody");
  const next = applyNoteSettings(input({ takes: { melody }, sensitivity: "high", harmonyDriver: "melody",
    keyOverride: { tonic: 0, mode: "major" } }));
  const expected = fitToHarmony(melody.variants.high, inst("melody"), next.harmony);
  assert.deepEqual(next.tracks.find(track => track.instrument.id === "melody")!.notes, expected);
  assert.equal(next.harmony.tonic, 0);
  assert.equal(next.harmony.mode, "major");
});

test("Keys harmony changes preserve hand-edited Melody semitones and timing", () => {
  const tracks = initialTracks().map(track => track.instrument.id === "melody" ? { ...track, notes: [note(61)], sample: false } : track);
  const keys = take("keys");
  const cMajor = [note(60, 0, 3), note(64, 0, 3), note(67, 0, 3)];
  keys.variants = { low: cMajor, medium: cMajor, high: cMajor };
  const next = applyNoteSettings(input({ tracks, takes: { keys }, harmonyDriver: "keys" }));
  assert.notDeepEqual(next.harmony, DEFAULT_HARMONY);
  assert.deepEqual(next.tracks.find(track => track.instrument.id === "melody")!.notes, [note(61)]);
});

test("Snap updates overlapping manual chord notes, retains IDs, and restores unsnapped timing", () => {
  const chord = [note(60), note(64), note(67)];
  const tracks = initialTracks().map(track => track.instrument.id === "keys" ? { ...track, notes: chord, sample: false } : track);
  const snapped = applyNoteSettings(input({ tracks, quantize: "1/4", resnap: true }));
  const snappedChord = snapped.tracks.find(track => track.instrument.id === "keys")!.notes;
  assert.equal(snappedChord.length, 3);
  assert.ok(snappedChord.every(n => n.startBeat === 0 && n.durationBeats === 1));
  assert.deepEqual(snappedChord.map(n => n.id), chord.map(n => n.id));
  const finer = applyNoteSettings(input({ tracks: snapped.tracks, snapSources: snapped.snapSources, quantize: "1/16", resnap: true }));
  const restored = applyNoteSettings(input({ tracks: finer.tracks, snapSources: finer.snapSources, quantize: "off", resnap: true }));
  assert.deepEqual(restored.tracks.find(track => track.instrument.id === "keys")!.notes, chord);
  assert.equal(restored.tracks.find(track => track.instrument.id === "drums")!.sample, true);
});

test("a stricter profile that finds no notes retains the working part", () => {
  const melody = take("melody");
  melody.variants.low = [];
  const tracks = initialTracks().map(track => track.instrument.id === "melody" ? { ...track, notes: melody.variants.medium, sample: false } : track);
  const next = applyNoteSettings(input({ tracks, takes: { melody }, sensitivity: "low", harmonyDriver: "melody" }));
  assert.equal(next.tracks.find(track => track.instrument.id === "melody")!.notes, melody.variants.medium);
  assert.deepEqual(next.harmony, DEFAULT_HARMONY);
});

test("dependent captured Bass roles regenerate under the newly selected Melody harmony", () => {
  const melody = take("melody");
  const bass = take("bass");
  const next = applyNoteSettings(input({ takes: { melody, bass }, sensitivity: "high", harmonyDriver: "melody" }));
  assert.deepEqual(next.harmony, inferHarmony(melody.variants.high));
  const expected = generateTrackVariants(inst("bass"), bass.frames, bass.bpm, "off", next.harmony).high;
  assert.deepEqual(values(next.tracks.find(track => track.instrument.id === "bass")!.notes), values(expected));
});

test("explicit key changes keep the override while Keys remains the chord driver", () => {
  const keys = take("keys");
  const next = applyNoteSettings(input({ takes: { keys }, harmonyDriver: "keys", keyOverride: { tonic: 2, mode: "minor" }, fitEditedMelody: true }));
  assert.equal(next.harmony.tonic, 2);
  assert.equal(next.harmony.mode, "minor");
  const switched = applyNoteSettings(input({ tracks: next.tracks, harmony: next.harmony, takes: next.takes,
    snapSources: next.snapSources, sensitivity: "high", harmonyDriver: "keys", keyOverride: { tonic: 2, mode: "minor" } }));
  assert.equal(switched.harmony.tonic, 2);
  assert.equal(switched.harmony.mode, "minor");
});
