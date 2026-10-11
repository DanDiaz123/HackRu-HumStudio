import { DEFAULT_HARMONY, voiceChords } from "./music/harmony.ts";
import { presetForTrack } from "./audio/instrument-presets.ts";
import type { Note, QuantizeDivision } from "./music/types";

export type { Note, QuantizeDivision };

export interface Instrument {
  id: string;
  name: string;
  color: string;
  lo: number;
  hi: number;
  kind: "synth" | "drums";
  hint: string;
}

export interface Track {
  instrument: Instrument;
  /** Serializable playback sound; category identity and MIDI notes stay unchanged. */
  presetId: string;
  /** Selected recording/editing lane; all drum lanes remain visible. Omitted for pitched tracks. */
  drumPart?: DrumPart;
  notes: Note[];
  muted: boolean;
  solo: boolean;
  sample: boolean;
}

export const TOTAL_BEATS = 32; // 8 bars of 4/4
export const MAX_RECORD_SEC = 15;

export const DRUM_ROWS = [
  { midi: 49, name: "Crash" },
  { midi: 46, name: "Open hat" },
  { midi: 42, name: "Hat" },
  { midi: 38, name: "Snare" },
  { midi: 36, name: "Kick" },
];

export const DRUM_PARTS = [
  { id: "kick", name: "Kick", midi: 36 },
  { id: "snare", name: "Snare", midi: 38 },
  { id: "hat", name: "Closed hat", midi: 42 },
  { id: "openHat", name: "Open hat", midi: 46 },
  { id: "crash", name: "Crash", midi: 49 },
] as const;

export type DrumPart = (typeof DRUM_PARTS)[number]["id"];
export const drumPart = (id: string | undefined): (typeof DRUM_PARTS)[number] =>
  DRUM_PARTS.find((part) => part.id === id) ?? DRUM_PARTS[0];

export const INSTRUMENTS: Instrument[] = [
  { id: "melody", name: "Melody", color: "#f26b1d", lo: 60, hi: 84, kind: "synth", hint: "Hum the tune you can't get out of your head" },
  { id: "bass", name: "Bass", color: "#3d7ee6", lo: 28, hi: 52, kind: "synth", hint: "Hum low and steady" },
  { id: "keys", name: "Keys", color: "#e8c41c", lo: 48, hi: 72, kind: "synth", hint: "Hum the chord tones, one at a time" },
  { id: "drums", name: "Drums", color: "#e0412f", lo: 36, hi: 49, kind: "drums", hint: "Beatbox it: boom for kick, tss for hats" },
  { id: "strings", name: "Strings", color: "#23a39b", lo: 55, hi: 79, kind: "synth", hint: "Hum long, slow notes" },
];

export const QUANT_BEATS: Record<QuantizeDivision, number> = { off: 0, "1/4": 1, "1/8": 0.5, "1/16": 0.25 };

let seq = 0;
export const noteId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `n${++seq}`;

const n = (midi: number, startBeat: number, durationBeats: number, velocity = 0.8): Note => ({
  id: `s-${midi}-${startBeat}`,
  midi,
  startBeat,
  durationBeats,
  velocity,
});

// Labeled "Sample" in the UI until the user records over them.
function sampleDrums(): Note[] {
  const out: Note[] = [];
  for (let bar = 0; bar < 8; bar++) {
    const b = bar * 4;
    out.push(n(36, b, 0.5), n(38, b + 1, 0.5), n(36, b + 2, 0.5), n(36, b + 2.5, 0.5, 0.6), n(38, b + 3, 0.5));
    for (let h = 0; h < 8; h++) out.push(n(42, b + h / 2, 0.25, h % 2 ? 0.45 : 0.7));
  }
  out.push(n(49, 0, 1));
  return out;
}

export function initialTracks(): Track[] {
  return INSTRUMENTS.map((instrument) => {
    const notes = instrument.id === "drums" ? sampleDrums() : instrument.id === "keys" ? voiceChords(DEFAULT_HARMONY) : [];
    return { instrument, presetId: presetForTrack(instrument.id).id, ...(instrument.kind === "drums" ? { drumPart: "kick" as DrumPart } : {}), notes, muted: false, solo: false, sample: notes.length > 0 };
  });
}

/** Keep the first soloed category in fixed instrument order when loading older multi-solo projects. */
export function normalizeSoloTracks(tracks: readonly Track[]): Track[] {
  const selected = INSTRUMENTS.find(inst => tracks.some(track => track.instrument.id === inst.id && track.solo))?.id;
  return tracks.map(track => track.solo && track.instrument.id !== selected ? { ...track, solo: false } : track);
}

/** Toggle mute independently, or select one exclusive solo (clicking it again clears solo). */
export function toggleTrackFlag(tracks: readonly Track[], id: string, key: "muted" | "solo"): Track[] {
  const selected = tracks.find(track => track.instrument.id === id);
  if (!selected) return [...tracks];
  if (key === "muted") return tracks.map(track => track === selected ? { ...track, muted: !track.muted } : track);
  return tracks.map(track => {
    const solo = track === selected && !selected.solo;
    return track.solo === solo ? track : { ...track, solo };
  });
}

/** Lane geometry in percent, derived from beats and pitch (never stored). */
export const beatX = (beat: number) => (beat / TOTAL_BEATS) * 100;

export function pitchRows(inst: Instrument): number {
  return inst.kind === "drums" ? DRUM_ROWS.length : inst.hi - inst.lo + 1;
}

export function noteRow(midi: number, inst: Instrument): number {
  if (inst.kind === "drums") {
    const i = DRUM_ROWS.findIndex((r) => r.midi === midi);
    return i < 0 ? DRUM_ROWS.length - 1 : i;
  }
  return inst.hi - Math.min(inst.hi, Math.max(inst.lo, midi));
}

/** Inverse of noteRow: the pitch drawn on lane row `row` (0 = top), clamped to the lane. */
export function rowMidi(row: number, inst: Instrument): number {
  const r = Math.min(pitchRows(inst) - 1, Math.max(0, Math.floor(row)));
  return inst.kind === "drums" ? DRUM_ROWS[r].midi : inst.hi - r;
}

export const noteY = (midi: number, inst: Instrument) => (noteRow(midi, inst) / pitchRows(inst)) * 100;
export const noteH = (inst: Instrument) => 100 / pitchRows(inst);

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const midiName = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
