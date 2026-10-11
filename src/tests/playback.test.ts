import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlaybackEngine, type PlaybackBackend, type PlaybackState, type PlaybackVoice } from "../lib/audio/playback-engine.ts";
import * as playback from "../lib/playback.ts";
import { TOTAL_BEATS, toggleTrackFlag, type Track } from "../lib/tracks.ts";
import { playbackFixtureTracks } from "./fixtures/playback.ts";

class FakeBackend implements PlaybackBackend {
  ppq = 192;
  state: PlaybackState = "stopped";
  tick = 0;
  bpm = 120;
  loopEnd = 0;
  nextId = 0;
  starts = 0;
  events = new Map<number, { tick: number; callback: (time: number) => void }>();
  calls: { instrument: string; action: string; midi?: number; time?: number; velocity?: number }[] = [];
  loopListeners = new Set<(time: number) => void>();
  timers = new Map<number, { callback: () => void; delaySec: number }>();
  setTimeout(callback: () => void, delaySec: number) {
    const id = ++this.nextId;
    this.timers.set(id, { callback, delaySec });
    return id;
  }
  clearTimeout(id: number) { this.timers.delete(id); }
  now() { return 10; }
  positionTicks() { return this.tick; }
  seekTicks(ticks: number) { this.tick = ticks; }
  setBpm(bpm: number) { this.bpm = bpm; }
  setLoop(endTicks: number) { this.loopEnd = endTicks; }
  schedule(callback: (time: number) => void, tick: number) {
    const id = ++this.nextId;
    this.events.set(id, { tick, callback });
    return id;
  }
  clear(id: number) { this.events.delete(id); }
  start() { this.starts++; this.state = "started"; }
  pause() { this.state = "paused"; }
  stop() { this.state = "stopped"; this.tick = 0; }
  onLoopEnd(callback: (time: number) => void) {
    this.loopListeners.add(callback);
    return () => { this.loopListeners.delete(callback); };
  }
  createVoice(instrument: string): PlaybackVoice {
    this.calls.push({ instrument, action: "create" });
    return {
      attack: (midi, time, velocity) => { this.calls.push({ instrument, action: "attack", midi, time, velocity }); },
      release: (midi, time) => { this.calls.push({ instrument, action: "release", midi, time }); },
      releaseAll: (time) => { this.calls.push({ instrument, action: "releaseAll", time }); },
      dispose: () => { this.calls.push({ instrument, action: "dispose" }); },
    };
  }
  fire(beat: number, time = 20) {
    this.tick = beat * this.ppq;
    if (beat === TOTAL_BEATS) {
      this.loopListeners.forEach((listener) => listener(time));
      this.tick = 0;
    }
    this.events.forEach((event) => {
      if (event.tick === this.tick) event.callback(time);
    });
  }
}

function setup() {
  const backend = new FakeBackend();
  const engine = createPlaybackEngine(backend);
  return { backend, engine, tracks: playbackFixtureTracks() };
}

test("all five instruments attack together using callback audio time and exact velocity", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  assert.equal(backend.calls.length, 0, "no synthesis while scheduling a stopped arrangement");
  engine.play();
  backend.fire(0, 42.5);
  const attacks = backend.calls.filter((call) => call.action === "attack");
  assert.deepEqual(new Set(attacks.map((call) => call.instrument)), new Set(tracks.map((track) => track.instrument.id)));
  for (const attack of attacks) assert.equal(attack.time, 42.5);
  assert.ok(attacks.some((call) => call.midi === 60 && call.velocity === 0.65));
  assert.ok(attacks.some((call) => call.instrument === "drums" && call.midi === 49));
});

test("tempo changes keep both onsets and releases on the same musical ticks", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  const ticks = [...backend.events.values()].map((event) => event.tick);
  const before = structuredClone(tracks);
  engine.play();
  backend.fire(0);
  backend.tick = backend.ppq / 2;
  engine.schedule(tracks, 60);
  assert.equal(engine.positionBeats(), 0.5);
  assert.equal(backend.bpm, 60);
  assert.deepEqual([...backend.events.values()].map((event) => event.tick), ticks);
  backend.fire(1, 23);
  assert.ok(backend.calls.some((call) => call.instrument === "melody" && call.action === "release" && call.time === 23));
  assert.deepEqual(tracks, before);
});

