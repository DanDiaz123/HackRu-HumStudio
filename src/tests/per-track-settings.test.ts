import assert from "node:assert/strict";
import { test } from "node:test";
import { detectTrackProfiles, generateNotes, renderTrackProfiles } from "../lib/generate.ts";
import { NOTE_SENSITIVITY_LEVELS } from "../lib/audio/note-sensitivity.ts";
import type { NoteSensitivity } from "../lib/audio/note-sensitivity.ts";
import { applyNoteSettings, captureArrangementSnapshot, projectArrangementSnapshot, type ArrangementSnapshot, type NoteSettingsInput, type RecordedTake } from "../lib/music/arrangement-settings.ts";
import { DEFAULT_HARMONY, inferHarmony } from "../lib/music/harmony.ts";
import { LEGACY_STORAGE_KEYS, STORAGE_KEY, newProjectMeta, parseProject, readAutosave, serializeProject, toProject } from "../lib/persistence/project.ts";
import { initialTracks, INSTRUMENTS, type Note } from "../lib/tracks.ts";
import type { QuantizeDivision } from "../lib/tracks.ts";
import { pitchFrames } from "./fixtures/transcription.ts";

const inst = (id: string) => INSTRUMENTS.find(i => i.id === id)!;
const musical = (notes: Note[]) => notes.map(({ midi, startBeat, durationBeats, velocity }) => ({ midi, startBeat, durationBeats, velocity }));
const frames = pitchFrames([{ midi: 64, durationSec: 0.83 }, { midi: 64.6, durationSec: 0.79 }]);
const take = (id = "melody", bpm = 93): RecordedTake => {
  const sources = detectTrackProfiles(inst(id), frames, bpm);
  return { bpm, sources, variants: renderTrackProfiles(inst(id), sources, bpm, "off", DEFAULT_HARMONY) };
};
const state = (patch: Partial<NoteSettingsInput> = {}): NoteSettingsInput => ({
  tracks: initialTracks().map(t => ({ ...t, quantize: "off" })), harmony: DEFAULT_HARMONY,
  takes: {}, snapSources: {}, harmonyDriver: null, keyOverride: null, ...patch,
});
const fullState = (input: NoteSettingsInput): ArrangementSnapshot => ({
  ...input, bpm: 150, meta: newProjectMeta(), pickedKey: input.keyOverride, harmonyDriver: input.harmonyDriver,
});
function saveState(input: NoteSettingsInput) {
  const p = fullState(input);
  return serializeProject({ ...p, regeneration: { takes: p.takes, snapSources: p.snapSources,
    pickedKey: p.pickedKey, harmonyDriver: p.harmonyDriver } });
}
const currentTrack = (input: { tracks: ReturnType<typeof initialTracks> }, id: string) => input.tracks.find(t => t.instrument.id === id)!;

