import assert from "node:assert/strict";
import { test } from "node:test";
import { getDrumMachineNames, getElectricPianoNames, getSoundfontNames, type NoteEvent } from "smplr";
import { DEFAULT_PRESET_IDS, INSTRUMENT_PRESETS, drumMapForPreset, presetForTrack, presetsForTrack, validatePresetCatalog } from "../lib/audio/instrument-presets.ts";
import { createPresetManager, type PresetStatus } from "../lib/audio/preset-manager.ts";
import { createSampledVoice, type SampledInstrument } from "../lib/audio/sampled-voice.ts";
import type { PlaybackVoice } from "../lib/audio/playback-engine.ts";
import { initialTracks, type Track } from "../lib/tracks.ts";

type StartedEvent = Exclude<NoteEvent, string | number>;
class FakeSample implements SampledInstrument {
  ready: Promise<void>;
  resolve!: () => void;
  reject!: (error: Error) => void;
  disposed = false;
  starts: StartedEvent[] = [];
  stops: { id?: string | number; time?: number }[] = [];
  drumMap?: ReadonlyMap<number, string>;
  constructor() {
    this.ready = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  }
  start(event: NoteEvent) {
    assert.equal(this.disposed, false);
    assert.equal(typeof event, "object");
    const started = event as StartedEvent;
    this.starts.push(started);
    return (time?: number) => { this.stops.push({ id: started.stopId, time }); };
  }
  dispose() { this.disposed = true; }
}
const track = (category: string, presetId?: string): Track => {
  const value = initialTracks().find(t => t.instrument.id === category)!;
  return { ...value, presetId: presetId ?? value.presetId };
};
function setup(timeoutMs = 1000) {
  const samples = new Map<string, FakeSample[]>();
  const fallback: string[] = [];
  const emptyVoice: PlaybackVoice = { attack() {}, release() {}, releaseAll() {}, dispose() {} };
  const manager = createPresetManager(preset => {
    const sample = new FakeSample();
    samples.set(preset.id, [...(samples.get(preset.id) ?? []), sample]);
    return sample;
  }, id => { fallback.push(id); return emptyVoice; }, () => 10, timeoutMs);
  const sample = (id: string) => samples.get(id)!.at(-1)!;
  return { manager, sample, samples, fallback };
}

test("each category has unique valid smplr presets and a sensible default", () => {
  const catalogs = { soundfont: getSoundfontNames(), electric: getElectricPianoNames(), drums: getDrumMachineNames() };
  assert.equal(new Set(INSTRUMENT_PRESETS.map(p => p.id)).size, INSTRUMENT_PRESETS.length);
  for (const t of initialTracks()) {
    assert.ok(presetsForTrack(t.instrument.id).length >= 3);
    assert.equal(t.presetId, DEFAULT_PRESET_IDS[t.instrument.id as keyof typeof DEFAULT_PRESET_IDS]);
  }
  INSTRUMENT_PRESETS.forEach(p => validatePresetCatalog(p, catalogs));
  assert.equal(INSTRUMENT_PRESETS.some(p => "instrument" in p && p.instrument === "TR-909"), false);
});

test("legacy missing selections use defaults; arbitrary/cross-category IDs are rejected", () => {
  assert.equal(presetForTrack("keys").id, "keys.grand");
  for (const id of ["strings.violin", "constructor", "__proto__", "https://example.com/sound", "<script>", "x".repeat(10000)])
    assert.throws(() => presetForTrack("keys", id), RangeError);
  assert.throws(() => presetForTrack("constructor"), RangeError);
  assert.throws(() => validatePresetCatalog(presetForTrack("melody"), { soundfont: [], electric: [], drums: [] }), RangeError);
});

test("all three drum kits map GM notes to verified, different group names", () => {
  for (const preset of presetsForTrack("drums")) {
    assert.equal(preset.family, "drum-machine");
    if (preset.family !== "drum-machine") continue;
    const groups = Object.values(preset.drumGroups);
    const mapping = drumMapForPreset(preset, groups, groups.map(name => `${name}/variant`));
    assert.deepEqual([...mapping.keys()], [36, 38, 42, 46, 49]);
    assert.equal(mapping.get(42), preset.drumGroups[42]);
    assert.throws(() => drumMapForPreset(preset, groups.slice(1), groups.map(name => `${name}/variant`)), RangeError);
    assert.throws(() => drumMapForPreset(preset, groups, []), RangeError);
  }
});