test("repeated scheduling/replaying clears owned callbacks without cancelling unrelated events", () => {
  const { backend, engine, tracks } = setup();
  const other = backend.schedule(() => {}, 999);
  engine.schedule(tracks, 120);
  const count = backend.events.size;
  const obsolete = [...backend.events.values()].at(-1)!.callback;
  for (let index = 0; index < 20; index++) {
    engine.schedule(tracks, 120);
    engine.play();
    engine.stop();
  }
  assert.equal(backend.events.size, count);
  assert.ok(backend.events.has(other));
  obsolete(30);
  assert.equal(backend.calls.filter((call) => call.action === "attack").length, 0);
});

test("pause silences voices, holds position, and resumes sustained notes only once", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  engine.play();
  backend.fire(0);
  backend.tick = backend.ppq / 2;
  engine.pause();
  assert.equal(engine.state(), "paused");
  assert.equal(engine.positionBeats(), 0.5);
  assert.equal(backend.calls.filter((call) => call.action === "dispose").length, 5);
  engine.play();
  const attacks = backend.calls.filter((call) => call.action === "attack").length;
  engine.play();
  assert.equal(backend.calls.filter((call) => call.action === "attack").length, attacks);
  assert.equal(backend.starts, 2);
  backend.fire(1);
  assert.ok(backend.calls.some((call) => call.instrument === "melody" && call.action === "release"));
});

test("stop resets while rewind preserves running/paused state", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  engine.play();
  backend.fire(4);
  engine.rewind();
  assert.equal(engine.state(), "started");
  assert.equal(engine.positionBeats(), 0);
  engine.pause();
  backend.tick = 2 * backend.ppq;
  engine.rewind();
  assert.equal(engine.state(), "paused");
  assert.equal(engine.positionBeats(), 0);
  engine.play();
  backend.fire(4);
  engine.stop();
  assert.equal(engine.state(), "stopped");
  assert.equal(engine.positionBeats(), 0);
});

test("backend honors supplied solo flags, mute wins, and a live mute silences old voices", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  engine.play();
  backend.fire(0);
  const next = tracks.map((track) => ({ ...track, solo: ["melody", "keys"].includes(track.instrument.id), muted: track.instrument.id === "keys" }));
  engine.schedule(next, 120);
  assert.equal(backend.calls.filter((call) => call.action === "dispose").length, 5);
  backend.calls = [];
  backend.fire(0);
  assert.deepEqual(backend.calls.filter((call) => call.action === "attack").map((call) => call.instrument), ["melody"]);
  next.find((track) => track.instrument.id === "keys")!.muted = false;
  engine.schedule(next, 120);
  backend.calls = [];
  backend.fire(0);
  assert.deepEqual(new Set(backend.calls.filter((call) => call.action === "attack").map((call) => call.instrument)), new Set(["melody", "keys"]));
});

test("exclusive studio solo transitions schedule one track, respect mute, and restore normal playback", () => {
  const { backend, engine, tracks } = setup();
  let current = tracks;
  engine.schedule(current, 120);
  engine.play();
  const heard = () => {
    engine.schedule(current, 120);
    backend.calls = [];
    backend.fire(0);
    return new Set(backend.calls.filter(call => call.action === "attack").map(call => call.instrument));
  };
  current = toggleTrackFlag(current, "bass", "solo");
  assert.deepEqual(heard(), new Set(["bass"]));
  current = toggleTrackFlag(current, "melody", "solo");
  assert.deepEqual(heard(), new Set(["melody"]));
  current = toggleTrackFlag(current, "melody", "muted");
  assert.deepEqual(heard(), new Set());
  assert.equal(current.find(track => track.instrument.id === "melody")?.solo, true);
  current = toggleTrackFlag(current, "melody", "solo");
  assert.deepEqual(heard(), new Set(["bass", "keys", "drums", "strings"]));
  current = toggleTrackFlag(current, "melody", "muted");
  assert.deepEqual(heard(), new Set(tracks.map(track => track.instrument.id)));
});

test("live pitch edits replace old events and recover notes spanning the playhead", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  engine.play();
  backend.fire(0);
  backend.tick = backend.ppq / 2;
  const melody = tracks.find((track) => track.instrument.id === "melody")!;
  melody.notes = [{ ...melody.notes[0], midi: 62 }];
  engine.schedule(tracks, 120);
  assert.deepEqual(backend.calls.filter((call) => call.instrument === "melody" && call.action === "attack").map((call) => call.midi), [60, 62]);
});

