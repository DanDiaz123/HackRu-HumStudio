// Real-take regression: every src/tests/takes/*.json is generated and scored against hand-written notes.
// To add one: in `npm run dev`, record a take, then in the browser console run `copy(__humTake)` and save
// it as src/tests/takes/<name>.json. Fill in "expected" (the notes you meant, in beats) and optionally
// "minF1" to make the test fail below that score. Takes hold analysis frames only, never raw audio.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { generateNotes } from "../lib/generate.ts";
import type { HumFrame } from "../lib/hum.ts";
import { DEFAULT_HARMONY, type Harmony } from "../lib/music/harmony.ts";
import { INSTRUMENTS, type QuantizeDivision } from "../lib/tracks.ts";
import { type ExpectedNote, scoreNotes } from "./fixtures/score.ts";
import { pitchFrames } from "./fixtures/transcription.ts";

interface Take {
  instrument: string;
  bpm: number;
  quantize: QuantizeDivision;
  harmony?: Harmony;
  frames: (Omit<HumFrame, "bins"> & { bins: number[] })[];
  expected?: ExpectedNote[];
  minF1?: number;
}

const melody = INSTRUMENTS.find((i) => i.id === "melody")!;

test("scoreNotes: pitch must match and onsets fall within 50 ms", () => {
  const n = (midi: number, startBeat: number) => ({ id: "", midi, startBeat, durationBeats: 1, velocity: 0.8 });
  assert.equal(scoreNotes([n(60, 0), n(62, 1)], [n(60, 0.08), n(62, 1)], 120).f1, 1); // 40 ms early is inside
  assert.deepEqual(scoreNotes([n(60, 0), n(62, 1)], [n(60, 0), n(63, 1), n(64, 2)], 120), { precision: 1 / 3, recall: 0.5, f1: 0.4 });
});

test("repeated syllables on one pitch come out as separate notes", () => {
  // "da da da da" on A3, one per beat at 120 BPM, with a 60 ms level dip between syllables.
  const da = [{ midi: 57, durationSec: 0.44 }, { midi: 57, durationSec: 0.06, rms: 0.03 }];
  const notes = generateNotes(melody, pitchFrames([...da, ...da, ...da, ...da]), 120, "1/4", DEFAULT_HARMONY);
  const expected = [0, 1, 2, 3].map((startBeat) => ({ midi: 69, startBeat })); // Melody sits an octave up
  assert.equal(scoreNotes(expected, notes, 120).f1, 1, JSON.stringify(notes.map((x) => [x.midi, x.startBeat])));
});

const dir = new URL("./takes/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
for (const file of files) {
  test(`take ${file}`, (t) => {
    const take: Take = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    const inst = INSTRUMENTS.find((i) => i.id === take.instrument);
    assert.ok(inst, `unknown instrument ${take.instrument}`);
    const frames = take.frames.map((f) => ({ ...f, bins: Float32Array.from(f.bins) }));
    const notes = generateNotes(inst, frames, take.bpm, take.quantize, take.harmony ?? DEFAULT_HARMONY);
    if (!take.expected) return t.skip(`no "expected" notes yet; generated ${notes.length}`);
    const s = scoreNotes(take.expected, notes, take.bpm);
    t.diagnostic(`F1 ${s.f1.toFixed(2)} (precision ${s.precision.toFixed(2)}, recall ${s.recall.toFixed(2)})`);
    if (take.minF1 !== undefined) assert.ok(s.f1 >= take.minF1, `F1 ${s.f1.toFixed(2)} < ${take.minF1}`);
  });
}
