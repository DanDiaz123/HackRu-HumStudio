import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlaybackEngine, type PlaybackBackend, type PlaybackState, type PlaybackVoice } from "../lib/audio/playback-engine";
import * as playback from "../lib/playback";
import { TOTAL_BEATS, type Note } from "../lib/tracks";
import { playbackFixtureTracks } from "./fixtures/playback";

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

test("mute wins over solo, multiple solos combine, and a live mute silences old voices", () => {
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

test("invalid tempo/notes and oversized arrays fail before changing existing audio", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  const count = backend.events.size;
  for (const bpm of [NaN, Infinity, -1, 0, 59, 181]) assert.throws(() => engine.schedule(tracks, bpm), RangeError);
  const note = tracks[0].notes[0];
  const invalid: Partial<Note>[] = [
    { midi: NaN }, { midi: -1 }, { midi: 128 }, { midi: 60.5 },
    { startBeat: -1 }, { startBeat: Infinity }, { durationBeats: 0 },
    { durationBeats: NaN }, { velocity: -0.1 }, { velocity: 1.1 }, { velocity: Infinity },
  ];
  for (const fields of invalid) {
    const bad = tracks.map((track, index) => index ? track : { ...track, notes: [{ ...note, ...fields }] });
    assert.throws(() => engine.schedule(bad, 120), TypeError);
    assert.equal(backend.events.size, count);
  }
  assert.throws(() => engine.schedule([{ ...tracks[0], notes: Array.from({ length: 10_001 }, () => note) }], 120), RangeError);
  assert.equal(backend.events.size, count);
});

test("unknown/prototype instrument IDs and duplicate tracks are rejected", () => {
  const { engine, tracks } = setup();
  for (const id of ["__proto__", "constructor", "unknown"]) {
    assert.throws(() => engine.schedule([{ ...tracks[0], instrument: { ...tracks[0].instrument, id } }], 120), TypeError);
  }
  assert.throws(() => engine.schedule([tracks[0], tracks[0]], 120), TypeError);
});

test("dispose frees listeners/events/voices once and retired callbacks cannot play", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  engine.play();
  backend.fire(0);
  const old = [...backend.events.values()].at(-1)!.callback;
  engine.dispose();
  engine.dispose();
  const count = backend.calls.length;
  old(22);
  assert.equal(backend.calls.length, count);
  assert.equal(backend.events.size, 0);
  assert.equal(backend.loopListeners.size, 0);
  assert.equal(backend.calls.filter((call) => call.action === "dispose").length, 5);
  assert.equal(engine.positionBeats(), 0);
  assert.throws(() => engine.play(), /disposed/);
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
  assert.equal(playback.positionBeats(), 0);
  assert.equal(playback.state(), "stopped");
  playback.pause();
  playback.stop();
  playback.rewind();
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

test("pathological polyphony and unsupported drum lanes fail before replacing the schedule", () => {
  const { backend, engine, tracks } = setup();
  engine.schedule(tracks, 120);
  const count = backend.events.size;
  assert.throws(() => engine.schedule([{ ...tracks[0], notes: Array.from({ length: 33 }, (_, index) => ({ ...tracks[0].notes[0], id: `overlap-${index}`, startBeat: 0 })) }], 120), /simultaneous/);
  const drums = tracks.find((track) => track.instrument.id === "drums")!;
  assert.throws(() => engine.schedule([{ ...drums, notes: [{ ...drums.notes[0], midi: 60 }] }], 120), /Drum notes/);
  assert.equal(backend.events.size, count);
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
