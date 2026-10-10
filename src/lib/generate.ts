import type { HumFrame } from "./hum";
import { MAX_SEGMENTATION_FRAMES, segmentPitchFrames, type SegmentationConfig } from "./audio/segment-notes.ts";
import { DEFAULT_NOTE_SENSITIVITY, NOTE_SENSITIVITY_LEVELS, noteSensitivityConfig, type NoteSensitivity } from "./audio/note-sensitivity.ts";
import { type Harmony, type Key, chordAt, detectKey, fitToHarmony, nearest, pickChords, snapToScale } from "./music/harmony.ts";
import { DRUM_ROWS, type Instrument, type Note, type QuantizeDivision, QUANT_BEATS, TOTAL_BEATS, noteId } from "./tracks.ts";

export type NoteSensitivityVariants = Record<NoteSensitivity, Note[]>;

/** Apply a grid to existing notes without changing pitch or accumulating prior rounding. */
export function snapNotesToGrid(inst: Instrument, notes: readonly Note[], quantize: QuantizeDivision): Note[] {
  if (!Object.hasOwn(QUANT_BEATS, quantize)) throw new RangeError("Unsupported quantization.");
  const grid = QUANT_BEATS[quantize];
  if (!grid) return notes.map((note) => ({ ...note }));
  return notes.map((note) => {
    const startBeat = Math.min(TOTAL_BEATS - grid, Math.max(0, Math.round(note.startBeat / grid) * grid));
    if (inst.kind === "drums") return { ...note, startBeat };
    const endBeat = Math.min(TOTAL_BEATS, Math.max(startBeat + grid, Math.round((note.startBeat + note.durationBeats) / grid) * grid));
    return { ...note, startBeat, durationBeats: endBeat - startBeat };
  });
}

/** Generates canonical notes; raw audio stays local. */
export async function generateTrack(
  inst: Instrument,
  frames: HumFrame[],
  bpm: number,
  quantize: QuantizeDivision,
  harmony: Harmony,
  sensitivity: NoteSensitivity = DEFAULT_NOTE_SENSITIVITY,
): Promise<Note[]> {
  return generateNotes(inst, frames, bpm, quantize, harmony, sensitivity);
}

/** Generate Low, Medium, and High from one take so changing the menu never needs another recording. */
export function generateTrackVariants(
  inst: Instrument,
  frames: readonly HumFrame[],
  bpm: number,
  quantize: QuantizeDivision,
  harmony: Harmony,
  selected: NoteSensitivity = DEFAULT_NOTE_SENSITIVITY,
  trace?: GenTrace,
): NoteSensitivityVariants {
  const variants = {} as NoteSensitivityVariants;
  if (inst.kind === "drums") {
    const notes = generateNotes(inst, frames, bpm, quantize, harmony, trace, selected);
    for (const level of NOTE_SENSITIVITY_LEVELS) variants[level] = notes.map((note) => ({ ...note }));
    return variants;
  }
  for (const level of NOTE_SENSITIVITY_LEVELS)
    variants[level] = generateNotes(inst, frames, bpm, quantize, harmony, level === selected ? trace : undefined, level);
  return variants;
}

/**
 * Pure generation path. Every pitched track is first transcribed into one hummed line
 * (segment seconds, octave-fit, correct pitch, merge fragments, snap beats), then shaped
 * by its role: Melody stays a singable line, Bass anchors chord roots on downbeats,
 * Keys picks a chord per bar and plays it, Strings sustains a two-voice pad.
 * Drums classify beatbox hits instead. Off preserves unsnapped timing.
 * Invalid tempo/grid or oversized input throws; unusable melodic frames return []
 * so the recording UI can preserve existing notes.
 * Pass `trace` to read back the intermediate stages (for the reveal animation).
 */