test("every instrument starts with independent Medium and quarter-note defaults", () => {
  assert.equal(initialTracks().length, 5);
  for (const track of initialTracks()) {
    assert.equal(track.sensitivity, "medium"); assert.equal(track.quantize, "1/4");
  }
});
test("Melody sensitivity changes leave unrelated configuration, notes and caches intact", () => {
  const melody = take(), bass = take("bass");
  const input = state({ takes: { melody, bass }, trackId: "melody", sensitivity: "high" });
  const before = structuredClone(input), result = applyNoteSettings(input);
  assert.equal(currentTrack(result, "melody").sensitivity, "high");
  assert.equal(currentTrack(result, "bass").sensitivity, "medium");
  assert.equal(currentTrack(result, "bass"), currentTrack(input, "bass"));
  assert.equal(result.takes.bass, bass); assert.deepEqual(input, before);
});
test("Keys Snap changes only Keys, keeps chord overlaps and restores original timing with Off", () => {
  const chord = [60, 64, 67].map(midi => ({ id: "key-" + midi, midi, startBeat: 0.28, durationBeats: 0.71, velocity: 0.8 }));
  const input = state({ tracks: initialTracks().map(t => t.instrument.id === "keys" ? { ...t, notes: chord, sample: false } : t),
    trackId: "keys", quantize: "1/4", resnap: true });
  const snapped = applyNoteSettings(input);
  assert.equal(currentTrack(snapped, "strings"), currentTrack(input, "strings"));
  assert.equal(currentTrack(snapped, "keys").notes.length, 3);
  const off = applyNoteSettings({ ...input, ...snapped, quantize: "off" });
  assert.deepEqual(currentTrack(off, "keys").notes, chord);
});
test("saved musical detections reproduce the live pipeline at each capture tempo, profile and grid", () => {
  for (const id of ["melody", "bass", "keys", "strings"]) for (const bpm of [60, 93, 180]) {
    const sources = detectTrackProfiles(inst(id), frames, bpm);
    for (const grid of ["off", "1/4", "1/8", "1/16"] as const) {
      const rebuilt = renderTrackProfiles(inst(id), sources, bpm, grid, DEFAULT_HARMONY);
      for (const level of NOTE_SENSITIVITY_LEVELS)
        assert.deepEqual(musical(rebuilt[level]), musical(generateNotes(inst(id), frames, bpm, grid, DEFAULT_HARMONY, level)));
    }
  }
});
test("drum profiles detect different weak hits while preserving all five selected-part MIDI mappings", () => {
  const hits = pitchFrames([0.015, 0.03, 0.08].flatMap(rms => [
    { midi: null, durationSec: 0.06, rms }, { midi: null, durationSec: 0.5, rms: 0 },
  ]));
  for (const part of ["kick", "snare", "hat", "openHat", "crash"] as const) {
    const sources = detectTrackProfiles(inst("drums"), hits, 120, part);
    const variants = renderTrackProfiles(inst("drums"), sources, 120, "off", DEFAULT_HARMONY, "medium", undefined, part);
    assert.deepEqual(NOTE_SENSITIVITY_LEVELS.map(level => variants[level].length), [1, 2, 3]);
    for (const level of NOTE_SENSITIVITY_LEVELS)
      assert.deepEqual(musical(variants[level]), musical(generateNotes(inst("drums"), hits, 120, "off", DEFAULT_HARMONY, level, undefined, part)));
  }
});
test("shared harmony changes use dependent instruments' own grid and profile", () => {
  const input = state({ takes: { melody: take(), bass: take("bass") }, trackId: "melody", sensitivity: "high", harmonyDriver: "melody" });
  input.tracks = input.tracks.map(t => t.instrument.id === "bass" ? { ...t, sensitivity: "low", quantize: "1/8" } : t);
  const result = applyNoteSettings(input);
  assert.deepEqual(result.harmony, inferHarmony(result.takes.melody.variants.high));
  assert.equal(currentTrack(result, "bass").sensitivity, "low");
  assert.equal(currentTrack(result, "bass").quantize, "1/8");
  assert.deepEqual(musical(currentTrack(result, "bass").notes),
    musical(renderTrackProfiles(inst("bass"), result.takes.bass.sources, 93, "1/8", result.harmony).low));
});
test("a Drum Snap change updates all visible lanes and restores background timing with Off", () => {
  const sources = detectTrackProfiles(inst("drums"), pitchFrames([{ midi: null, durationSec: 0.3, rms: 0.2 }]), 120, "kick");
  const drums = { bpm: 120, drumPart: "kick" as const, sources,
    variants: renderTrackProfiles(inst("drums"), sources, 120, "off", DEFAULT_HARMONY, "medium", undefined, "kick") };
  const snare: Note = { id: "snare-raw", midi: 38, startBeat: 1.31, durationBeats: 0.5, velocity: 0.7 };
  const input = state({ tracks: initialTracks().map(t => t.instrument.id === "drums"
    ? { ...t, sample: false, notes: [...drums.variants.medium, snare], quantize: "off" } : t),
    takes: { drums }, trackId: "drums", quantize: "1/4", resnap: true });
  const snapped = applyNoteSettings(input);
  assert.equal(currentTrack(snapped, "drums").notes.find(n => n.id === snare.id)!.startBeat, 1);
  const reopened = projectArrangementSnapshot(parseProject(saveState({ ...input, ...snapped })));
  const off = applyNoteSettings({ ...state(), ...reopened, trackId: "drums", quantize: "off", resnap: true });
  assert.deepEqual(currentTrack(off, "drums").notes.find(n => n.id === snare.id), snare);
});
test("Melody harmony refits sample Keys pitches without undoing its independent rhythmic grid", () => {
  const snapped = applyNoteSettings(state({ trackId: "keys", quantize: "1/4", resnap: true }));
  const input = state({ ...snapped, takes: { melody: take() }, trackId: "melody", sensitivity: "high", harmonyDriver: "melody" });
  const result = applyNoteSettings(input);
  assert.deepEqual(currentTrack(result, "keys").notes.map(n => [n.id, n.startBeat, n.durationBeats]),
    currentTrack(input, "keys").notes.map(n => [n.id, n.startBeat, n.durationBeats]));
  assert.equal(currentTrack(result, "keys").quantize, "1/4");
});
test("v3 and autosave preserve all five independent settings, sounds, lanes, notes and metadata", () => {
  const input = state();
  input.tracks = input.tracks.map((t, index) => ({ ...t, sensitivity: NOTE_SENSITIVITY_LEVELS[index % 3],
    quantize: (["1/16", "1/4", "1/8", "off", "1/4"] as const)[index] }));
  const json = saveState(input), opened = parseProject(json);
  assert.equal(JSON.parse(json).schemaVersion, 3);
  assert.deepEqual(opened.tracks, input.tracks);
  const storage = new Map([[STORAGE_KEY, json]]);
  assert.deepEqual(readAutosave({ getItem: key => storage.get(key) ?? null }), opened);
});
test("a reopened take switches profiles and grid without analysis frames or changing capture BPM", () => {
  const input = state({ takes: { melody: take() }, trackId: "melody", sensitivity: "high", harmonyDriver: "melody" });
  const high = applyNoteSettings(input);
  const opened = projectArrangementSnapshot(parseProject(saveState({ ...input, ...high })));
  const low = applyNoteSettings({ ...state(), ...opened, trackId: "melody", sensitivity: "low", keyOverride: opened.pickedKey });
  assert.equal(currentTrack(low, "melody").notes.length, 1);
  const fine = applyNoteSettings({ ...state(), ...low, trackId: "melody", sensitivity: "high", quantize: "1/16", resnap: true, harmonyDriver: "melody" });
  const off = applyNoteSettings({ ...state(), ...fine, trackId: "melody", quantize: "off", resnap: true, harmonyDriver: "melody" });
  assert.deepEqual(musical(currentTrack(off, "melody").notes), musical(high.takes.melody.variants.high));
  assert.equal(off.takes.melody.bpm, 93);
});
test("manual unsnapped sources survive Save/Open and edited parts cannot restore old sensitivity variants", () => {
  const manual: Note = { id: "edited", midi: 67, startBeat: 0.28, durationBeats: 0.71, velocity: 0.7 };
  const input = state({ tracks: initialTracks().map(t => t.instrument.id === "melody" ? { ...t, notes: [manual], sample: false } : t),
    snapSources: { melody: [manual] }, trackId: "melody", quantize: "1/4", resnap: true });
  const snapped = applyNoteSettings(input);
  const opened = projectArrangementSnapshot(parseProject(saveState({ ...input, ...snapped })));
  const high = applyNoteSettings({ ...state(), ...opened, trackId: "melody", sensitivity: "high" });
  assert.deepEqual(currentTrack(high, "melody").notes, currentTrack(snapped, "melody").notes);
  const off = applyNoteSettings({ ...state(), ...high, trackId: "melody", quantize: "off", resnap: true });
  assert.deepEqual(currentTrack(off, "melody").notes, [manual]);
});
test("legacy v2 settings migrate to all instruments and unavailable sensitivity preserves loaded notes", () => {
  const saved = toProject(fullState(state()));
  const legacy = { ...saved, schemaVersion: 2, sensitivity: "high", quantize: "1/16",
    tracks: saved.tracks.map(track => ({ instrumentId: track.instrumentId, presetId: track.presetId, drumPart: track.drumPart,
      notes: track.notes, muted: track.muted, solo: track.solo, sample: track.sample })) };
  const opened = projectArrangementSnapshot(parseProject(JSON.stringify(legacy)));
  assert.ok(opened.tracks.every(t => t.sensitivity === "high" && t.quantize === "1/16"));
  assert.deepEqual(opened.tracks.map(t => t.notes), saved.tracks.map(t => t.notes));
  assert.deepEqual(opened.meta, { id: saved.id, name: saved.name, createdAt: saved.createdAt });
  const changed = applyNoteSettings({ ...state(), ...opened, trackId: "keys", sensitivity: "low" });
  assert.deepEqual(currentTrack(changed, "keys").notes, currentTrack(opened, "keys").notes);
  assert.equal(currentTrack(changed, "keys").sensitivity, "low");
});
test("legacy autosaves remain intact; corrupt v3 can recover valid v2 and migration writes to v3", () => {
  const current = toProject(fullState(state()));
  const legacy = { ...current, schemaVersion: 2, quantize: "1/8", sensitivity: "low",
    tracks: current.tracks.map(track => ({ instrumentId: track.instrumentId, presetId: track.presetId, drumPart: track.drumPart,
      notes: track.notes, muted: track.muted, solo: track.solo, sample: track.sample })) };
  const storage = new Map([[STORAGE_KEY, "{"], [LEGACY_STORAGE_KEYS[0], JSON.stringify(legacy)]]);
  const before = new Map(storage);
  const opened = readAutosave({ getItem: key => storage.get(key) ?? null });
  assert.ok(opened); assert.deepEqual(storage, before);
  assert.ok(opened.tracks.every(track => track.sensitivity === "low" && track.quantize === "1/8"));
  storage.set(STORAGE_KEY, serializeProject(opened));
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)!).schemaVersion, 3);
  assert.equal(storage.get(LEGACY_STORAGE_KEYS[0]), before.get(LEGACY_STORAGE_KEYS[0]));
});
test("setting changes and source caches survive history snapshots without shared container mutation", () => {
  const input = state({ takes: { melody: take() }, trackId: "melody", sensitivity: "high" });
  const before = captureArrangementSnapshot(fullState(input));
  const after = captureArrangementSnapshot(fullState({ ...input, ...applyNoteSettings(input) }));
  delete input.takes.melody;
  assert.equal(before.tracks[0].sensitivity, "medium");
  assert.equal(after.tracks[0].sensitivity, "high");
  assert.ok(before.takes.melody); assert.equal(after.takes.melody.bpm, 93);
});
test("source schemas reject malformed settings, unknown fields and invalid or duplicated musical data", () => {
  const input = state({ takes: { melody: take() }, trackId: "melody", sensitivity: "high" });
  const valid = JSON.parse(saveState({ ...input, ...applyNoteSettings(input) }));
  const patches = [
    (p: typeof valid) => { p.tracks[0].sensitivity = "extreme"; },
    (p: typeof valid) => { p.tracks[0].quantize = "__proto__"; },
    (p: typeof valid) => { p.regeneration.takes.melody.frames = []; },
    (p: typeof valid) => { p.regeneration.takes.melody.bpm = 0; },
    (p: typeof valid) => { delete p.regeneration.takes.melody.sources.high; },
    (p: typeof valid) => { p.regeneration.takes.melody.sources.high.phraseIds = [-1, 0]; },
    (p: typeof valid) => { p.regeneration.takes.melody.sources.high.notes[0].velocity = 2; },
    (p: typeof valid) => { p.regeneration.takes.melody.sources.high.notes[1].id = p.regeneration.takes.melody.sources.high.notes[0].id; },
    (p: typeof valid) => { p.regeneration.snapSources.kazoo = []; },
    (p: typeof valid) => { p.regeneration.pickedKey = { tonic: 0, mode: "major", unexpected: true }; },
  ];
  for (const patch of patches) { const p = structuredClone(valid); patch(p); assert.throws(() => parseProject(JSON.stringify(p)), /not a valid HumStudio project/); }
  assert.equal(currentTrack(input, "melody").sensitivity, "medium");
});
test("settings reject invalid runtime values without changing canonical notes or cached sources", () => {
  const input = state({ takes: { melody: take() }, trackId: "melody" }), before = structuredClone(input);
  for (const invalid of ["__proto__", "constructor", null, 1, {}]) {
    assert.throws(() => applyNoteSettings({ ...input, sensitivity: invalid as NoteSensitivity }), RangeError);
    assert.throws(() => applyNoteSettings({ ...input, quantize: invalid as QuantizeDivision }), RangeError);
  }
  assert.throws(() => applyNoteSettings({ ...input, trackId: "unknown" }), RangeError);
  assert.deepEqual(input, before);
});
test("regeneration rejects prototype keys at every new object boundary", () => {
  const input = state({ takes: { melody: take() }, trackId: "melody", sensitivity: "high" });
  const saved = JSON.parse(saveState({ ...input, ...applyNoteSettings(input) }));
  for (const field of ["__proto__", "constructor", "prototype", "unexpected"]) {
    for (const boundary of ["regeneration", "takes", "take", "profiles", "profile", "note"]) {
      const p = structuredClone(saved), data = p.regeneration, take = data.takes.melody, profiles = take.sources;
      const target = boundary === "regeneration" ? data : boundary === "takes" ? data.takes : boundary === "take" ? take
        : boundary === "profiles" ? profiles : boundary === "profile" ? profiles.high : profiles.high.notes[0];
      Object.defineProperty(target, field, { enumerable: true, value: { polluted: true } });
      assert.throws(() => parseProject(JSON.stringify(p)), /not a valid HumStudio project/);
    }
  }
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});
test("new saves include only musical sources, never full captures, audio, device data or clipboard", () => {
  const input = state({ takes: { melody: take() }, trackId: "melody", sensitivity: "high" });
  const json = saveState({ ...input, ...applyNoteSettings(input) });
  const saved = JSON.parse(json);
  assert.ok(saved.regeneration.takes.melody.sources.high.notes.length);
  assert.ok(saved.regeneration.takes.melody.sources.low.notes.length);
  for (const field of ["frames", "bins", "hz", "rms", "audio", "buffer", "deviceId", "clipboard", "variants"])
    assert.equal(json.includes('"' + field + '"'), false, field);
});
