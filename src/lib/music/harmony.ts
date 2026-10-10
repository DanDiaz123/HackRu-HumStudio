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
// Bonus for chord moves that sound like a progression, by scale degree (0 = I/i). Small next to a
// bar's notes: they only decide between chords the melody fits about equally well.
const MOVES: Record<string, number> = {
  "4>0": 0.4, "3>4": 0.3, "1>4": 0.3, "3>0": 0.2, "0>3": 0.2, "0>4": 0.2, "0>5": 0.2, "5>3": 0.2, "5>1": 0.2, "2>5": 0.2,
};
const DEFAULT_DEGREES = [5, 3, 0, 4, 5, 3, 0, 4]; // vi IV I V ×2
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
  bars: DEFAULT_DEGREES.map((d) => triad({ tonic: 0, mode: "major" }, d)), // Am F C G ×2
};

/** Krumhansl–Schmuckler: correlate the duration-weighted pitch-class histogram with all 24 key profiles. */
export function detectKey(notes: Note[]): Key {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[pc(n.midi)] += n.durationBeats;
  // Hums tend to end on, and dwell on, the home note: a beat's bonus each to the last and the longest note.
  if (notes.length) {
    hist[pc(notes.reduce((a, b) => (b.startBeat >= a.startBeat ? b : a)).midi)] += 1;
    hist[pc(notes.reduce((a, b) => (b.durationBeats > a.durationBeats ? b : a)).midi)] += 1;
  }
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
export function nearest(midi: number, pcs: number[]): number {
  for (let d = 0; d <= 6; d++) {
    if (pcs.includes(pc(midi - d))) return midi - d;
    if (pcs.includes(pc(midi + d))) return midi + d;
  }
  return midi;
}

export const snapToScale = (midi: number, key: Key) => nearest(midi, SCALES[key.mode].map((s) => pc(key.tonic + s)));

/** Key from the melody, then the diatonic triad that best covers each bar's strong-beat notes. */
export function inferHarmony(melody: Note[]): Harmony {
  return pickChords(melody, detectKey(melody));
}

/**
 * One diatonic triad per bar in `key`, scored by how much of the bar's notes are chord tones, chosen
 * together (Viterbi) so ambiguous bars follow a natural progression instead of flipping on a whim.
 * With `current`, each bar leans toward the chord already there (a Keys take re-picks chords without
 * overruling the melody) and bars with no notes keep it; without, an empty bar repeats the previous chord.
 */
export function pickChords(notes: Note[], key: Key, current?: number[][]): Harmony {
  type Option = { chord: number[]; degree: number; score: number };
  const same = (a: number[], b: number[]) => a.every((p, i) => p === b[i]);
  const degreeOf = (chord: number[]) => DEGREES.find((d) => same(triad(key, d), chord)) ?? -1;
  const columns: { options: Option[]; holdPrevious: boolean }[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const inBar = notes.filter((n) => barOf(n.startBeat) === bar);
    if (!inBar.length) {
      const fixed = current?.[bar] ?? (bar === 0 ? triad(key, 0) : null);
      columns.push(fixed
        ? { options: [{ chord: fixed, degree: degreeOf(fixed), score: 0 }], holdPrevious: false }
        : { options: DEGREES.map((d) => ({ chord: triad(key, d), degree: d, score: 0 })), holdPrevious: true });
      continue;
    }
    const options = DEGREES.map((d) => {
      const chord = triad(key, d);
      let score = (COMMON.has(d) ? 0.3 : 0) + (!current && bar === 0 && d === 0 ? 0.5 : 0) + (current && same(current[bar], chord) ? 0.5 : 0);
      for (const n of inBar) {
        if (chord.includes(pc(n.midi))) score += n.durationBeats * (n.startBeat % 2 === 0 ? 2 : 1); // beats 1 and 3
      }
      return { chord, degree: d, score };
    });
    columns.push({ options, holdPrevious: false });
  }

  // Best path score ending in each option, with a back-pointer; earlier options win ties.
  let paths = columns[0].options.map((o) => ({ total: o.score, from: -1 }));
  const back: number[][] = [];
  for (let bar = 1; bar < BARS; bar++) {
    const prev = columns[bar - 1].options;
    const { options, holdPrevious } = columns[bar];
    const next = options.map((o) => {
      let best = { total: -Infinity, from: 0 };
      prev.forEach((p, j) => {
        const move = holdPrevious ? (same(p.chord, o.chord) ? 0 : -Infinity) : MOVES[`${p.degree}>${o.degree}`] ?? 0;
        if (paths[j].total + move > best.total) best = { total: paths[j].total + move, from: j };
      });
      return { total: best.total + o.score, from: best.from };
    });
    back.push(next.map((n) => n.from));
    paths = next;
  }
  let k = paths.reduce((bi, p, i) => (p.total > paths[bi].total ? i : bi), 0);
  const bars: number[][] = new Array(BARS);
  for (let bar = BARS - 1; bar >= 0; bar--) {
    bars[bar] = columns[bar].options[k].chord;
    if (bar) k = back[bar - 1][k];
  }
  return { ...key, bars };
}

/** The harmony for a key the user picked: chords re-picked from the melody, or the sample progression in that key. */
export function withKey(key: Key, melody: Note[]): Harmony {
  return melody.length ? pickChords(melody, key) : { ...key, bars: DEFAULT_DEGREES.map((d) => triad(key, d)) };
}

/** Read back the chords a Keys part plays: each bar's first chord, if it is a triad; otherwise the bar keeps `h`'s chord. */
export function chordsFromVoicing(notes: Note[], h: Harmony): Harmony {
  const bars = h.bars.map((chord, bar) => {
    const inBar = notes.filter((n) => barOf(n.startBeat) === bar);
    if (!inBar.length) return chord;
    const first = Math.min(...inBar.map((n) => n.startBeat));
    const pcs = new Set(inBar.filter((n) => n.startBeat === first).map((n) => pc(n.midi)));
    for (let d = 0; d < 7; d++) {
      const t = triad(h, d);
      if (pcs.size === 3 && t.every((p) => pcs.has(p))) return t;
    }
    return chord;
  });
  return { ...h, bars };
}

/** Chord tones of the bar a beat falls in. */
export const chordAt = (h: Harmony, beat: number) => h.bars[barOf(beat)];

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
export const keyName = (k: Key) => `${NAMES[k.tonic]} ${k.mode}`;
export const KEYS: Key[] = (["major", "minor"] as const).flatMap((mode) => NAMES.map((_, tonic) => ({ tonic, mode })));
export const harmonyLabel = (h: Harmony, bars = h.bars.length) =>
  `${keyName(h)} · ${h.bars.slice(0, bars).map(chordName).join(" ")}`;

// ---------- Learn mode: name what harmony.ts already decided ----------
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** Roman numeral of a diatonic triad in `key`: upper for major, lower for minor, ° for diminished; "?" if not in the key. */
export function romanNumeral(chord: number[], key: Key): string {
  const d = ROMAN.findIndex((_, i) => triad(key, i).every((p, j) => p === chord[j]));
  if (d < 0) return "?";
  const name = chordName(chord);
  return name.endsWith("dim") ? `${ROMAN[d].toLowerCase()}°` : name.endsWith("m") ? ROMAN[d].toLowerCase() : ROMAN[d];
}

// Movable do, do-based minor (the Kodály convention): degree 1 is always "do".
const SOLFEGE: Record<Mode, string[]> = {
  major: ["do", "re", "mi", "fa", "sol", "la", "ti"],
  minor: ["do", "re", "me", "fa", "sol", "le", "te"],
};

/** Solfège syllable of a note in `key`, or null when it is outside the scale. */
export function solfege(midi: number, key: Key): string | null {
  const d = scaleDegree(midi, key);
  return d === null ? null : SOLFEGE[key.mode][d - 1];
}

/** Scale degree 1..7 of a note in `key`, or null when it is outside the scale. */
export function scaleDegree(midi: number, key: Key): number | null {
  const i = SCALES[key.mode].indexOf(pc(midi - key.tonic));
  return i < 0 ? null : i + 1;
}
