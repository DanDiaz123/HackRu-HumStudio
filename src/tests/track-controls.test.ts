import assert from "node:assert/strict";
import { test } from "node:test";
import { initialTracks, normalizeSoloTracks, toggleTrackFlag } from "../lib/tracks.ts";

const solos = (tracks: ReturnType<typeof initialTracks>) => tracks.filter(track => track.solo).map(track => track.instrument.id);

test("solo switches exclusively between tracks and clicking the active solo clears it", () => {
  const original = initialTracks();
  const before = structuredClone(original);
  const bass = toggleTrackFlag(original, "bass", "solo");
  const melody = toggleTrackFlag(bass, "melody", "solo");
  const cleared = toggleTrackFlag(melody, "melody", "solo");
  assert.deepEqual(solos(bass), ["bass"]);
  assert.deepEqual(solos(melody), ["melody"]);
  assert.deepEqual(solos(cleared), []);
  assert.deepEqual(original, before);
  for (const tracks of [bass, melody, cleared])
    tracks.forEach((track, i) => assert.equal(track.notes, original[i].notes));
});

test("mute remains independent of solo, including a muted soloed track", () => {
  const soloed = toggleTrackFlag(initialTracks(), "bass", "solo");
  const muted = toggleTrackFlag(soloed, "bass", "muted");
  assert.deepEqual(solos(muted), ["bass"]);
  assert.equal(muted.find(track => track.instrument.id === "bass")?.muted, true);
  const melody = toggleTrackFlag(muted, "melody", "solo");
  assert.equal(melody.find(track => track.instrument.id === "bass")?.muted, true);
  assert.deepEqual(solos(toggleTrackFlag(melody, "keys", "muted")), ["melody"]);
  assert.deepEqual(toggleTrackFlag(melody, "unknown", "solo"), melody);
});

test("legacy multi-solo normalization uses fixed instrument order and preserves notes and mute flags", () => {
  const original = initialTracks().map(track => ({ ...track, solo: ["bass", "keys"].includes(track.instrument.id), muted: true }));
  const before = structuredClone(original);
  const normalized = normalizeSoloTracks([...original].reverse());
  assert.deepEqual(solos(normalized), ["bass"]);
  normalized.forEach(track => {
    assert.equal(track.notes, original.find(item => item.instrument.id === track.instrument.id)?.notes);
    assert.equal(track.muted, true);
  });
  assert.deepEqual(original, before);
  assert.deepEqual(normalizeSoloTracks(normalized), normalized);
});