test("the eight-bar loop releases boundary notes and does not register unreachable releases", () => {
  const { backend, engine, tracks } = setup();
  tracks[0].notes = [{ ...tracks[0].notes[0], startBeat: 31, durationBeats: 10 }];
  engine.schedule(tracks, 120);
  assert.equal(backend.loopEnd, 32 * backend.ppq);
  assert.ok([...backend.events.values()].every((event) => event.tick < backend.loopEnd));
  engine.play();
  backend.fire(31);
  backend.fire(32, 55);
  assert.ok(backend.calls.some((call) => call.instrument === "melody" && call.action === "releaseAll" && call.time === 55));
});

test("invalid tempo fails before changing existing audio", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  const count = backend.events.size;
  for (const bpm of [NaN, Infinity, -1, 0, 59, 181]) assert.throws(() => engine.schedule(tracks, bpm), RangeError);
  assert.equal(backend.events.size, count);
});

test("dispose frees listeners/events/voices", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  engine.play();
  backend.fire(0);
  engine.dispose();
  assert.equal(backend.events.size, 0);
  assert.equal(backend.loopListeners.size, 0);
  assert.equal(backend.calls.filter((call) => call.action === "dispose").length, 5);
});

test("empty/zero-velocity/off-grid notes are silent and sub-tick durations remain positive", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule([], 120);
  assert.equal(backend.events.size, 0);
  tracks[0].notes = [
    { ...tracks[0].notes[0], startBeat: 32 },
    { ...tracks[0].notes[0], velocity: 0 },
    { ...tracks[0].notes[0], startBeat: 1, durationBeats: 0.0001 },
  ];
  engine.schedule([tracks[0]], 120);
  assert.deepEqual([...backend.events.values()].map((event) => event.tick).sort((a, b) => a - b), [192, 193]);
});

test("the public facade is safe to import, query, and tear down without browser globals", async () => {
  assert.equal(playback.getEngine(), null);
  playback.dispose();
  await assert.rejects(playback.ensureAudio(), /browser/);
});

test("overlapping equal-pitch notes use independent voices and adjacent notes release first", () => {
  const { backend, engine, tracks } = setup();
  const note = tracks[0].notes[0];
  tracks[0].notes = [
    { ...note, durationBeats: 4 },
    { ...note, id: "short", startBeat: 1, durationBeats: 1 },
    { ...note, id: "adjacent", startBeat: 2, durationBeats: 1 },
  ];
  engine.schedule([tracks[0]], 120);
  engine.play();
  backend.fire(0);
  backend.fire(1);
  assert.equal(backend.calls.filter((call) => call.action === "create").length, 2);
  backend.calls = [];
  backend.fire(2);
  assert.deepEqual(backend.calls.map((call) => call.action), ["release", "attack"]);
});

test("metronome accents downbeats and repeated toggles do not accumulate callbacks", () => {
  const { backend, engine } = setup();
  engine.schedule([], 120);
  engine.setMetronome(true);
  engine.setMetronome(true);
  assert.equal(backend.events.size, 32);
  engine.play();
  backend.fire(0, 30);
  backend.fire(1, 30.5);
  assert.deepEqual(backend.calls.filter((call) => call.action === "attack").map(({ midi, time }) => [midi, time]), [[84, 30], [76, 30.5]]);
  engine.setMetronome(false);
  assert.equal(backend.events.size, 0);
  assert.ok(backend.calls.some((call) => call.action === "dispose"));
});

test("duplicate or out-of-order metronome ticks cannot retrigger a voice; stopping resets the clock", () => {
  const { backend, engine } = setup();
  engine.schedule([], 120);
  engine.setMetronome(true);
  engine.play();
  for (const time of [30, 30, 30.0000001, 29.5, NaN, Infinity, 30.5, 31]) backend.fire(0, time);
  assert.deepEqual(backend.calls.filter(call => call.action === "attack").map(call => call.time), [30, 30.5, 31]);
  engine.stop();
  engine.play();
  backend.fire(0, 30);
  assert.equal(backend.calls.filter(call => call.action === "attack").at(-1)!.time, 30);
  assert.equal(backend.calls.filter(call => call.action === "create").length, 2);
  engine.dispose();
});

test("four-beat count-in uses BPM/audio-clock times and preserves the playhead", async () => {
  const { backend, engine } = setup();
  backend.tick = backend.ppq * 3;
  const beats: number[] = [];
  const pending = engine.countIn(120, (remaining) => beats.push(remaining));
  assert.deepEqual(backend.calls.filter((call) => call.action === "attack").map((call) => call.time), [10, 10.5, 11, 11.5]);
  assert.equal(backend.state, "paused");
  assert.equal(engine.positionBeats(), 3);
  [...backend.timers.values()].sort((a, b) => a.delaySec - b.delaySec).forEach((timer) => timer.callback());
  assert.equal(await pending, true);
  assert.deepEqual(beats, [4, 3, 2, 1]);
  assert.equal(backend.timers.size, 0);
});