test("Casio hat aliases remain playable when both samples share a hihat group", () => {
  const preset = presetForTrack("drums", "drums.rz1");
  const mapping = drumMapForPreset(preset, ["kick", "snare", "hihat", "crash"],
    ["kick", "snare", "hihat-closed", "hihat-open", "crash"]);
  assert.equal(mapping.get(42), "hihat-closed");
  assert.equal(mapping.get(46), "hihat-open");
});

test("loads are lazy/deduplicated and never mutate MIDI notes", async () => {
  const { manager, sample, samples } = setup();
  const tracks = Object.freeze(initialTracks().map(t => Object.freeze(t)));
  const before = structuredClone(tracks);
  manager.sync(tracks);
  assert.equal(samples.size, 0);
  const keys = tracks.filter(t => t.instrument.id === "keys");
  const first = manager.prepare(keys);
  const second = manager.prepare(keys);
  assert.equal(samples.size, 1);
  assert.equal(samples.get("keys.grand")!.length, 1);
  sample("keys.grand").resolve();
  await Promise.all([first, second]);
  const statuses: PresetStatus[] = [];
  const unsubscribe = manager.subscribe(status => statuses.push(status));
  const snapshotCount = statuses.length;
  await manager.prepare(keys);
  assert.equal(statuses.at(-1)!.state, "ready");
  assert.equal(statuses.length, snapshotCount + 1, "repeat selection refreshes an already-loaded UI status");
  unsubscribe();
  assert.equal(samples.get("keys.grand")!.length, 1);
  assert.deepEqual(tracks, before);
  manager.dispose();
});

test("late completion cannot replace a newer selection", async () => {
  const { manager, sample } = setup();
  const statuses: PresetStatus[] = [];
  manager.subscribe(s => statuses.push(s));
  const first = manager.prepare([track("melody", "melody.flute")]);
  const old = sample("melody.flute");
  const latest = manager.prepare([track("melody", "melody.marimba")]);
  sample("melody.marimba").resolve();
  await latest;
  old.resolve();
  await first;
  assert.equal(old.disposed, true);
  assert.equal(statuses.at(-1)!.activePresetId, "melody.marimba");
  manager.dispose();
});

test("failed loads preserve the previous sample; retries can succeed", async () => {
  const { manager, sample } = setup();
  let status: PresetStatus | undefined;
  manager.subscribe(s => { status = s; });
  const first = manager.prepare([track("keys")]);
  const piano = sample("keys.grand");
  piano.resolve(); await first;
  const changed = [track("keys", "keys.wurlitzer")];
  const failure = manager.prepare(changed);
  sample("keys.wurlitzer").reject(new Error("offline")); await failure;
  assert.equal(status!.state, "fallback");
  assert.equal(status!.activePresetId, "keys.grand");
  assert.equal(piano.disposed, false);
  const voice = manager.createVoice("keys", "keys.wurlitzer");
  voice.attack(60, 12, 0.8);
  assert.equal(piano.starts.length, 1);
  voice.dispose();
  const retry = manager.prepare(changed, true);
  sample("keys.wurlitzer").resolve(); await retry;
  assert.equal(status!.activePresetId, "keys.wurlitzer");
  assert.equal(piano.disposed, true);
  manager.dispose();
});

test("first-load failure and timeout use synth fallback and free the failed node", async () => {
  const { manager, sample, fallback } = setup(10);
  let status: PresetStatus | undefined;
  manager.subscribe(s => { status = s; });
  await manager.prepare([track("bass")]);
  assert.equal(status!.state, "fallback");
  assert.equal(sample("bass.finger").disposed, true);
  manager.createVoice("bass", "bass.finger").dispose();
  assert.deepEqual(fallback, ["bass"]);
  assert.match(status!.message!, /original synth/);
  manager.dispose();
});

