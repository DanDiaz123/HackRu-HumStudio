import { generateTrackVariants, snapNotesToGrid, type NoteSensitivityVariants } from "../generate.ts";
import type { HumFrame } from "../hum.ts";
import type { NoteSensitivity } from "../audio/note-sensitivity.ts";
import type { Note, QuantizeDivision, Track } from "../tracks.ts";
import type { LoadedProject } from "../persistence/project.ts";
import { MAX_PROJECT_NOTES } from "../persistence/project.ts";
import { chordsFromVoicing, fitToHarmony, inferHarmony, voiceChords, withKey, type Harmony, type Key } from "./harmony.ts";

/** Runtime analysis only. Capture tempo stays fixed because the saved note positions are musical beats. */
export interface RecordedTake {
  frames: HumFrame[];
  bpm: number;
  variants: NoteSensitivityVariants;
}

export type RecordedTakes = Record<string, RecordedTake>;
export type SnapSources = Record<string, Note[]>;

/** In-memory history includes analysis/settings sources; project JSON deliberately contains only LoadedProject. */
export interface ArrangementSnapshot extends LoadedProject {
  takes: RecordedTakes;
  snapSources: SnapSources;
  pickedKey: Key | null;
  harmonyDriver: "melody" | "keys" | null;
}

/** Copy mutable runtime containers; notes, takes, and harmony are replaced immutably by their owners. */
export function captureArrangementSnapshot(state: ArrangementSnapshot): ArrangementSnapshot {
  return { ...state, meta: { ...state.meta }, takes: { ...state.takes }, snapSources: { ...state.snapSources } };
}

/** Files contain notes, never captures: an imported part's saved timing becomes its new Snap source. */
export function projectArrangementSnapshot(project: LoadedProject): ArrangementSnapshot {
  return captureArrangementSnapshot({ ...project, takes: {}, pickedKey: null, harmonyDriver: null,
    snapSources: Object.fromEntries(project.tracks.map(track => [track.instrument.id, track.notes.map(note => ({ ...note }))])) });
}

export interface NoteSettingsInput {
  tracks: Track[];
  harmony: Harmony;
  takes: RecordedTakes;
  snapSources: SnapSources;
  sensitivity: NoteSensitivity;
  quantize: QuantizeDivision;
  harmonyDriver: "melody" | "keys" | null;
  keyOverride: Key | null;
  /** Only an explicit key pick corrects a hand-edited Melody's pitch. */
  fitEditedMelody?: boolean;
  /** Rebuild from original timing on a grid change; profile changes reuse all three cached variants. */
  resnap?: boolean;
}

/** Compare musical contents so equivalent new chord arrays do not trigger role regeneration. */
export function sameHarmony(a: Harmony, b: Harmony): boolean {
  return a.tonic === b.tonic && a.mode === b.mode && a.bars.length === b.bars.length &&
    a.bars.every((bar, index) => bar.length === b.bars[index].length && bar.every((pitch, i) => pitch === b.bars[index][i]));
}

/** Refit pitch only, preserving manual timing. The labeled Keys sample follows the song's voicing. */
export function refitTrack(track: Track, harmony: Harmony, melodyToo = false): Track {
  if (track.instrument.kind === "drums" || (track.instrument.id === "melody" && !melodyToo)) return track;
  return { ...track, notes: track.sample ? voiceChords(harmony) : fitToHarmony(track.notes, track.instrument, harmony) };
}

/**
 * Compute a complete profile/grid update outside React state updaters. Inputs are never mutated;
 * returned takes and unsnapped sources must be retained together with the returned tracks/harmony.
 * Edited tracks have no take and therefore cannot be overwritten by a sensitivity selection.
 */
export function applyNoteSettings(input: NoteSettingsInput): {
  tracks: Track[]; harmony: Harmony; takes: RecordedTakes; snapSources: SnapSources;
} {
  const { sensitivity, quantize } = input;
  const takes = { ...input.takes };
  const snapSources = { ...input.snapSources };
  const rebuild = (track: Track, harmony: Harmony) => {
    const take = takes[track.instrument.id];
    takes[track.instrument.id] = { ...take,
      variants: generateTrackVariants(track.instrument, take.frames, take.bpm, quantize, harmony, sensitivity) };
  };
  if (input.resnap) {
    for (const track of input.tracks) if (takes[track.instrument.id]) rebuild(track, input.harmony);
  }

  const melodyVariant = takes.melody?.variants[sensitivity];
  const melody = melodyVariant?.length ? melodyVariant : input.tracks.find(track => track.instrument.id === "melody")?.notes ?? [];
  const baseHarmony = input.keyOverride ? withKey(input.keyOverride, melody)
    : input.harmonyDriver === "melody" && melodyVariant?.length ? inferHarmony(melody) : input.harmony;
  if (input.harmonyDriver === "keys" && takes.keys && (input.fitEditedMelody ||
    baseHarmony.tonic !== input.harmony.tonic || baseHarmony.mode !== input.harmony.mode)) {
    const keysTrack = input.tracks.find(track => track.instrument.id === "keys");
    if (keysTrack) rebuild(keysTrack, baseHarmony);
  }
  const keys = takes.keys?.variants[sensitivity];
  const harmony = input.harmonyDriver === "keys" && keys?.length ? chordsFromVoicing(keys, baseHarmony) : baseHarmony;
  const harmonyChanged = !sameHarmony(harmony, input.harmony);

  // Recreate dependent roles instead of individually fitting an old chord stack into a new chord.
  if (harmonyChanged) {
    for (const track of input.tracks) {
      if (!takes[track.instrument.id] || track.instrument.id === "melody" || track.instrument.kind === "drums" ||
        (track.instrument.id === "keys" && input.harmonyDriver === "keys")) continue;
      rebuild(track, harmony);
    }
  }

  const tracks = input.tracks.map(track => {
    const id = track.instrument.id;
    const variant = takes[id]?.variants[sensitivity];
    if (variant?.length) {
      // A manually chosen key continues to apply when selecting another cached Melody profile.
      const notes = id === "melody" && input.keyOverride ? fitToHarmony(variant, track.instrument, harmony) : variant;
      return { ...track, notes, sample: false };
    }
    if (variant) return track; // A stricter profile with no notes must not erase a working part.
    const source = snapSources[id] ?? track.notes;
    const shouldFit = harmonyChanged || input.fitEditedMelody;
    const fittedSource = shouldFit ? refitTrack({ ...track, notes: source }, harmony, input.fitEditedMelody).notes : source;
    const fitted = shouldFit ? { ...track, notes: snapSources[id] ? refitTrack(track, harmony, input.fitEditedMelody).notes : fittedSource } : track;
    if (snapSources[id] || input.resnap) snapSources[id] = fittedSource;
    return input.resnap ? { ...fitted, notes: snapNotesToGrid(track.instrument, fittedSource, quantize) } : fitted;
  });
  if (tracks.reduce((count, track) => count + track.notes.length, 0) > MAX_PROJECT_NOTES) {
    throw new RangeError(`This project can hold at most ${MAX_PROJECT_NOTES.toLocaleString()} notes. Remove notes before generating or repeating a part.`);
  }
  return { tracks, harmony, takes, snapSources };
}