export function generateNotes(
  inst: Instrument,
  frames: readonly HumFrame[],
  bpm: number,
  quantize: QuantizeDivision,
  harmony: Harmony,
  traceOrSensitivity?: GenTrace | NoteSensitivity,
  sensitivityArg?: NoteSensitivity,
): Note[] {
  if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180) throw new RangeError("BPM must be between 60 and 180.");
  if (!Object.hasOwn(QUANT_BEATS, quantize)) throw new RangeError("Unsupported quantization.");
  if (!Array.isArray(frames) || frames.length > MAX_SEGMENTATION_FRAMES) throw new RangeError("Too many analysis frames.");
  const trace = typeof traceOrSensitivity === "string" ? undefined : traceOrSensitivity;
  const sensitivity = typeof traceOrSensitivity === "string" ? traceOrSensitivity : sensitivityArg ?? DEFAULT_NOTE_SENSITIVITY;
  const config = noteSensitivityConfig(sensitivity);
  const grid = QUANT_BEATS[quantize];
  // Shift the whole take by the constant offset that best fits its onsets to the grid, then convert to beats.
  const beatsFrom = (onsetsSec: number[]) => {
    const shiftSec = alignmentSec(onsetsSec, bpm, grid);
    return (tSec: number) => Math.max(0, ((tSec + shiftSec) * bpm) / 60);
  };
  const snap = (b: number) => grid ? Math.round(b / grid) * grid : b;
  if (trace) Object.assign(trace, { voicedFrames: frames.filter((f) => f.hz !== null).length, raw: [], key: { tonic: harmony.tonic, mode: harmony.mode }, grid });
  if (inst.kind === "drums") return drums(frames, beatsFrom, snap, trace);

  const line = (fit: (notes: Note[]) => Note[]) => hummedLine(inst, frames, beatsFrom, snap, grid, bpm, fit, config, trace);
  switch (inst.id) {
    case "bass":
      return bassRole(line((n) => fitToHarmony(n, inst, harmony)), inst, harmony);
    case "keys":
      // Hum in the song's key; the hum then decides which chord each bar gets.
      return keysRole(line((n) => n.map((x) => ({ ...x, midi: clampToRange(snapToScale(x.midi, harmony), inst) }))), inst, harmony);
    case "strings":
      return stringsRole(line((n) => fitToHarmony(n, inst, harmony)), inst, harmony);
    default:
      // Melody sets the key, but confirmed chromatic semitone changes must remain audible.
      return melodyRole(line((n) => {
        const key = detectKey(n);
        if (trace) trace.key = key;
        return n;
      }), inst);
  }
}

/**
 * What generation did, stage by stage, for the reveal to show. `raw` is the hummed line in beats
 * before pitch fitting, merging and snapping (drums: classified hits before snapping). Final note ids
 * come from raw ids, except notes a role adds: bar-split pieces and extra Keys/Strings voices.
 */
export interface GenTrace {
  voicedFrames: number;
  raw: Note[];
  key?: Key; // Melody: the key detected from the take; other tracks: the song's key
  grid: number; // beats; 0 = Off
}

/** Largest constant timing error corrected, each way: unmeasured mic latency and singing ahead of/behind the click. */
const MAX_ALIGN_SEC = 0.08;
const ALIGN_STEP_SEC = 0.005;

/**
 * The constant shift (seconds) that puts the onsets closest to the grid, smallest shift on ties.
 * Needs three onsets: with fewer, any shift fits and it would just be snapping twice.
 */