test("stop/rewind/dispose cancel count-in timers, future clicks, and completion", async () => {
  for (const action of ["stop", "rewind", "dispose"] as const) {
    const { backend, engine } = setup();
    const beats: number[] = [];
    const pending = engine.countIn(60, (remaining) => beats.push(remaining));
    const old = [...backend.timers.values()].map((timer) => timer.callback);
    engine[action]();
    assert.equal(await pending, false);
    old.forEach((callback) => callback());
    assert.deepEqual(beats, []);
    assert.equal(backend.timers.size, 0);
    assert.equal(backend.calls.filter((call) => call.action === "dispose").length, 1);
  }
});

test("a count-in scheduling error cleans partially scheduled timers and the click voice", async () => {
  const { backend, engine } = setup();
  const scheduleTimer = backend.setTimeout.bind(backend);
  backend.setTimeout = (callback, delaySec) => {
    if (delaySec > 0) throw new Error("audio clock closed");
    return scheduleTimer(callback, delaySec);
  };
  await assert.rejects(engine.countIn(120), /audio clock closed/);
  assert.equal(backend.timers.size, 0);
  assert.equal(backend.calls.filter((call) => call.action === "dispose").length, 1);
  engine.stop();
});

class PresetBackend extends FakeBackend {
  selected: { instrument: string; presetId?: string }[] = [];
  prepared: string[][] = [];
  readyListeners = new Set<() => void>();
  freed = false;
  subscribePresets() { return () => {}; }
  createVoice(instrument: string, presetId?: string) {
    this.selected.push({ instrument, presetId });
    return super.createVoice(instrument);
  }
  async preparePresets(tracks: readonly Track[]) { this.prepared.push(tracks.map(t => t.instrument.id)); }
  onPresetReady(listener: () => void) {
    this.readyListeners.add(listener);
    return () => { this.readyListeners.delete(listener); };
  }
  dispose() { this.freed = true; }
}

test("switching a live track changes only its sound, preserves position, and replaces old voices", () => {
  const backend = new PresetBackend();
  const engine = createPlaybackEngine(backend);
  const tracks = playbackFixtureTracks();
  engine.schedule(tracks, 120); engine.play(); backend.fire(0);
  backend.tick = backend.ppq / 2;
  const before = structuredClone(tracks);
  const updated = tracks.map(t => t.instrument.id === "melody" ? { ...t, presetId: "melody.marimba" } : t);
  engine.schedule(updated, 180);
  assert.equal(engine.positionBeats(), 0.5);
  assert.equal(engine.state(), "started");
  assert.equal(backend.bpm, 180);
  assert.deepEqual(tracks, before);
  assert.equal(updated[0].notes, tracks[0].notes);
  assert.equal(backend.selected.filter(s => s.instrument === "melody").at(-1)!.presetId, "melody.marimba");
  assert.equal(backend.calls.filter(c => c.action === "dispose").length, 5);
  engine.dispose();
});

test("automatic preload respects notes, mute, and solo; explicit preload never starts playback", async () => {
  const backend = new PresetBackend();
  const engine = createPlaybackEngine(backend);
  const tracks = playbackFixtureTracks().map(t => ({ ...t, solo: t.instrument.id === "keys" }));
  engine.schedule(tracks, 120);
  assert.deepEqual(backend.prepared, [["keys"]]);
  await engine.prepare(tracks.filter(t => t.instrument.id === "strings"));
  assert.deepEqual(backend.prepared.at(-1), ["strings"]);
  assert.equal(backend.starts, 0);
  engine.dispose();
});

test("sample readiness refreshes the live schedule once and cannot resurrect a disposed engine", () => {
  const backend = new PresetBackend();
  const engine = createPlaybackEngine(backend);
  engine.schedule(playbackFixtureTracks(), 120); engine.play(); backend.fire(0);
  const count = backend.events.size;
  backend.tick = backend.ppq / 2;
  const ready = [...backend.readyListeners][0];
  ready();
  assert.equal(backend.events.size, count);
  assert.equal(engine.positionBeats(), 0.5);
  assert.equal(engine.state(), "started");
  engine.dispose();
  ready();
  assert.equal(backend.events.size, 0);
  assert.equal(backend.readyListeners.size, 0);
  assert.equal(backend.freed, true);
});

