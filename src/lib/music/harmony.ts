// Shared key + chords so separately hummed tracks agree. Pure: no browser APIs.
import type { Instrument } from "../tracks";
import type { Note } from "./types";

export type Mode = "major" | "minor";
export interface Key {
  tonic: number; // pitch class 0..11
  mode: Mode;
}
export interface Harmony extends Key {
  bars: number[][]; // one triad per 4/4 bar, pitch classes, root first
}

const SCALES: Record<Mode, number[]> = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
// Krumhansl–Kessler key profiles.
const PROFILES: Record<Mode, number[]> = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
// Scale degrees tried per bar, most idiomatic first (ties keep the earlier one).
const DEGREES = [0, 4, 3, 5, 1, 2];
const COMMON = new Set([0, 3, 4, 5]); // I IV V vi / i iv v VI
const BARS = 8;

const pc = (m: number) => ((m % 12) + 12) % 12;
const barOf = (beat: number) => Math.min(BARS - 1, Math.max(0, Math.floor(beat / 4)));

function triad(key: Key, degree: number): number[] {
  const s = SCALES[key.mode];
  return [0, 2, 4].map((k) => pc(key.tonic + s[(degree + k) % 7]));
}

export const DEFAULT_HARMONY: Harmony = {
  tonic: 0,
  mode: "major",
  bars: [5, 3, 0, 4, 5, 3, 0, 4].map((d) => triad({ tonic: 0, mode: "major" }, d)), // Am F C G ×2
};

/** Krumhansl–Schmuckler: correlate the duration-weighted pitch-class histogram with all 24 key profiles. */
export function detectKey(notes: Note[]): Key {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[pc(n.midi)] += n.durationBeats;
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const hm = mean(hist);
  let best: Key = { tonic: 0, mode: "major" };
  let bestR = -Infinity;
  for (const mode of ["major", "minor"] as const) {
    const p = PROFILES[mode];
    const pm = mean(p);
    for (let tonic = 0; tonic < 12; tonic++) {
      let num = 0, dh = 0, dp = 0;
      for (let i = 0; i < 12; i++) {
        const a = hist[pc(i + tonic)] - hm;
        const b = p[i] - pm;
        num += a * b;
        dh += a * a;
        dp += b * b;
      }
      const r = dh && dp ? num / Math.sqrt(dh * dp) : 0;
      if (r > bestR) [bestR, best] = [r, { tonic, mode }];
    }
  }
  return best;
}

/** Nearest MIDI note whose pitch class is in `pcs`; ties go down. */
function nearest(midi: number, pcs: number[]): number {
  for (let d = 0; d <= 6; d++) {
    if (pcs.includes(pc(midi - d))) return midi - d;
    if (pcs.includes(pc(midi + d))) return midi + d;
  }
  return midi;
}

export const snapToScale = (midi: number, key: Key) => nearest(midi, SCALES[key.mode].map((s) => pc(key.tonic + s)));

/** Key from the melody, then the diatonic triad that best covers each bar's strong-beat notes. */
export function inferHarmony(melody: Note[]): Harmony {
  const key = detectKey(melody);
  // ponytail: per-bar argmax with small priors; Viterbi over progression templates if results sound jumpy.
  const bars: number[][] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const inBar = melody.filter((n) => barOf(n.startBeat) === bar);
    if (!inBar.length) {
      bars.push(bars[bar - 1] ?? triad(key, 0));
      continue;
    }
    let best = triad(key, 0);
    let bestScore = -Infinity;
    for (const d of DEGREES) {
      const chord = triad(key, d);
      let score = (COMMON.has(d) ? 0.3 : 0) + (bar === 0 && d === 0 ? 0.5 : 0);
      for (const n of inBar) {
        if (chord.includes(pc(n.midi))) score += n.durationBeats * (n.startBeat % 2 === 0 ? 2 : 1); // beats 1 and 3
      }
      if (score > bestScore) [bestScore, best] = [score, chord];
    }
    bars.push(best);
  }
  return { ...key, bars };
}

/** Pull a track's pitches onto the harmony: Melody to the scale, Bass to root/fifth, others to chord tones. */
export function fitToHarmony(notes: Note[], inst: Instrument, h: Harmony): Note[] {
  if (inst.kind === "drums") return notes;
  return notes.map((n) => {
    const chord = h.bars[barOf(n.startBeat)];
    let midi =
      inst.id === "melody" ? snapToScale(n.midi, h)
      : inst.id === "bass" ? nearest(n.midi, [chord[0], chord[2]])
      : nearest(n.midi, chord);
    while (midi < inst.lo) midi += 12;
    while (midi > inst.hi) midi -= 12;
    return midi === n.midi ? n : { ...n, midi };
  });
}

/** Root-position triads with the root in C3..B3, one 3.5-beat chord per bar (the Keys sample). */
export function voiceChords(h: Harmony): Note[] {
  return h.bars.flatMap((chord, bar) =>
    chord.map((p) => {
      const midi = 48 + chord[0] + pc(p - chord[0]);
      return { id: `s-${midi}-${bar * 4}`, midi, startBeat: bar * 4, durationBeats: 3.5, velocity: 0.6 };
    }),
  );
}

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const chordName = (c: number[]) =>
  NAMES[c[0]] + (pc(c[2] - c[0]) === 6 ? "dim" : pc(c[1] - c[0]) === 3 ? "m" : "");
export const harmonyLabel = (h: Harmony, bars = h.bars.length) =>
  `${NAMES[h.tonic]} ${h.mode} · ${h.bars.slice(0, bars).map(chordName).join(" ")}`;