test("shared instruments are retired only after every voice releases its lease", async () => {
  const { manager, sample } = setup();
  const loaded = manager.prepare([track("strings")]);
  const ensemble = sample("strings.ensemble");
  ensemble.resolve(); await loaded;
  const first = manager.createVoice("strings", "strings.ensemble");
  const second = manager.createVoice("strings", "strings.ensemble");
  const changed = manager.prepare([track("strings", "strings.cello")]);
  sample("strings.cello").resolve(); await changed;
  first.dispose();
  assert.equal(ensemble.disposed, false);
  second.attack(60, 11, 0.7);
  second.dispose();
  assert.equal(ensemble.disposed, true);
  manager.dispose();
});

test("dispose cancels unresolved loads, listeners, and resources without later resurrection", async () => {
  const { manager, sample } = setup();
  const statuses: PresetStatus[] = [];
  manager.subscribe(s => statuses.push(s));
  let ready = 0;
  manager.onReady(() => ready++);
  const loading = manager.prepare([track("bass")]);
  const pending = sample("bass.finger");
  manager.dispose();
  const count = statuses.length;
  pending.resolve(); await loading;
  assert.equal(pending.disposed, true);
  assert.equal(statuses.length, count);
  assert.equal(ready, 0);
  assert.throws(() => manager.createVoice("bass"));
  manager.dispose();
});

test("sample adapter uses the exact audio clock and independent stop IDs for equal pitches", () => {
  const sample = new FakeSample();
  const voice = createSampledVoice(sample, () => 10, () => {});
  voice.attack(60, 12.25, 0.8);
  voice.attack(60, 12.5, 0.4);
  assert.deepEqual(sample.starts.map(({ note, time, velocity }) => [note, time, velocity]), [[60, 12.25, 102], [60, 12.5, 51]]);
  assert.notEqual(sample.starts[0].stopId, sample.starts[1].stopId);
  voice.release(60, 13); voice.release(60, 14);
  assert.deepEqual(sample.stops.map(({ id, time }) => [id, time]), [[sample.starts[0].stopId, 13], [sample.starts[1].stopId, 14]]);
  voice.dispose();
});

test("pause/disposal cancels pending attacks and earlier scheduled releases without disposing a shared sampler", () => {
  const sample = new FakeSample();
  let freed = 0;
  const voice = createSampledVoice(sample, () => 10, () => freed++);
  voice.attack(60, 9, 0.8); voice.release(60, 15);
  voice.attack(62, 12, 0.8);
  voice.dispose(); voice.dispose();
  assert.deepEqual(sample.stops.map(s => s.time), [15, 9, 10]);
  assert.equal(freed, 1);
  assert.equal(sample.disposed, false);
  voice.attack(64, 16, 0.8);
  assert.equal(sample.starts.length, 2);
});

test("one-shot drums ignore note-off, preserve retriggers, and stop on loop end/pause", () => {
  const sample = new FakeSample();
  sample.drumMap = new Map([[36, "kick"], [42, "closed"]]);
  const voice = createSampledVoice(sample, () => 10, () => {});
  voice.attack(36, 11, 0.8); voice.attack(36, 11.1, 0.8);
  voice.attack(49, 11.2, 0.8);
  voice.release(36, 11.5);
  assert.equal(sample.stops.length, 0);
  assert.deepEqual(sample.starts.map(s => s.note), ["kick", "kick"]);
  assert.notEqual(sample.starts[0].stopId, sample.starts[1].stopId);
  voice.releaseAll(20);
  assert.deepEqual(sample.stops.map(s => s.time), [20, 20]);
  voice.dispose();
});

test("ended notes are forgotten, normalized velocity is clamped, and invalid attacks are silent", () => {
  const sample = new FakeSample();
  const voice = createSampledVoice(sample, () => 10, () => {});
  for (const [midi, time, velocity] of [[NaN, 1, 1], [128, 1, 1], [60, NaN, 1], [60, -1, 1], [60, 1, Infinity], [60, 1, -1]]) voice.attack(midi, time, velocity);
  assert.equal(sample.starts.length, 0);
  voice.attack(60, 12, 2);
  assert.equal(sample.starts[0].velocity, 127);
  sample.starts[0].onEnded?.(sample.starts[0]);
  voice.dispose();
  assert.equal(sample.stops.length, 0);
});