test("missing legacy preset fields use defaults and invalid selections preserve the previous schedule", () => {
  const backend = new PresetBackend();
  const engine = createPlaybackEngine(backend);
  const tracks = playbackFixtureTracks();
  delete (tracks[0] as Partial<Track>).presetId;
  engine.schedule(tracks, 120); engine.play(); backend.fire(0);
  assert.equal(backend.selected.find(s => s.instrument === "melody")!.presetId, "melody.flute");
  const count = backend.events.size;
  assert.throws(() => engine.schedule(tracks.map(t => ({ ...t, presetId: "__proto__" })), 120), RangeError);
  assert.equal(backend.events.size, count);
  assert.equal(backend.state, "started");
  engine.dispose();
});

test("background sample readiness does not cancel a click-only count-in", async () => {
  const backend = new PresetBackend();
  const engine = createPlaybackEngine(backend);
  engine.schedule([], 120);
  const counting = engine.countIn(120);
  const timers = backend.timers.size;
  [...backend.readyListeners][0]();
  assert.equal(backend.timers.size, timers);
  engine.stop();
  assert.equal(await counting, false);
  engine.dispose();
});

test("queued callbacks from a replaced arrangement cannot attack or release current notes", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule([tracks[0]], 120);
  const stale = [...backend.events.values()].map(event => event.callback);
  engine.play();
  backend.fire(0);
  backend.tick = backend.ppq / 2;
  const changed = [{ ...tracks[0], notes: [{ ...tracks[0].notes[0], midi: 62 }] }];
  engine.schedule(changed, 120);
  const count = backend.calls.length;
  stale.forEach(callback => callback(21));
  assert.equal(backend.calls.length, count);
  backend.fire(1, 22);
  assert.equal(backend.calls.at(-1)!.action, "release");
  assert.equal(backend.calls.at(-1)!.midi, 62);
  engine.dispose();
});

test("queued metronome callbacks cannot revive a disabled or replaced click schedule", () => {
  const { backend, engine } = setup();
  engine.schedule([], 120);
  engine.setMetronome(true);
  const stale = [...backend.events.values()].map(event => event.callback);
  engine.play();
  engine.setMetronome(false);
  stale.forEach(callback => callback(30));
  assert.equal(backend.calls.length, 0);
  engine.setMetronome(true);
  stale.forEach(callback => callback(31));
  assert.equal(backend.calls.length, 0);
  backend.fire(0, 32);
  assert.equal(backend.calls.filter(call => call.action === "attack").length, 1);
  engine.dispose();
});

test("disposed engines cannot restart transport, clicks, loads, or subscriptions", async () => {
  const backend = new PresetBackend();
  let subscriptions = 0;
  backend.subscribePresets = () => { subscriptions++; return () => {}; };
  const engine = createPlaybackEngine(backend);
  engine.schedule(playbackFixtureTracks(), 120);
  engine.play();
  backend.fire(0);
  engine.dispose();
  const calls = backend.calls.length;
  const starts = backend.starts;
  const prepared = backend.prepared.length;
  engine.play();
  engine.pause();
  engine.stop();
  engine.rewind();
  engine.setMetronome(true);
  engine.schedule(playbackFixtureTracks(), 120);
  await engine.prepare(playbackFixtureTracks());
  engine.subscribePresets(() => {})();
  assert.equal(await engine.countIn(120), false);
  assert.equal(backend.calls.length, calls);
  assert.equal(backend.starts, starts);
  assert.equal(backend.prepared.length, prepared);
  assert.equal(backend.events.size, 0);
  assert.equal(backend.timers.size, 0);
  assert.equal(subscriptions, 0);
  assert.equal(backend.state, "stopped");
});

test("invalid count-in BPM preserves playing audio and an already active count-in", async () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  engine.play();
  backend.fire(0);
  const calls = backend.calls.length;
  for (const bpm of [NaN, Infinity, 0, -1, 59, 181]) assert.throws(() => engine.countIn(bpm), RangeError);
  assert.equal(backend.state, "started");
  assert.equal(backend.calls.length, calls);
  const counting = engine.countIn(120);
  const timers = backend.timers.size;
  assert.throws(() => engine.countIn(0), RangeError);
  assert.equal(backend.timers.size, timers);
  engine.stop();
  assert.equal(await counting, false);
  engine.dispose();
});
