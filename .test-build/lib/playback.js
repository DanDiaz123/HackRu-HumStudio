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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAudio = ensureAudio;
exports.schedule = schedule;
exports.play = play;
exports.pause = pause;
exports.stop = stop;
exports.rewind = rewind;
exports.positionBeats = positionBeats;
exports.state = state;
exports.setMetronome = setMetronome;
exports.countIn = countIn;
exports.dispose = dispose;
const playback_engine_1 = require("./audio/playback-engine");
let engine = null;
let initializing = null;
let lifecycle = 0;
/** Initialize browser-only synthesis from a real Play click; concurrent calls share one engine. */
async function ensureAudio() {
    if (typeof window === "undefined")
        throw new Error("Playback is only available in a browser.");
    if (initializing)
        return initializing;
    const revision = lifecycle;
    initializing = (async () => {
        const { createToneBackend, unlockAudio } = await Promise.resolve().then(() => __importStar(require("./audio/tone-backend")));
        await unlockAudio();
        if (revision !== lifecycle)
            throw new Error("Audio initialization was cancelled.");
        engine !== null && engine !== void 0 ? engine : (engine = (0, playback_engine_1.createPlaybackEngine)(createToneBackend()));
    })();
    const pending = initializing;
    try {
        await pending;
    }
    finally {
        if (initializing === pending)
            initializing = null;
    }
}
/** Derive tick-aligned playback from canonical tracks at a validated BPM of 60..180. */
function schedule(tracks, bpm) {
    if (!engine)
        throw new Error("Initialize audio before scheduling playback.");
    engine.schedule(tracks, bpm);
}
/** Start/resume the initialized arrangement. */
function play() {
    if (!engine)
        throw new Error("Initialize audio before playback.");
    engine.play();
}
/** Pause while preserving the beat position. Safe before audio has been initialized. */
function pause() { engine === null || engine === void 0 ? void 0 : engine.pause(); }
/** Halt playback, silence pending voices, and reset the position. */
function stop() { engine === null || engine === void 0 ? void 0 : engine.stop(); }
/** Reset to beat zero; running playback continues from the start. */
function rewind() { engine === null || engine === void 0 ? void 0 : engine.rewind(); }
/** Audible playhead position in quarter-note beats, zero before initialization. */
function positionBeats() { var _a; return (_a = engine === null || engine === void 0 ? void 0 : engine.positionBeats()) !== null && _a !== void 0 ? _a : 0; }
/** Actual transport state, rather than an independent UI flag. */
function state() { var _a; return (_a = engine === null || engine === void 0 ? void 0 : engine.state()) !== null && _a !== void 0 ? _a : "stopped"; }
/** Toggle the beat-aligned metronome after initializing audio. */
function setMetronome(enabled) { engine === null || engine === void 0 ? void 0 : engine.setMetronome(enabled); }
/** Count four beats without moving the playhead; false means Stop/unmount cancelled it. */
function countIn(bpm, onBeat) {
    if (!engine)
        throw new Error("Initialize audio before counting in.");
    return engine.countIn(bpm, onBeat);
}
/** Release this studio's audio resources and cancel any pending initialization. */
function dispose() {
    lifecycle++;
    initializing = null;
    engine === null || engine === void 0 ? void 0 : engine.dispose();
    engine = null;
}
