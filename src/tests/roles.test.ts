import assert from "node:assert/strict";
import { test } from "node:test";
import { alignmentSec, generateNotes } from "../lib/generate.ts";
import type { HumFrame } from "../lib/hum.ts";
import { DEFAULT_HARMONY, chordsFromVoicing } from "../lib/music/harmony.ts";
import { INSTRUMENTS, noteRow, pitchRows, rowMidi } from "../lib/tracks.ts";
import { pitchFrames } from "./fixtures/transcription.ts";

// DEFAULT_HARMONY is C major, Am F C G ×2: bar 0 = A C E, bar 1 = F A C.
const instrument = (id: string) => INSTRUMENTS.find(i => i.id === id)!;
const pc = (m: number) => ((m % 12) + 12) % 12;
const gen = (id: string, frames: HumFrame[]) => generateNotes(instrument(id), frames, 120, "1/16", DEFAULT_HARMONY);

test("melody folds a short octave-error spike back into the held note", () => {
  const notes = gen("melody", pitchFrames([
    { midi: 57, durationSec: 0.6 }, { midi: 69, durationSec: 0.2 }, { midi: 57, durationSec: 0.6 }, // spike stays inside the range
  ]));
  assert.equal(notes.length, 1, JSON.stringify(notes.map(n => [n.midi, n.startBeat, n.durationBeats])));
  assert.equal(notes[0].velocity, 0.9); // starts on the downbeat
});

test("bass starts each bar on its chord root and re-roots a note held across the chord change", () => {
  // One held hum from beat 0.5 to beat 6.5, crossing from Am into F.
  const notes = gen("bass", pitchFrames([{ midi: 45, durationSec: 3 }], 0.02, 0.25));
  assert.equal(notes[0].startBeat, 0, "pulled onto the downbeat");
  assert.equal(pc(notes[0].midi), 9, "A root in bar 1");
  const bar2 = notes.find(n => n.startBeat === 4);
  assert.ok(bar2, "re-struck at the barline");
  assert.equal(pc(bar2.midi), 5, "F root in bar 2");
});

test("keys: the hum picks the chord, played as a triad with the hummed note on top", () => {
  // A held F over bar 0, whose current chord (Am) has no F: the hum should switch it to F major.
  const notes = gen("keys", pitchFrames([{ midi: 65, durationSec: 1.9 }]));
  const chord = notes.filter(n => n.startBeat === 0);
  assert.deepEqual(chord.map(n => pc(n.midi)).sort((a, b) => a - b), [0, 5, 9]);
  assert.equal(pc(Math.max(...chord.map(n => n.midi))), 5);
  const h = chordsFromVoicing(notes, DEFAULT_HARMONY);
  assert.deepEqual(h.bars[0], [5, 9, 0]);
  assert.deepEqual(h.bars.slice(1), DEFAULT_HARMONY.bars.slice(1), "unhummed bars keep their chords");
});

test("strings hold legato through a breath and add a second chord tone below", () => {
  const notes = gen("strings", pitchFrames([
    { midi: 69, durationSec: 0.8 }, { midi: null, durationSec: 0.4 }, { midi: 72, durationSec: 0.8 },
  ]));
  const [first, second] = [...new Set(notes.map(n => n.startBeat))];
  const top = (b: number) => notes.filter(n => n.startBeat === b).sort((a, z) => z.midi - a.midi)[0];
  assert.equal(top(first).startBeat + top(first).durationBeats, second, "no gap between pad notes");
  assert.equal(notes.filter(n => n.startBeat === first).length, 2, "two voices");
  for (const n of notes) assert.ok(DEFAULT_HARMONY.bars[Math.floor(n.startBeat / 4)].includes(pc(n.midi)));
});

test("drums: boom is a kick, a loud bright hit a snare, a quiet one a hat", () => {
  const frames: HumFrame[] = [];
  const bins = (centre: number) => Float32Array.from({ length: 48 }, (_, k) => Math.exp(-((k - centre) ** 2) / 20));
  const hit = (rms: number, hz: number | null, centre: number) => {
    for (let i = 0; i < 4; i++) frames.push({ tSec: frames.length * 0.02, rms, hz, bins: bins(centre) });
    for (let i = 0; i < 21; i++) frames.push({ tSec: frames.length * 0.02, rms: 0.003, hz: null, bins: new Float32Array(48) });
  };
  hit(0.2, 90, 5);      // boom
  hit(0.25, null, 30);  // ka
  hit(0.06, null, 35);  // ts
  const notes = generateNotes(instrument("drums"), frames, 120, "1/16", DEFAULT_HARMONY);
  assert.deepEqual(notes.map(n => n.midi), [36, 38, 42], "no auto hats when hats were beatboxed");
  assert.deepEqual(notes.map(n => n.startBeat), [0, 1, 2]);
});

test("drums: zero-crossing rate, not loudness, tells a hat from a snare", () => {
  const frames: HumFrame[] = [];
  const hit = (rms: number, zcrHz: number) => {
    for (let i = 0; i < 4; i++) frames.push({ tSec: frames.length * 0.02, rms, hz: null, zcrHz, bins: new Float32Array(48).fill(0.5) });
    for (let i = 0; i < 21; i++) frames.push({ tSec: frames.length * 0.02, rms: 0.003, hz: null, zcrHz: 5000, bins: new Float32Array(48) });
  };
  hit(0.25, 6000); // loud "ts" is still a hat
  hit(0.06, 1500); // quiet "ka" is still a snare
  const notes = generateNotes(instrument("drums"), frames, 120, "1/16", DEFAULT_HARMONY);
  assert.deepEqual(notes.map(n => n.midi), [42, 38]);
});

test("a take sung consistently late is shifted back onto the grid", () => {
  const lateSec = 0.07;
  const onsets = [0, 0.5, 1, 1.25, 1.75].map(t => t + lateSec);
  assert.ok(Math.abs(alignmentSec(onsets, 120, 0.5) + lateSec) < 1e-9);
  assert.equal(alignmentSec(onsets.slice(0, 2), 120, 0.5), 0, "too few onsets to judge");
  assert.equal(alignmentSec(onsets, 120, 0), 0, "Off keeps raw timing");

  // ~50 ms late with jitter: notes 1 and 3 (70, 65 ms) are past half a 1/16 step (62.5 ms) and would snap a step late.
  const notes = generateNotes(instrument("melody"), pitchFrames([
    { midi: null, durationSec: 0.07 }, { midi: 60, durationSec: 0.215 }, { midi: 64, durationSec: 0.28 },
    { midi: 67, durationSec: 0.235 }, { midi: 72, durationSec: 0.25 },
  ], 0.005), 120, "1/16", DEFAULT_HARMONY);
  assert.deepEqual(notes.map(n => n.startBeat), [0, 0.5, 1, 1.5]);
});

test("rowMidi inverts noteRow: editing lands on the pitch drawn under the pointer", () => {
  for (const inst of INSTRUMENTS) {
    for (let row = 0; row < pitchRows(inst); row++) assert.equal(noteRow(rowMidi(row, inst), inst), row, `${inst.id} row ${row}`);
    assert.equal(rowMidi(-3, inst), rowMidi(0, inst)); // clamped to the lane
    assert.equal(rowMidi(999, inst), rowMidi(pitchRows(inst) - 1, inst));
  }
});