export function alignmentSec(onsetsSec: readonly number[], bpm: number, grid: number): number {
  if (!grid || onsetsSec.length < 3) return 0;
  const error = (shiftSec: number) => onsetsSec.reduce((sum, t) => {
    const steps = ((t + shiftSec) * bpm) / 60 / grid;
    return sum + (steps - Math.round(steps)) ** 2;
  }, 0);
  let best = 0;
  let bestError = error(0);
  for (let k = 1; k * ALIGN_STEP_SEC <= MAX_ALIGN_SEC + 1e-9; k++) {
    for (const shiftSec of [k * ALIGN_STEP_SEC, -k * ALIGN_STEP_SEC]) {
      const e = error(shiftSec);
      if (e < bestError - 1e-9) [best, bestError] = [shiftSec, e];
    }
  }
  return best;
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

/** Octaves to add so the hum's median pitch lands mid-range for this instrument. */
export function octaveShift(inst: Instrument, midis: number[]): number {
  if (!midis.length) return 0;
  const sorted = [...midis].sort((a, b) => a - b);
  return Math.round(((inst.lo + inst.hi) / 2 - sorted[sorted.length >> 1]) / 12) * 12;
}

function clampToRange(midi: number, inst: Instrument): number {
  while (midi < inst.lo) midi += 12;
  while (midi > inst.hi) midi -= 12;
  return midi;
}

// ── Shared: hum → one monophonic line ──────────────────────────────────────────

/** Segment, octave-fit, apply the role's pitch correction, merge what correction made identical, then snap. */
function hummedLine(
  inst: Instrument,
  frames: readonly HumFrame[],
  beatsFrom: (onsetsSec: number[]) => (t: number) => number,
  snap: (b: number) => number,
  grid: number,
  bpm: number,
  fit: (notes: Note[]) => Note[],
  config: Readonly<SegmentationConfig>,
  trace?: GenTrace,
): Note[] {
  const segments = segmentPitchFrames(frames, config);
  const beatOf = beatsFrom(segments.map((r) => r.startSec));
  const shift = octaveShift(inst, segments.map((r) => r.midi));
  const staged = segments.map((r) => {
    const startBeat = beatOf(r.startSec);
    const endBeat = Math.min(TOTAL_BEATS, beatOf(r.endSec));
    return {
      phraseId: r.phraseId,
      note: { id: noteId(), midi: clampToRange(r.midi + shift, inst), startBeat, durationBeats: endBeat - startBeat, velocity: 0.8 },
    };
  }).filter(({ note }) => note.startBeat < TOTAL_BEATS && note.durationBeats > 0);
  if (trace) trace.raw = staged.map(({ note }) => ({ ...note }));
  // Correction can make different raw pitches identical; merging must follow it.
  const fitted = fit(staged.map(({ note }) => note));
  const merged: { note: Note; phraseId: number }[] = [];
  // A duration, not a time: beatOf would add the alignment shift.
  const mergeGapBeats = ((config.silenceHoldMs / 1000) * bpm) / 60;
  for (let i = 0; i < fitted.length; i++) {
    const note = fitted[i];
    const phraseId = staged[i].phraseId;
    const prev = merged[merged.length - 1];
    if (prev && prev.phraseId === phraseId && prev.note.midi === note.midi &&
      note.startBeat - (prev.note.startBeat + prev.note.durationBeats) <= mergeGapBeats + 1e-9) {
      prev.note.durationBeats = Math.max(prev.note.startBeat + prev.note.durationBeats, note.startBeat + note.durationBeats) - prev.note.startBeat;
    } else {
      merged.push({ note: { ...note }, phraseId });
    }
  }

  const out: Note[] = [];
  for (const { note } of merged) {
    const startBeat = snap(note.startBeat);
    const endBeat = Math.min(TOTAL_BEATS, Math.max(startBeat + grid, snap(note.startBeat + note.durationBeats)));
    if (startBeat >= TOTAL_BEATS || endBeat <= startBeat) continue;
    const prev = out[out.length - 1];
    if (prev && prev.startBeat + prev.durationBeats > startBeat) prev.durationBeats = startBeat - prev.startBeat;
    if (prev && prev.durationBeats <= 0) out.pop();
    out.push({ ...note, startBeat, durationBeats: endBeat - startBeat });
  }
  return out;
}

const isOn = (beat: number, every: number) => Math.abs(beat / every - Math.round(beat / every)) < 1e-6;

/** Louder on the downbeat, then beat 3, then other beats, softest off the beat. */
const accent = (beat: number) => (isOn(beat, 4) ? 0.9 : isOn(beat, 2) ? 0.8 : isOn(beat, 1) ? 0.72 : 0.64);

/** Cut notes at barlines so each piece can follow its own bar's chord; continuation ids go in `ties`. */
function splitAtBarlines(notes: Note[], ties: Set<string>): Note[] {
  return notes.flatMap((n) => {
    const pieces: Note[] = [];
    let start = n.startBeat;
    const end = n.startBeat + n.durationBeats;
    while (start < end - 1e-9) {
      const cut = Math.min(end, (Math.floor(start / 4 + 1e-9) + 1) * 4);
      const id = pieces.length ? noteId() : n.id;
      if (pieces.length) ties.add(id);
      pieces.push({ ...n, id, startBeat: start, durationBeats: cut - start });
      start = cut;
    }
    return pieces;
  });
}

/** Rejoin continuation pieces (ids in `ties`) that ended up on the same pitch as the note before. Repeated attacks stay apart. */
function joinTies(notes: Note[], ties: Set<string>): Note[] {
  const out: Note[] = [];
  for (const n of notes) {
    const prev = out.at(-1);
    if (prev && ties.has(n.id) && prev.midi === n.midi && Math.abs(prev.startBeat + prev.durationBeats - n.startBeat) < 1e-9)
      prev.durationBeats += n.durationBeats;
    else out.push({ ...n });
  }
  return out;
}

// ── Roles ──────────────────────────────────────────────────────────────────────

/** A short note this far (semitones) from both neighbours, same direction, is a pitch-tracker octave error. */
const OCTAVE_SPIKE_SEMITONES = 10;

/** Melody: one singable line. Fold octave-error spikes back (rejoining the held note), accent the strong beats. */
function melodyRole(line: Note[], inst: Instrument): Note[] {
  const ties = new Set<string>(); // a folded spike, and the note after it, rejoin the held note
  const folded = line.map((n, i) => {
    const prev = line[i - 1];
    const next = line[i + 1];
    let midi = n.midi;
    if (prev && next && n.durationBeats <= 0.5) {
      const fromPrev = midi - prev.midi;
      const fromNext = midi - next.midi;
      if (Math.abs(fromPrev) >= OCTAVE_SPIKE_SEMITONES && Math.abs(fromNext) >= OCTAVE_SPIKE_SEMITONES &&
        Math.sign(fromPrev) === Math.sign(fromNext)) {
        midi -= 12 * Math.sign(fromPrev);
        ties.add(n.id).add(next.id);
      }
    }
    return { ...n, midi: clampToRange(midi, inst) };
  });
  return joinTies(folded, ties).map((n) => ({ ...n, velocity: accent(n.startBeat) }));
}

/**
 * Bass: keep the hummed rhythm on chord roots and fifths, but make every bar start on its root.
 * A note crossing a chord change is re-struck on the new root; a bar's first note that lands
 * within beat 1 is pulled back onto the downbeat.
 */
function bassRole(line: Note[], inst: Instrument, h: Harmony): Note[] {
  const ties = new Set<string>();
  const notes = fitToHarmony(splitAtBarlines(line, ties), inst, h);
  const out: Note[] = [];
  for (const n of notes) {
    const barStart = Math.floor(n.startBeat / 4 + 1e-9) * 4;
    const firstInBar = !out.length || out[out.length - 1].startBeat < barStart;
    let note = n;
    if (firstInBar && n.startBeat < barStart + 1)
      note = { ...n, startBeat: barStart, durationBeats: n.durationBeats + n.startBeat - barStart };
    if (note.startBeat === barStart) note = { ...note, midi: clampToRange(nearest(note.midi, [chordAt(h, barStart)[0]]), inst) };
    out.push({ ...note, velocity: note.startBeat === barStart ? 0.9 : 0.75 });
  }
  return joinTies(out, ties);
}

/**
 * Keys: the hum picks the chords. Each bar gets the diatonic triad that best covers its hummed
 * notes (leaning toward the current chord), and every hummed note is played as that triad with
 * the hummed pitch on top. Studio reads the chords back (chordsFromVoicing) so other parts follow.
 */
function keysRole(line: Note[], inst: Instrument, h: Harmony): Note[] {
  const notes = splitAtBarlines(line, new Set());
  const chords = pickChords(notes, h, h.bars);
  return notes.flatMap((n) => {
    const chord = chordAt(chords, n.startBeat);
    let top = nearest(n.midi, chord);
    while (top - 9 < inst.lo) top += 12; // room for two chord tones below, within an octave
    while (top > inst.hi) top -= 12;
    const velocity = accent(n.startBeat) * 0.8;
    return chord.map((p) => {
      const midi = top - (((top - p) % 12) + 12) % 12; // this chord tone at or just below the top
      return { id: midi === top ? n.id : noteId(), midi, startBeat: n.startBeat, durationBeats: n.durationBeats, velocity };
    });
  });
}

/** Strings hold through breaths shorter than this, in beats. */
const PAD_HOLD_BEATS = 2;

/**
 * Strings: a sustained pad. Notes are held legato into the next one (or to the end of their bar),
 * re-voiced on each bar's chord, and doubled by the next chord tone below.
 */
function stringsRole(line: Note[], inst: Instrument, h: Harmony): Note[] {
  const held = line.map((n, i) => {
    const end = n.startBeat + n.durationBeats;
    const next = line[i + 1];
    const barEnd = Math.min(TOTAL_BEATS, Math.ceil(end / 4 - 1e-9) * 4);
    const target = next && next.startBeat - end <= PAD_HOLD_BEATS ? next.startBeat : Math.min(barEnd, next?.startBeat ?? barEnd);
    return { ...n, durationBeats: Math.max(end, target) - n.startBeat, velocity: 0.6 };
  });
  const ties = new Set<string>();
  const top = joinTies(fitToHarmony(splitAtBarlines(held, ties), inst, h), ties);
  const below = top.flatMap((n) => {
    const chord = chordAt(h, n.startBeat);
    for (let midi = n.midi - 1; midi >= Math.max(inst.lo, n.midi - 9); midi--)
      if (chord.includes(((midi % 12) + 12) % 12)) return [{ ...n, id: noteId(), midi, velocity: 0.45 }];
    return [];
  });
  return [...top, ...below].sort((a, b) => a.startBeat - b.startBeat || b.midi - a.midi);
}

// ── Drums ──────────────────────────────────────────────────────────────────────

const KICK = DRUM_ROWS[4].midi;
const SNARE = DRUM_ROWS[3].midi;
const HAT = DRUM_ROWS[2].midi;
/** Seconds after an onset used to judge what kind of hit it was. */
const HIT_WINDOW_SEC = 0.06;
/** At most one hit per this many seconds. */
const HIT_REFRACTORY_SEC = 0.08;
/** Spectrum centre of mass (in spectrogram bins, ~190 Hz) below which a hit is a kick. */
const KICK_CENTROID_BIN = 16;
/** Zero-crossing frequency above which a hit is hiss ("ts" = hat) rather than a "ka"/"pf" snare. */
const HAT_ZCR_HZ = 3000;

/**
 * Beatbox: "boom" = kick, "ka"/"pf" = snare, "ts" = hat. An onset is the level jumping above its
 * recent floor. Hat vs snare is the zero-crossing rate (hiss is high); frames without it (older
 * captures) fall back to loudness, quiet = hat. If no hats were beatboxed, eighth-note hats fill in.
 */
function drums(
  frames: readonly HumFrame[],
  beatsFrom: (onsetsSec: number[]) => (t: number) => number,
  snap: (b: number) => number,
  trace?: GenTrace,
): Note[] {
  // ponytail: duration (snares ring longer) is skipped; the 85 ms analysis window blurs hits shorter than that.
  const hits: { tSec: number; peak: number; kick: boolean; hiss: boolean | null }[] = [];
  let lastOnset = -Infinity;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const floor = i ? Math.min(...frames.slice(Math.max(0, i - 4), i).map((p) => p.rms)) : 0;
    if (f.rms <= 0.02 || !(floor <= 0.02 || f.rms >= 2 * floor) || f.tSec - lastOnset < HIT_REFRACTORY_SEC) continue;
    lastOnset = f.tSec;
    const hit = frames.slice(i).filter((w) => w.tSec - f.tSec <= HIT_WINDOW_SEC);
    let mass = 0;
    let moment = 0;
    for (const w of hit) w.bins.forEach((b, k) => { mass += b; moment += b * k; });
    const lowPitch = hit.some((w) => w.hz !== null && w.hz < 160);
    const zcr = hit.flatMap((w) => w.zcrHz ?? []);
    hits.push({
      tSec: f.tSec,
      peak: Math.max(...hit.map((w) => w.rms)),
      kick: lowPitch || (mass > 0 && moment / mass < KICK_CENTROID_BIN),
      hiss: zcr.length ? zcr.reduce((a, b) => a + b, 0) / zcr.length >= HAT_ZCR_HZ : null,
    });
  }
  if (!hits.length) return []; // silence: no fill-in hats over an empty take
  const beatOf = beatsFrom(hits.map((h) => h.tSec));

  const loudest = Math.max(0, ...hits.map((h) => h.peak));
  const out: Note[] = [];
  const taken = new Set<string>();
  for (const h of hits) {
    const raw = beatOf(h.tSec);
    const b = snap(raw);
    const midi = h.kick ? KICK : (h.hiss ?? h.peak < 0.6 * loudest) ? HAT : SNARE;
    const note = { id: noteId(), midi, startBeat: b, durationBeats: midi === HAT ? 0.25 : 0.5, velocity: 0.5 + 0.45 * (h.peak / loudest) };
    if (raw < TOTAL_BEATS) trace?.raw.push({ ...note, startBeat: raw });
    if (b >= TOTAL_BEATS || taken.has(`${b}:${midi}`)) continue;
    taken.add(`${b}:${midi}`);
    out.push(note);
  }
  if (!out.some((n) => n.midi === HAT)) {
    const end = Math.min(TOTAL_BEATS, Math.ceil(beatOf(frames.at(-1)?.tSec ?? 0) / 4) * 4);
    for (let b = 0; b < end; b += 0.5)
      out.push({ id: noteId(), midi: HAT, startBeat: b, durationBeats: 0.25, velocity: b % 1 ? 0.45 : 0.7 });
  }
  return out.sort((a, b) => a.startBeat - b.startBeat);
}
