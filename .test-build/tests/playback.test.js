"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const playback_engine_1 = require("../lib/audio/playback-engine");
const playback = __importStar(require("../lib/playback"));
const tracks_1 = require("../lib/tracks");
const playback_1 = require("./fixtures/playback");
class FakeBackend {
    constructor() {
        this.ppq = 192;
        this.state = "stopped";
        this.tick = 0;
        this.bpm = 120;
        this.loopEnd = 0;
        this.nextId = 0;
        this.starts = 0;
        this.events = new Map();
        this.calls = [];
        this.loopListeners = new Set();
        this.timers = new Map();
    }
    setTimeout(callback, delaySec) {
        const id = ++this.nextId;
        this.timers.set(id, { callback, delaySec });
        return id;
    }
    clearTimeout(id) { this.timers.delete(id); }
    now() { return 10; }
    positionTicks() { return this.tick; }
    seekTicks(ticks) { this.tick = ticks; }
    setBpm(bpm) { this.bpm = bpm; }
    setLoop(endTicks) { this.loopEnd = endTicks; }
    schedule(callback, tick) {
        const id = ++this.nextId;
        this.events.set(id, { tick, callback });
        return id;
    }
    clear(id) { this.events.delete(id); }
    start() { this.starts++; this.state = "started"; }
    pause() { this.state = "paused"; }
    stop() { this.state = "stopped"; this.tick = 0; }
    onLoopEnd(callback) {
        this.loopListeners.add(callback);
        return () => { this.loopListeners.delete(callback); };
    }
    createVoice(instrument) {
        this.calls.push({ instrument, action: "create" });
        return {
            attack: (midi, time, velocity) => { this.calls.push({ instrument, action: "attack", midi, time, velocity }); },
            release: (midi, time) => { this.calls.push({ instrument, action: "release", midi, time }); },
            releaseAll: (time) => { this.calls.push({ instrument, action: "releaseAll", time }); },
            dispose: () => { this.calls.push({ instrument, action: "dispose" }); },
        };
    }
    fire(beat, time = 20) {
        this.tick = beat * this.ppq;
        if (beat === tracks_1.TOTAL_BEATS) {
            this.loopListeners.forEach((listener) => listener(time));
            this.tick = 0;
        }
        this.events.forEach((event) => {
            if (event.tick === this.tick)
                event.callback(time);
        });
    }
}
function setup() {
    const backend = new FakeBackend();
    const engine = (0, playback_engine_1.createPlaybackEngine)(backend);
    return { backend, engine, tracks: (0, playback_1.playbackFixtureTracks)() };
}
(0, node_test_1.test)("all five instruments attack together using callback audio time and exact velocity", () => {
    const { backend, engine, tracks } = setup();
    engine.schedule(tracks, 120);
    strict_1.default.equal(backend.calls.length, 0, "no synthesis while scheduling a stopped arrangement");
    engine.play();
    backend.fire(0, 42.5);
    const attacks = backend.calls.filter((call) => call.action === "attack");
    strict_1.default.deepEqual(new Set(attacks.map((call) => call.instrument)), new Set(tracks.map((track) => track.instrument.id)));
    for (const attack of attacks)
        strict_1.default.equal(attack.time, 42.5);
    strict_1.default.ok(attacks.some((call) => call.midi === 60 && call.velocity === 0.65));
    strict_1.default.ok(attacks.some((call) => call.instrument === "drums" && call.midi === 49));
});
(0, node_test_1.test)("tempo changes keep both onsets and releases on the same musical ticks", () => {
    const { backend, engine, tracks } = setup();
    engine.schedule(tracks, 120);
    const ticks = [...backend.events.values()].map((event) => event.tick);
    const before = structuredClone(tracks);
    engine.play();
    backend.fire(0);
    backend.tick = backend.ppq / 2;
    engine.schedule(tracks, 60);
    strict_1.default.equal(engine.positionBeats(), 0.5);
    strict_1.default.equal(backend.bpm, 60);
    strict_1.default.deepEqual([...backend.events.values()].map((event) => event.tick), ticks);
    backend.fire(1, 23);
    strict_1.default.ok(backend.calls.some((call) => call.instrument === "melody" && call.action === "release" && call.time === 23));
    strict_1.default.deepEqual(tracks, before);
});
(0, node_test_1.test)("repeated scheduling/replaying clears owned callbacks without cancelling unrelated events", () => {
    const { backend, engine, tracks } = setup();
    const other = backend.schedule(() => { }, 999);
    engine.schedule(tracks, 120);
    const count = backend.events.size;
    const obsolete = [...backend.events.values()].at(-1).callback;
    for (let index = 0; index < 20; index++) {
        engine.schedule(tracks, 120);
        engine.play();
        engine.stop();
    }
    strict_1.default.equal(backend.events.size, count);
    strict_1.default.ok(backend.events.has(other));
    obsolete(30);
    strict_1.default.equal(backend.calls.filter((call) => call.action === "attack").length, 0);
});
(0, node_test_1.test)("pause silences voices, holds position, and resumes sustained notes only once", () => {
    const { backend, engine, tracks } = setup();
    engine.schedule(tracks, 120);
    engine.play();
    backend.fire(0);
    backend.tick = backend.ppq / 2;
    engine.pause();
    strict_1.default.equal(engine.state(), "paused");
    strict_1.default.equal(engine.positionBeats(), 0.5);
    strict_1.default.equal(backend.calls.filter((call) => call.action === "dispose").length, 5);
    engine.play();
    const attacks = backend.calls.filter((call) => call.action === "attack").length;
    engine.play();
    strict_1.default.equal(backend.calls.filter((call) => call.action === "attack").length, attacks);
    strict_1.default.equal(backend.starts, 2);
    backend.fire(1);
    strict_1.default.ok(backend.calls.some((call) => call.instrument === "melody" && call.action === "release"));
});
(0, node_test_1.test)("stop resets while rewind preserves running/paused state", () => {
    const { backend, engine, tracks } = setup();
    engine.schedule(tracks, 120);
    engine.play();
    backend.fire(4);
    engine.rewind();
    strict_1.default.equal(engine.state(), "started");
    strict_1.default.equal(engine.positionBeats(), 0);
    engine.pause();
    backend.tick = 2 * backend.ppq;
    engine.rewind();
    strict_1.default.equal(engine.state(), "paused");
    strict_1.default.equal(engine.positionBeats(), 0);
    engine.play();
    backend.fire(4);
    engine.stop();
    strict_1.default.equal(engine.state(), "stopped");
    strict_1.default.equal(engine.positionBeats(), 0);
});
(0, node_test_1.test)("mute wins over solo, multiple solos combine, and a live mute silences old voices", () => {
    const { backend, engine, tracks } = setup();
    engine.schedule(tracks, 120);
    engine.play();
    backend.fire(0);
    const next = tracks.map((track) => (Object.assign(Object.assign({}, track), { solo: ["melody", "keys"].includes(track.instrument.id), muted: track.instrument.id === "keys" })));
    engine.schedule(next, 120);
    strict_1.default.equal(backend.calls.filter((call) => call.action === "dispose").length, 5);
    backend.calls = [];
    backend.fire(0);
    strict_1.default.deepEqual(backend.calls.filter((call) => call.action === "attack").map((call) => call.instrument), ["melody"]);
    next.find((track) => track.instrument.id === "keys").muted = false;
    engine.schedule(next, 120);
    backend.calls = [];
    backend.fire(0);
    strict_1.default.deepEqual(new Set(backend.calls.filter((call) => call.action === "attack").map((call) => call.instrument)), new Set(["melody", "keys"]));
});
(0, node_test_1.test)("live pitch edits replace old events and recover notes spanning the playhead", () => {
    const { backend, engine, tracks } = setup();
    engine.schedule(tracks, 120);
    engine.play();
    backend.fire(0);
    backend.tick = backend.ppq / 2;
    const melody = tracks.find((track) => track.instrument.id === "melody");
    melody.notes = [Object.assign(Object.assign({}, melody.notes[0]), { midi: 62 })];
    engine.schedule(tracks, 120);
    strict_1.default.deepEqual(backend.calls.filter((call) => call.instrument === "melody" && call.action === "attack").map((call) => call.midi), [60, 62]);
});
(0, node_test_1.test)("the eight-bar loop releases boundary notes and does not register unreachable releases", () => {
    const { backend, engine, tracks } = setup();
    tracks[0].notes = [Object.assign(Object.assign({}, tracks[0].notes[0]), { startBeat: 31, durationBeats: 10 })];
    engine.schedule(tracks, 120);
    strict_1.default.equal(backend.loopEnd, 32 * backend.ppq);
    strict_1.default.ok([...backend.events.values()].every((event) => event.tick < backend.loopEnd));
    engine.play();
    backend.fire(31);
    backend.fire(32, 55);
    strict_1.default.ok(backend.calls.some((call) => call.instrument === "melody" && call.action === "releaseAll" && call.time === 55));
});
(0, node_test_1.test)("invalid tempo/notes and oversized arrays fail before changing existing audio", () => {
    const { backend, engine, tracks } = setup();
    engine.schedule(tracks, 120);
    const count = backend.events.size;
    for (const bpm of [NaN, Infinity, -1, 0, 59, 181])
        strict_1.default.throws(() => engine.schedule(tracks, bpm), RangeError);
    const note = tracks[0].notes[0];
    const invalid = [
        { midi: NaN }, { midi: -1 }, { midi: 128 }, { midi: 60.5 },
        { startBeat: -1 }, { startBeat: Infinity }, { durationBeats: 0 },
        { durationBeats: NaN }, { velocity: -0.1 }, { velocity: 1.1 }, { velocity: Infinity },
    ];
    for (const fields of invalid) {
        const bad = tracks.map((track, index) => index ? track : Object.assign(Object.assign({}, track), { notes: [Object.assign(Object.assign({}, note), fields)] }));
        strict_1.default.throws(() => engine.schedule(bad, 120), TypeError);
        strict_1.default.equal(backend.events.size, count);
    }
    strict_1.default.throws(() => engine.schedule([Object.assign(Object.assign({}, tracks[0]), { notes: Array.from({ length: 10001 }, () => note) })], 120), RangeError);
    strict_1.default.equal(backend.events.size, count);
});
(0, node_test_1.test)("unknown/prototype instrument IDs and duplicate tracks are rejected", () => {
    const { engine, tracks } = setup();
    for (const id of ["__proto__", "constructor", "unknown"]) {
        strict_1.default.throws(() => engine.schedule([Object.assign(Object.assign({}, tracks[0]), { instrument: Object.assign(Object.assign({}, tracks[0].instrument), { id }) })], 120), TypeError);
    }
    strict_1.default.throws(() => engine.schedule([tracks[0], tracks[0]], 120), TypeError);
});
(0, node_test_1.test)("dispose frees listeners/events/voices once and retired callbacks cannot play", () => {
    const { backend, engine, tracks } = setup();
    engine.schedule(tracks, 120);
    engine.play();
    backend.fire(0);
    const old = [...backend.events.values()].at(-1).callback;
    engine.dispose();
    engine.dispose();
    const count = backend.calls.length;
    old(22);
    strict_1.default.equal(backend.calls.length, count);
    strict_1.default.equal(backend.events.size, 0);
    strict_1.default.equal(backend.loopListeners.size, 0);
    strict_1.default.equal(backend.calls.filter((call) => call.action === "dispose").length, 5);
    strict_1.default.equal(engine.positionBeats(), 0);
    strict_1.default.throws(() => engine.play(), /disposed/);
});
(0, node_test_1.test)("empty/zero-velocity/off-grid notes are silent and sub-tick durations remain positive", () => {
    const { backend, engine, tracks } = setup();
    engine.schedule([], 120);
    strict_1.default.equal(backend.events.size, 0);
    tracks[0].notes = [
        Object.assign(Object.assign({}, tracks[0].notes[0]), { startBeat: 32 }),
        Object.assign(Object.assign({}, tracks[0].notes[0]), { velocity: 0 }),
        Object.assign(Object.assign({}, tracks[0].notes[0]), { startBeat: 1, durationBeats: 0.0001 }),
    ];
    engine.schedule([tracks[0]], 120);
    strict_1.default.deepEqual([...backend.events.values()].map((event) => event.tick).sort((a, b) => a - b), [192, 193]);
});
(0, node_test_1.test)("the public facade is safe to import, query, and tear down without browser globals", async () => {
    strict_1.default.equal(playback.positionBeats(), 0);
    strict_1.default.equal(playback.state(), "stopped");
    playback.pause();
    playback.stop();
    playback.rewind();
    playback.dispose();
    await strict_1.default.rejects(playback.ensureAudio(), /browser/);
});
(0, node_test_1.test)("overlapping equal-pitch notes use independent voices and adjacent notes release first", () => {
    const { backend, engine, tracks } = setup();
    const note = tracks[0].notes[0];
    tracks[0].notes = [
        Object.assign(Object.assign({}, note), { durationBeats: 4 }),
        Object.assign(Object.assign({}, note), { id: "short", startBeat: 1, durationBeats: 1 }),
        Object.assign(Object.assign({}, note), { id: "adjacent", startBeat: 2, durationBeats: 1 }),
    ];
    engine.schedule([tracks[0]], 120);
    engine.play();
    backend.fire(0);
    backend.fire(1);
    strict_1.default.equal(backend.calls.filter((call) => call.action === "create").length, 2);
    backend.calls = [];
    backend.fire(2);
    strict_1.default.deepEqual(backend.calls.map((call) => call.action), ["release", "attack"]);
});
(0, node_test_1.test)("metronome accents downbeats and repeated toggles do not accumulate callbacks", () => {
    const { backend, engine } = setup();
    engine.schedule([], 120);
    engine.setMetronome(true);
    engine.setMetronome(true);
    strict_1.default.equal(backend.events.size, 32);
    engine.play();
    backend.fire(0, 30);
    backend.fire(1, 30.5);
    strict_1.default.deepEqual(backend.calls.filter((call) => call.action === "attack").map(({ midi, time }) => [midi, time]), [[84, 30], [76, 30.5]]);
    engine.setMetronome(false);
    strict_1.default.equal(backend.events.size, 0);
    strict_1.default.ok(backend.calls.some((call) => call.action === "dispose"));
});
(0, node_test_1.test)("four-beat count-in uses BPM/audio-clock times and preserves the playhead", async () => {
    const { backend, engine } = setup();
    backend.tick = backend.ppq * 3;
    const beats = [];
    const pending = engine.countIn(120, (remaining) => beats.push(remaining));
    strict_1.default.deepEqual(backend.calls.filter((call) => call.action === "attack").map((call) => call.time), [10, 10.5, 11, 11.5]);
    strict_1.default.equal(backend.state, "paused");
    strict_1.default.equal(engine.positionBeats(), 3);
    [...backend.timers.values()].sort((a, b) => a.delaySec - b.delaySec).forEach((timer) => timer.callback());
    strict_1.default.equal(await pending, true);
    strict_1.default.deepEqual(beats, [4, 3, 2, 1]);
    strict_1.default.equal(backend.timers.size, 0);
});
(0, node_test_1.test)("stop/rewind/dispose cancel count-in timers, future clicks, and completion", async () => {
    for (const action of ["stop", "rewind", "dispose"]) {
        const { backend, engine } = setup();
        const beats = [];
        const pending = engine.countIn(60, (remaining) => beats.push(remaining));
        const old = [...backend.timers.values()].map((timer) => timer.callback);
        engine[action]();
        strict_1.default.equal(await pending, false);
        old.forEach((callback) => callback());
        strict_1.default.deepEqual(beats, []);
        strict_1.default.equal(backend.timers.size, 0);
        strict_1.default.equal(backend.calls.filter((call) => call.action === "dispose").length, 1);
    }
});
(0, node_test_1.test)("pathological polyphony and unsupported drum lanes fail before replacing the schedule", () => {
    const { backend, engine, tracks } = setup();
    engine.schedule(tracks, 120);
    const count = backend.events.size;
    strict_1.default.throws(() => engine.schedule([Object.assign(Object.assign({}, tracks[0]), { notes: Array.from({ length: 33 }, (_, index) => (Object.assign(Object.assign({}, tracks[0].notes[0]), { id: `overlap-${index}`, startBeat: 0 }))) })], 120), /simultaneous/);
    const drums = tracks.find((track) => track.instrument.id === "drums");
    strict_1.default.throws(() => engine.schedule([Object.assign(Object.assign({}, drums), { notes: [Object.assign(Object.assign({}, drums.notes[0]), { midi: 60 })] })], 120), /Drum notes/);
    strict_1.default.equal(backend.events.size, count);
});
(0, node_test_1.test)("a count-in scheduling error cleans partially scheduled timers and the click voice", async () => {
    const { backend, engine } = setup();
    const scheduleTimer = backend.setTimeout.bind(backend);
    backend.setTimeout = (callback, delaySec) => {
        if (delaySec > 0)
            throw new Error("audio clock closed");
        return scheduleTimer(callback, delaySec);
    };
    await strict_1.default.rejects(engine.countIn(120), /audio clock closed/);
    strict_1.default.equal(backend.timers.size, 0);
    strict_1.default.equal(backend.calls.filter((call) => call.action === "dispose").length, 1);
    engine.stop();
});
