"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.midiName = exports.noteH = exports.noteY = exports.beatX = exports.noteId = exports.QUANT_BEATS = exports.INSTRUMENTS = exports.DRUM_ROWS = exports.MAX_RECORD_SEC = exports.TOTAL_BEATS = void 0;
exports.initialTracks = initialTracks;
exports.pitchRows = pitchRows;
exports.noteRow = noteRow;
exports.TOTAL_BEATS = 32; // 8 bars of 4/4
exports.MAX_RECORD_SEC = 15;
exports.DRUM_ROWS = [
    { midi: 49, name: "Crash" },
    { midi: 46, name: "Open hat" },
    { midi: 42, name: "Hat" },
    { midi: 38, name: "Snare" },
    { midi: 36, name: "Kick" },
];
exports.INSTRUMENTS = [
    { id: "melody", name: "Melody", color: "#f26b1d", lo: 60, hi: 84, kind: "synth", hint: "Hum the tune you can't get out of your head" },
    { id: "bass", name: "Bass", color: "#3d7ee6", lo: 28, hi: 52, kind: "synth", hint: "Hum low and steady" },
    { id: "keys", name: "Keys", color: "#e8c41c", lo: 48, hi: 72, kind: "synth", hint: "Hum the chord tones, one at a time" },
    { id: "drums", name: "Drums", color: "#e0412f", lo: 36, hi: 49, kind: "drums", hint: "Beatbox it: boom for kick, tss for hats" },
    { id: "strings", name: "Strings", color: "#23a39b", lo: 55, hi: 79, kind: "synth", hint: "Hum long, slow notes" },
];
exports.QUANT_BEATS = { off: 0, "1/4": 1, "1/8": 0.5, "1/16": 0.25 };
let seq = 0;
const noteId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `n${++seq}`;
exports.noteId = noteId;
const n = (midi, startBeat, durationBeats, velocity = 0.8) => ({
    id: `s-${midi}-${startBeat}`,
    midi,
    startBeat,
    durationBeats,
    velocity,
});
// Labeled "Sample" in the UI until the user records over them.
function sampleDrums() {
    const out = [];
    for (let bar = 0; bar < 8; bar++) {
        const b = bar * 4;
        out.push(n(36, b, 0.5), n(38, b + 1, 0.5), n(36, b + 2, 0.5), n(36, b + 2.5, 0.5, 0.6), n(38, b + 3, 0.5));
        for (let h = 0; h < 8; h++)
            out.push(n(42, b + h / 2, 0.25, h % 2 ? 0.45 : 0.7));
    }
    out.push(n(49, 0, 1));
    return out;
}
function sampleKeys() {
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    return chords.flatMap((c, i) => [0, 16].flatMap((o) => c.map((m) => n(m, o + i * 4, 3.5, 0.6))));
}
function initialTracks() {
    return exports.INSTRUMENTS.map((instrument) => {
        const notes = instrument.id === "drums" ? sampleDrums() : instrument.id === "keys" ? sampleKeys() : [];
        return { instrument, notes, muted: false, solo: false, sample: notes.length > 0 };
    });
}
/** Lane geometry in percent, derived from beats and pitch (never stored). */
const beatX = (beat) => (beat / exports.TOTAL_BEATS) * 100;
exports.beatX = beatX;
function pitchRows(inst) {
    return inst.kind === "drums" ? exports.DRUM_ROWS.length : inst.hi - inst.lo + 1;
}
function noteRow(midi, inst) {
    if (inst.kind === "drums") {
        const i = exports.DRUM_ROWS.findIndex((r) => r.midi === midi);
        return i < 0 ? exports.DRUM_ROWS.length - 1 : i;
    }
    return inst.hi - Math.min(inst.hi, Math.max(inst.lo, midi));
}
const noteY = (midi, inst) => (noteRow(midi, inst) / pitchRows(inst)) * 100;
exports.noteY = noteY;
const noteH = (inst) => 100 / pitchRows(inst);
exports.noteH = noteH;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midiName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
exports.midiName = midiName;
