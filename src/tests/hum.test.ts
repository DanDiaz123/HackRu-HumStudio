import assert from "node:assert/strict";
import { test } from "node:test";
import { PitchDetector } from "pitchy";
import { generateNotes } from "../lib/generate.ts";
import { type HumFrame, HOPS_PER_SEC, WINDOW_SIZE, analyzeWindow, slidingWindow, windowCenterSec } from "../lib/hum.ts";
import { DEFAULT_HARMONY } from "../lib/music/harmony.ts";
import { INSTRUMENTS } from "../lib/tracks.ts";

test("slidingWindow keeps the newest samples, oldest first", () => {
  const push = slidingWindow(4);
  push(Float32Array.of(1, 2));
  assert.deepEqual([...push(Float32Array.of(3, 4, 5))], [2, 3, 4, 5]);
});

test("a window is timed at its centre on the audio clock", () => {
  assert.equal(windowCenterSec(48000 + WINDOW_SIZE / 2, 48000), 1);
});

test("mic path: a hummed G4 with a 5 ms dropout becomes one G4", async () => {
  // Simulate what the worklet sends: 2 s of a hum-like G4 (harmonics + noise) in 20 ms hops.
  const rate = 48000;
  const hop = rate / HOPS_PER_SEC;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  const audio = new Float32Array(rate * 2).map((_, i) => {
    const t = i / rate;
    if (t >= 1 && t < 1.005) return 0; // mic dropout
    const w = 2 * Math.PI * 392 * t;
    return 0.3 * Math.sin(w) + 0.1 * Math.sin(2 * w) + 0.05 * Math.sin(3 * w) + noise();
  });

  const push = slidingWindow(WINDOW_SIZE);
  const detector = PitchDetector.forFloat32Array(WINDOW_SIZE);
  const frames: HumFrame[] = [];
  for (let end = hop; end <= audio.length; end += hop) {
    const { hz, rms } = analyzeWindow(push(audio.subarray(end - hop, end)), rate, detector);
    frames.push({ tSec: windowCenterSec(end, rate), hz, rms, bins: new Float32Array(0) });
  }

  const melody = INSTRUMENTS.find((i) => i.id === "melody")!;
  const notes = generateNotes(melody, frames.filter((f) => f.tSec >= 0), 120, "1/16", DEFAULT_HARMONY);
  assert.deepEqual(notes.map((n) => n.midi), [67]);
  assert.ok(notes[0].durationBeats >= 3.5);
});
