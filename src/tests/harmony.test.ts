import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HARMONY, chordName, detectKey, fitToHarmony, inferHarmony, pickChords, snapToScale, voiceChords, withKey } from "../lib/music/harmony.ts";
import { INSTRUMENTS, type Note } from "../lib/tracks.ts";

const note = (midi: number, startBeat: number, durationBeats = 1): Note => ({ id: `${midi}-${startBeat}`, midi, startBeat, durationBeats, velocity: 0.8 });
const seq = (midis: number[], start = 0) => midis.map((m, i) => note(m, start + i));
const inst = (id: string) => INSTRUMENTS.find((i) => i.id === id)!;

test("T-16 detectKey finds C major and A minor", () => {
  assert.deepEqual(detectKey(seq([60, 64, 67, 72, 65, 62, 59, 60])), { tonic: 0, mode: "major" });
  assert.deepEqual(detectKey(seq([57, 60, 64, 69, 62, 57, 64, 57])), { tonic: 9, mode: "minor" });
});

test("T-17 snapToScale pulls off-scale notes to the nearest scale tone, ties down", () => {
  assert.equal(snapToScale(61, { tonic: 0, mode: "major" }), 60);
  assert.equal(snapToScale(64, { tonic: 0, mode: "major" }), 64);
  assert.equal(snapToScale(64, { tonic: 0, mode: "minor" }), 63);
});

test("T-18 inferHarmony picks I IV V I and repeats into empty bars", () => {
  const melody = [...seq([60, 64, 67, 64]), ...seq([65, 69, 72, 69], 4), ...seq([67, 71, 74, 71], 8), ...seq([72, 67, 64, 60], 12)];
  const h = inferHarmony(melody);
  assert.equal(h.tonic, 0);
  assert.deepEqual(h.bars.map(chordName), ["C", "F", "G", "C", "C", "C", "C", "C"]);
});

test("T-19 fitToHarmony: bass to root/fifth in range, drums untouched", () => {
  const bass = fitToHarmony(seq([40, 41, 47, 30]), inst("bass"), DEFAULT_HARMONY); // bar 1 is Am
  for (const n of bass) {
    assert.ok([9, 4].includes(n.midi % 12), `midi ${n.midi}`);
    assert.ok(n.midi >= 28 && n.midi <= 52);
  }
  const drums = seq([36, 38]);
  assert.equal(fitToHarmony(drums, inst("drums"), DEFAULT_HARMONY), drums);
});

test("fitToHarmony keeps ids and only moves off-chord keys", () => {
  const out = fitToHarmony([note(61, 0), note(64, 0)], inst("keys"), DEFAULT_HARMONY);
  assert.deepEqual(out.map((n) => [n.id, n.midi]), [["61-0", 60], ["64-0", 64]]);
});

test("voiceChords(DEFAULT_HARMONY) reproduces the Am F C G sample", () => {
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const expected = [0, 16].flatMap((o) => chords.flatMap((c, i) => c.map((m) => `${m}@${o + i * 4}`))).sort();
  assert.deepEqual(voiceChords(DEFAULT_HARMONY).map((n) => `${n.midi}@${n.startBeat}`).sort(), expected);
});

test("an ambiguous bar follows the progression: a lone G after F is the V chord, then held", () => {
  const melody = [...seq([60, 64, 67, 64]), ...seq([65, 69, 72, 69], 4), note(67, 8, 4)];
  const h = pickChords(melody, { tonic: 0, mode: "major" });
  assert.deepEqual(h.bars.slice(0, 4).map(chordName), ["C", "F", "G", "G"]); // per-bar argmax picked C for the G bar
});

test("the last note pulls an ambiguous hum toward its key", () => {
  // C-major and A-minor share every note; a scale run up to A reads C major without the end bonus.
  const melody = seq([60, 62, 64, 65, 67, 69]);
  assert.deepEqual(detectKey(melody), { tonic: 9, mode: "minor" });
});

test("withKey moves the sample progression to a picked key, or re-picks from the melody", () => {
  assert.deepEqual(withKey({ tonic: 2, mode: "major" }, []).bars.slice(0, 4).map(chordName), ["Bm", "G", "D", "A"]);
  const fromMelody = withKey({ tonic: 7, mode: "major" }, [...seq([67, 71, 74, 71])]);
  assert.equal(chordName(fromMelody.bars[0]), "G");
});
