"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlaybackEngine = createPlaybackEngine;
const tracks_1 = require("../tracks");
const click_track_1 = require("./click-track");
const INSTRUMENT_IDS = new Set(["melody", "bass", "keys", "strings", "drums"]);
const MAX_NOTES = 10000;
const MAX_POLYPHONY = 32;
const DRUM_MIDI = new Set([36, 38, 42, 46, 49]);
function validNote(note) {
    return note !== null && typeof note === "object" &&
        Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127 &&
        Number.isFinite(note.startBeat) && note.startBeat >= 0 &&
        Number.isFinite(note.durationBeats) && note.durationBeats > 0 &&
        Number.isFinite(note.startBeat + note.durationBeats) &&
        Number.isFinite(note.velocity) && note.velocity >= 0 && note.velocity <= 1;
}
function arrangement(tracks, ppq) {
    var _a, _b;
    if (!Array.isArray(tracks) || tracks.length > INSTRUMENT_IDS.size) {
        throw new RangeError("Playback supports up to five instrument tracks.");
    }
    const ids = new Set();
    let count = 0;
    for (const track of tracks) {
        if (!track || !track.instrument || !INSTRUMENT_IDS.has(track.instrument.id) ||
            ids.has(track.instrument.id) || typeof track.muted !== "boolean" ||
            typeof track.solo !== "boolean" || !Array.isArray(track.notes)) {
            throw new TypeError("Playback received an invalid instrument track.");
        }
        ids.add(track.instrument.id);
        count += track.notes.length;
        if (count > MAX_NOTES)
            throw new RangeError("Playback supports at most 10,000 notes.");
        if (!track.notes.every(validNote))
            throw new TypeError("Playback received an invalid note.");
        if (track.instrument.id === "drums" && track.notes.some((note) => !DRUM_MIDI.has(note.midi))) {
            throw new RangeError("Drum notes must use the supported kick, snare, hat, open hat, or crash lanes.");
        }
    }
    const solo = tracks.some((track) => track.solo);
    const notes = tracks.flatMap((track) => {
        if (track.muted || (solo && !track.solo))
            return [];
        return track.notes.filter((note) => note.startBeat < tracks_1.TOTAL_BEATS && note.velocity > 0).map((note) => {
            const startTick = Math.min(tracks_1.TOTAL_BEATS * ppq - 1, Math.round(note.startBeat * ppq));
            return {
                instrumentId: track.instrument.id,
                voiceKey: track.instrument.id,
                midi: note.midi,
                velocity: note.velocity,
                startTick,
                endTick: Math.min(tracks_1.TOTAL_BEATS * ppq, Math.max(startTick + 1, Math.round((note.startBeat + note.durationBeats) * ppq))),
            };
        });
    });
    const pitchLanes = new Map();
    const activeEnds = new Map();
    // PolySynth releases the oldest matching pitch. Isolate overlapping equal pitches
    // so a short later note cannot release a longer earlier one.
    for (const note of [...notes].sort((a, b) => a.startTick - b.startTick)) {
        const active = ((_a = activeEnds.get(note.instrumentId)) !== null && _a !== void 0 ? _a : []).filter((end) => end > note.startTick);
        if (active.length >= MAX_POLYPHONY)
            throw new RangeError("Each instrument supports at most 32 simultaneous notes.");
        active.push(note.endTick);
        activeEnds.set(note.instrumentId, active);
        const key = `${note.instrumentId}:${note.midi}`;
        const lanes = (_b = pitchLanes.get(key)) !== null && _b !== void 0 ? _b : [];
        let lane = lanes.findIndex((end) => end <= note.startTick);
        if (lane === -1)
            lane = lanes.length;
        lanes[lane] = note.endTick;
        pitchLanes.set(key, lanes);
        note.voiceKey = `${note.instrumentId}:${lane}`;
    }
    return notes;
}
/** Owns derived callbacks/voices for the fixed eight-bar arrangement; never mutates Track[]. */
function createPlaybackEngine(backend) {
    let notes = [];
    let eventIds = [];
    const voices = new Map();
    let generation = 0;
    let disposed = false;
    const clicks = (0, click_track_1.createClickTrack)(backend);
    let metronome = false;
    let clickEventIds = [];
    let clickGeneration = 0;
    function assertLive() {
        if (disposed)
            throw new Error("Playback has been disposed. Initialize audio again.");
    }
    function voice(note) {
        let value = voices.get(note.voiceKey);
        if (!value) {
            value = backend.createVoice(note.instrumentId);
            voices.set(note.voiceKey, value);
        }
        return value;
    }
    function silence() {
        // Disposal also cancels attacks already submitted during Tone's lookahead window.
        voices.forEach((value) => value.dispose());
        voices.clear();
        clicks.silenceMetronome();
    }
    function clearEvents() {
        generation++;
        eventIds.forEach((id) => backend.clear(id));
        eventIds = [];
    }
    function scheduleMetronome(enabled) {
        clickGeneration++;
        clickEventIds.forEach((id) => backend.clear(id));
        clickEventIds = [];
        clicks.silenceMetronome();
        metronome = enabled;
        if (!enabled)
            return;
        const revision = clickGeneration;
        for (let beat = 0; beat < tracks_1.TOTAL_BEATS; beat++) {
            clickEventIds.push(backend.schedule((time) => {
                if (revision === clickGeneration && !disposed && backend.state === "started")
                    clicks.click(time, beat % 4 === 0);
            }, beat * backend.ppq));
        }
    }
    function resumeHeldNotes(tick = backend.positionTicks()) {
        const time = backend.now();
        for (const note of notes) {
            if (note.startTick < tick && note.endTick > tick) {
                voice(note).attack(note.midi, time, note.velocity);
            }
        }
    }
    // Tone loops before processing the loop-end tick, so releases at beat 32 need this hook.
    const removeLoopListener = backend.onLoopEnd((time) => {
        voices.forEach((value) => value.releaseAll(time));
    });
    return {
        /** Replace derived playback atomically. Invalid data preserves the previous arrangement. */
        schedule(tracks, bpm) {
            assertLive();
            if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180) {
                throw new RangeError("BPM must be finite and between 60 and 180.");
            }
            const next = arrangement(tracks, backend.ppq);
            clicks.cancelCountIn();
            const running = backend.state === "started";
            const tick = backend.positionTicks();
            if (running)
                backend.pause();
            clearEvents();
            silence();
            notes = next;
            backend.setBpm(bpm);
            backend.setLoop(tracks_1.TOTAL_BEATS * backend.ppq);
            scheduleMetronome(metronome);
            if (running)
                backend.seekTicks(tick);
            const revision = generation;
            // Register releases first so adjacent equal-pitch notes release before re-attacking.
            for (const note of notes) {
                if (note.endTick < tracks_1.TOTAL_BEATS * backend.ppq) {
                    eventIds.push(backend.schedule((time) => {
                        var _a;
                        if (revision === generation && !disposed && backend.state === "started")
                            (_a = voices.get(note.voiceKey)) === null || _a === void 0 ? void 0 : _a.release(note.midi, time);
                    }, note.endTick));
                }
            }
            for (const note of notes) {
                eventIds.push(backend.schedule((time) => {
                    if (revision === generation && !disposed && backend.state === "started")
                        voice(note).attack(note.midi, time, note.velocity);
                }, note.startTick));
            }
            if (running) {
                resumeHeldNotes(tick);
                backend.start();
            }
        },
        /** Start or resume at the current beat, including any interrupted sustained notes. */
        play() {
            assertLive();
            if (backend.state === "started")
                return;
            resumeHeldNotes();
            backend.start();
        },
        /** Pause at the current beat and silence all voices, including pending attacks. */
        pause() {
            assertLive();
            clicks.cancelCountIn();
            backend.pause();
            silence();
        },
        /** Stop and return to beat zero. */
        stop() {
            assertLive();
            clicks.cancelCountIn();
            backend.stop();
            backend.seekTicks(0);
            silence();
        },
        /** Return to beat zero, preserving whether the transport was running. */
        rewind() {
            assertLive();
            clicks.cancelCountIn();
            const running = backend.state === "started";
            backend.pause();
            silence();
            backend.seekTicks(0);
            if (running)
                backend.start();
        },
        /** Enable/disable quarter-note clicks; accent each 4/4 downbeat. */
        setMetronome(enabled) {
            assertLive();
            if (typeof enabled !== "boolean")
                throw new TypeError("Metronome must be a boolean.");
            scheduleMetronome(enabled);
        },
        /** Four audio-clock beats before playback. Resolves false when cancelled. BPM is fixed for the count-in. */
        countIn(bpm, onBeat = () => { }) {
            assertLive();
            if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180)
                throw new RangeError("Count-in BPM must be between 60 and 180.");
            if (typeof onBeat !== "function")
                throw new TypeError("Count-in callback must be a function.");
            backend.pause();
            silence();
            return clicks.countIn(bpm, onBeat);
        },
        /** Audible transport position in quarter-note beats, wrapped to the visible loop. */
        positionBeats() {
            return disposed ? 0 : (backend.positionTicks() / backend.ppq) % tracks_1.TOTAL_BEATS;
        },
        state() {
            return disposed ? "stopped" : backend.state;
        },
        /** Idempotently stop audio, clear only owned callbacks, and free every synth/listener. */
        dispose() {
            if (disposed)
                return;
            backend.stop();
            clearEvents();
            scheduleMetronome(false);
            clicks.dispose();
            silence();
            removeLoopListener();
            notes = [];
            disposed = true;
        },
    };
}
