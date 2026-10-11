import { renderTrackProfiles, snapNotesToGrid, type NoteSensitivityVariants, type NoteSensitivitySources } from "../generate.ts";
import { isNoteSensitivity, type NoteSensitivity } from "../audio/note-sensitivity.ts";
import { QUANT_BEATS, drumPart, type DrumPart, type Note, type QuantizeDivision, type Track } from "../tracks.ts";
import type { LoadedProject } from "../persistence/project.ts";
import { MAX_PROJECT_NOTES } from "../persistence/project.ts";
import { chordsFromVoicing, fitToHarmony, inferHarmony, voiceChords, withKey, type Harmony, type Key } from "./harmony.ts";

/** Serializable musical sources, never microphone audio or capture frames. Tempo is fixed at capture. */
export interface TakeSource {
  bpm: number;
  sources: NoteSensitivitySources;
  drumPart?: DrumPart;
}
/** Runtime profiles rebuilt from note-only sources after Open, Snap or harmony changes. */
export interface RecordedTake extends TakeSource { variants: NoteSensitivityVariants }
export type RecordedTakes = Record<string, RecordedTake>;
export type SnapSources = Record<string, Note[]>;
export interface RegenerationData {
  takes: Record<string, TakeSource>;
  snapSources: SnapSources;
  pickedKey: Key | null;
  harmonyDriver: "melody" | "keys" | null;
}
/** History includes sources/settings so a whole recording or setting change is undoable. */
export interface ArrangementSnapshot extends LoadedProject {
  takes: RecordedTakes;
  snapSources: SnapSources;
  pickedKey: Key | null;
  harmonyDriver: "melody" | "keys" | null;
}
/** Notes and source objects are immutable; clone containers modified by the studio. */
export function captureArrangementSnapshot(state: ArrangementSnapshot): ArrangementSnapshot {
  return { ...state, meta: { ...state.meta }, takes: { ...state.takes }, snapSources: { ...state.snapSources } };
}
/** Restore musical sources; older files retain their final notes as the only timing source. */
export function projectArrangementSnapshot(project: LoadedProject): ArrangementSnapshot {
  const data = project.regeneration;
  const takes: RecordedTakes = Object.fromEntries(project.tracks.flatMap(track => {
    const take = data?.takes[track.instrument.id];
    return take ? [[track.instrument.id, { ...take, variants: renderTake(track, take, project.harmony) }]] : [];
  }));
  return captureArrangementSnapshot({ ...project, takes, pickedKey: data?.pickedKey ?? null,
    harmonyDriver: data?.harmonyDriver ?? null,
    snapSources: { ...Object.fromEntries(project.tracks.filter(track => !takes[track.instrument.id])
      .map(track => [track.instrument.id, track.notes.map(note => ({ ...note }))])), ...data?.snapSources } });
}
export interface NoteSettingsInput {
  tracks: Track[];
  harmony: Harmony;
  takes: RecordedTakes;
  snapSources: SnapSources;
  /** Only this track changes, except necessary shared-harmony pitch fitting. */
  trackId?: string;
  sensitivity?: NoteSensitivity;
  quantize?: QuantizeDivision;
  harmonyDriver: "melody" | "keys" | null;
  keyOverride: Key | null;
  fitEditedMelody?: boolean;
  resnap?: boolean;
}
/** Compare musical contents, not object identities. */
export function sameHarmony(a: Harmony, b: Harmony): boolean {
  return a.tonic === b.tonic && a.mode === b.mode && a.bars.length === b.bars.length &&
    a.bars.every((bar, index) => bar.length === b.bars[index].length && bar.every((pitch, i) => pitch === b.bars[index][i]));
}
/** Refit pitch without changing manual timing. Only the labeled Keys sample uses chord voicing. */
export function refitTrack(track: Track, harmony: Harmony, melodyToo = false): Track {
  if (track.instrument.kind === "drums" || (track.instrument.id === "melody" && !melodyToo)) return track;
  if (track.sample && track.instrument.id === "keys") {
    const voiced = voiceChords(harmony);
    // Sample chords follow the song, but their timing still belongs to the track's chosen grid.
    if (voiced.length === track.notes.length)
      return { ...track, notes: track.notes.map((note, index) => ({ ...note, midi: voiced[index].midi })) };
  }
  return { ...track, notes: fitToHarmony(track.notes, track.instrument, harmony) };
}
function renderTake(track: Track, take: TakeSource, harmony: Harmony): NoteSensitivityVariants {
  return renderTrackProfiles(track.instrument, take.sources, take.bpm, track.quantize, harmony, track.sensitivity, undefined, take.drumPart);
}
/** Keep the other drum lanes when the latest selected-lane take changes profile. */
function takeNotes(track: Track, take: RecordedTake): Note[] {
  const variant = take.variants[track.sensitivity];
  if (!variant.length) return track.notes; // A strict profile must never erase a working part.
  if (!take.drumPart || track.instrument.kind !== "drums") return variant;
  return [...track.notes.filter(note => note.midi !== drumPart(take.drumPart).midi), ...variant]
    .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi || a.id.localeCompare(b.id));
}
/** Apply one instrument's settings atomically. Hand edits discard takes and cannot restore old profiles. */
export function applyNoteSettings(input: NoteSettingsInput): {
  tracks: Track[]; harmony: Harmony; takes: RecordedTakes; snapSources: SnapSources;
} {
  if (input.sensitivity !== undefined && !isNoteSensitivity(input.sensitivity)) throw new RangeError("Unsupported note sensitivity.");
  if (input.quantize !== undefined && !Object.hasOwn(QUANT_BEATS, input.quantize)) throw new RangeError("Unsupported quantization.");
  if (input.trackId !== undefined && !input.tracks.some(track => track.instrument.id === input.trackId)) throw new RangeError("Unknown instrument.");
  const takes = { ...input.takes };
  const snapSources = { ...input.snapSources };
  let requested = input.tracks.map(track => track.instrument.id === input.trackId ? { ...track,
    sensitivity: input.sensitivity ?? track.sensitivity, quantize: input.quantize ?? track.quantize } : track);
  const target = requested.find(track => track.instrument.id === input.trackId);
  if (target && takes[target.instrument.id] && input.resnap) {
    const take = takes[target.instrument.id];
    takes[target.instrument.id] = { ...take, variants: renderTake(target, take, input.harmony) };
    if (take.drumPart && target.instrument.kind === "drums") {
      const midi = drumPart(take.drumPart).midi;
      const otherParts = (snapSources[target.instrument.id] ?? target.notes).filter(note => note.midi !== midi);
      snapSources[target.instrument.id] = otherParts;
      const snapped = snapNotesToGrid(target.instrument, otherParts, target.quantize);
      requested = requested.map(track => track.instrument.id === target.instrument.id
        ? { ...track, notes: [...snapped, ...track.notes.filter(note => note.midi === midi)] } : track);
    }
  }
  const notesFor = (track: Track) => takes[track.instrument.id] ? takeNotes(track, takes[track.instrument.id]) : track.notes;
  const melodyTrack = requested.find(track => track.instrument.id === "melody")!;
  const melody = notesFor(melodyTrack);
  const melodyChanged = input.trackId === "melody" && !!takes.melody && takes.melody.variants[melodyTrack.sensitivity].length > 0;
  const baseHarmony = input.keyOverride ? withKey(input.keyOverride, melody)
    : input.harmonyDriver === "melody" && melodyChanged ? inferHarmony(melody) : input.harmony;
  const keysTrack = requested.find(track => track.instrument.id === "keys")!;
  const keyChanged = baseHarmony.tonic !== input.harmony.tonic || baseHarmony.mode !== input.harmony.mode;
  if (input.harmonyDriver === "keys" && takes.keys && (keyChanged || input.fitEditedMelody))
    takes.keys = { ...takes.keys, variants: renderTake(keysTrack, takes.keys, baseHarmony) };
  const keysChanged = input.trackId === "keys" || keyChanged || input.fitEditedMelody;
  const keys = takes.keys?.variants[keysTrack.sensitivity];
  const harmony = input.harmonyDriver === "keys" && keysChanged && keys?.length ? chordsFromVoicing(keys, baseHarmony) : baseHarmony;
  const harmonyChanged = !sameHarmony(harmony, input.harmony);
  // Recreate role voicings at each dependent track's own grid, instead of fitting old chord stacks.
  if (harmonyChanged) for (const track of requested) {
    const id = track.instrument.id;
    if (!takes[id] || id === "melody" || track.instrument.kind === "drums" || (id === "keys" && input.harmonyDriver === "keys")) continue;
    takes[id] = { ...takes[id], variants: renderTake(track, takes[id], harmony) };
  }
  const tracks = requested.map(track => {
    const id = track.instrument.id;
    const isTarget = id === input.trackId;
    const shouldFit = harmonyChanged || input.fitEditedMelody;
    if (takes[id]) {
      if (!isTarget && !shouldFit) return track;
      const notes = notesFor(track);
      return { ...track, notes: id === "melody" && input.keyOverride
        ? fitToHarmony(notes, track.instrument, harmony) : notes, sample: false };
    }
    const source = snapSources[id] ?? track.notes;
    const fittedSource = shouldFit ? refitTrack({ ...track, notes: source }, harmony, input.fitEditedMelody).notes : source;
    const fitted = shouldFit ? refitTrack(track, harmony, input.fitEditedMelody) : track;
    if (shouldFit && snapSources[id]) snapSources[id] = fittedSource;
    if (isTarget && input.resnap) {
      snapSources[id] = fittedSource;
      return { ...fitted, notes: snapNotesToGrid(track.instrument, fittedSource, track.quantize) };
    }
    return fitted;
  });
  if (tracks.reduce((count, track) => count + track.notes.length, 0) > MAX_PROJECT_NOTES)
    throw new RangeError("This project can hold at most " + MAX_PROJECT_NOTES.toLocaleString() + " notes. Remove notes before generating or repeating a part.");
  return { tracks, harmony, takes, snapSources };
}
