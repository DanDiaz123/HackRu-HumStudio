import assert from "node:assert/strict";
import { test } from "node:test";
import ToneMidi from "@tonejs/midi";
import { createNoteClipboard, pasteCopiedNotes, previewCopiedNotes, selectNotesInRect, validateCopiedPlacement } from "../lib/note-clipboard.ts";
import { midiBytes } from "../lib/midi.ts";
import { DEFAULT_HARMONY } from "../lib/music/harmony.ts";
import { MAX_PROJECT_NOTES, newProjectMeta, parseProject, serializeProject } from "../lib/persistence/project.ts";
import { initialTracks, noteRow, type Note } from "../lib/tracks.ts";

const { Midi } = ToneMidi;
const n = (id: string, midi: number, startBeat: number, durationBeats = 0.5): Note => ({ id, midi, startBeat, durationBeats, velocity: 0.7 });
const track = (id = "melody") => initialTracks().find(t => t.instrument.id === id)!;
const phrase = [n("a", 64, 1.13), n("b", 67, 2.31, 0.7), n("c", 71, 3.22, 1.25)];

test("rectangle selection intersects whole notes in all four directions without changing notes", () => {
  const inst = track().instrument, row = noteRow(64, inst);
  const notes = [n("partial", 64, 4, 2), n("outside-pitch", 67, 4, 2), n("outside-time", 64, 8)];
  const before = structuredClone(notes);
  for (const reverseX of [false, true]) for (const reverseY of [false, true]) {
    const selected = selectNotesInRect(notes, inst, {
      from: { beat: reverseX ? 6.1 : 5.8, row: row + (reverseY ? 0.8 : 0.2) },
      to: { beat: reverseX ? 5.8 : 6.1, row: row + (reverseY ? 0.2 : 0.8) },
    });
    assert.deepEqual(selected, [notes[0]]);
  }
  assert.deepEqual(notes, before);
});
test("selection honors rendered minimum sizes, bounds and empty regions", () => {
  const inst = track().instrument, row = noteRow(64, inst), notes = [n("tiny", 64, 4, 0.001)];
  assert.equal(selectNotesInRect(notes, inst, { from: { beat: 4.02, row: row + 1.1 }, to: { beat: 4.04, row: row + 1.2 } }, { beats: 0.06, rows: 1.5 }).length, 1);
  assert.equal(selectNotesInRect(notes, inst, { from: { beat: -1, row: -1 }, to: { beat: 0, row: 0 } }).length, 0);
  assert.equal(selectNotesInRect(notes, inst, { from: { beat: 1, row }, to: { beat: 1, row } }).length, 0);
  assert.equal(selectNotesInRect(notes, inst, { from: { beat: NaN, row }, to: { beat: 2, row } }).length, 0);
});
test("clipboard and previews leave originals intact and snap only the group's anchor", () => {
  const original = structuredClone(phrase), clipboard = createNoteClipboard("melody", phrase);
  const preview = previewCopiedNotes(clipboard, 8.12, "1/4");
  assert.equal(preview[0].startBeat, 8);
  for (let i = 0; i < preview.length; i++) {
    assert.ok(Math.abs((preview[i].startBeat - preview[0].startBeat) - (phrase[i].startBeat - phrase[0].startBeat)) < 1e-12);
    assert.equal(preview[i].midi, phrase[i].midi); assert.equal(preview[i].durationBeats, phrase[i].durationBeats);
    assert.equal(preview[i].velocity, phrase[i].velocity);
  }
  assert.equal(previewCopiedNotes(clipboard, 8.12, "off")[0].startBeat, 8.12);
  clipboard.notes[0].velocity = 0.2; assert.deepEqual(phrase, original);
});
test("group paste creates fresh IDs, preserves chords and inserts atomically into a full track", () => {
  const chord = [60, 64, 67].map((midi, i) => n("chord-" + i, midi, 1.2, 1.5));
  const keys = { ...track("keys"), notes: chord }, before = structuredClone(keys);
  let seq = 0;
  const pasted = pasteCopiedNotes(keys, createNoteClipboard("keys", chord), 8.13, chord.length, undefined, () => "copy-" + seq++);
  assert.equal(pasted.length, 6); assert.deepEqual(pasted.slice(0, 3), chord);
  assert.ok(pasted.slice(3).every(note => note.startBeat === 8 && note.durationBeats === 1.5));
  assert.equal(new Set(pasted.map(note => note.id)).size, 6); assert.deepEqual(keys, before);
});
test("multi-row drum paste preserves lane assignments, selected part and unrelated notes", () => {
  const drums = { ...track("drums"), drumPart: "openHat" as const, notes: [n("kick", 36, 0), n("snare", 38, 1), n("hat", 42, 1.5), n("crash", 49, 31)] };
  const selected = selectNotesInRect(drums.notes, drums.instrument, { from: { beat: -1, row: 0 }, to: { beat: 2, row: 5 } });
  const result = pasteCopiedNotes(drums, createNoteClipboard("drums", selected), 8, drums.notes.length);
  assert.deepEqual(result.filter(note => drums.notes.some(old => old.id === note.id)), drums.notes);
  assert.deepEqual(result.filter(note => !drums.notes.some(old => old.id === note.id)).map(note => [note.midi, note.startBeat]), [[36, 8], [38, 9], [42, 9.5]]);
  assert.equal(drums.drumPart, "openHat");
});
test("timeline overflow, collisions and total count reject the whole paste without changing input", () => {
  const melody = { ...track(), notes: phrase }, clipboard = createNoteClipboard("melody", phrase), before = structuredClone(melody);
  for (const beat of [-1, 31, NaN, Infinity]) assert.throws(() => pasteCopiedNotes(melody, clipboard, beat, phrase.length), RangeError);
  assert.throws(() => pasteCopiedNotes(melody, clipboard, 1, phrase.length), /overlap/);
  assert.throws(() => pasteCopiedNotes(melody, clipboard, 8, MAX_PROJECT_NOTES), /10,000/);
  assert.throws(() => pasteCopiedNotes(track("keys"), clipboard, 8, 500), /same instrument/);
  assert.deepEqual(melody, before);
});
test("a single collision rejects all copies; same-pitch end-to-start contact is legal", () => {
  const melody = { ...track(), notes: [n("existing", 64, 8, 2)] };
  const group = createNoteClipboard("melody", [n("first", 67, 1), n("second", 64, 2)]);
  assert.throws(() => validateCopiedPlacement(melody, group, 8, 1), /overlap/);
  const single = createNoteClipboard("melody", [n("one", 64, 1)]);
  assert.equal(pasteCopiedNotes(melody, single, 10, 1).length, 2);
  const overlapping = createNoteClipboard("melody", [n("a", 64, 1, 2), n("b", 64, 2)]);
  assert.throws(() => pasteCopiedNotes({ ...melody, notes: [] }, overlapping, 12, 0), /overlap/);
});
test("project-wide ID collisions and malformed clipboards reject before insertion", () => {
  const melody = { ...track(), notes: phrase }, clipboard = createNoteClipboard("melody", phrase);
  assert.throws(() => pasteCopiedNotes(melody, clipboard, 8, phrase.length, ["other-track-id"], () => "other-track-id"), /unique/);
  assert.throws(() => pasteCopiedNotes(melody, clipboard, 8, phrase.length, undefined, () => "reused"), /unique/);
  assert.throws(() => createNoteClipboard("melody", []), RangeError);
  assert.throws(() => createNoteClipboard("melody", [phrase[0], phrase[0]]), RangeError);
  assert.throws(() => createNoteClipboard("melody", [{ ...phrase[0], velocity: Infinity }]), RangeError);
});
test("pasted notes round-trip through project JSON and multi-track MIDI", () => {
  const melody = { ...track(), sample: false, notes: phrase };
  const pasted = { ...melody, notes: pasteCopiedNotes(melody, createNoteClipboard("melody", phrase), 8, phrase.length) };
  const tracks = initialTracks().map(t => t.instrument.id === "melody" ? pasted : { ...t, notes: [] });
  const saved = serializeProject({ tracks, bpm: 120, harmony: DEFAULT_HARMONY, meta: newProjectMeta() });
  const loaded = parseProject(saved);
  assert.deepEqual(loaded.tracks[0].notes, pasted.notes);
  assert.equal(new Midi(midiBytes(loaded.tracks, 120)).tracks[0].notes.length, 6);
  assert.equal(saved.includes('"clipboard"'), false);
});
