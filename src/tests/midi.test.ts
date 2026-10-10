import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Midi } from "@tonejs/midi/dist/Midi.js";
import { createMidiBytes, exportMidi, midiBytes } from "../lib/midi.ts";
import { download } from "../lib/download.ts";
import { playbackFixtureTracks } from "./fixtures/playback.ts";

test("MIDI preserves beat timing and tempo for every nonempty instrument", () => {
  const tracks = playbackFixtureTracks();
  tracks[0].notes = [{ ...tracks[0].notes[0], startBeat: 2, durationBeats: 1 }];
  for (const bpm of [60, 120, 180]) {
    const midi = new Midi(createMidiBytes(tracks, bpm));
    assert.equal(midi.tracks.length, 5);
    assert.ok(Math.abs(midi.header.tempos[0].bpm - bpm) < 0.001);
    const melody = midi.tracks.find(track => track.name === "Melody")!;
    assert.equal(melody.notes[0].midi, 60);
    assert.ok(Math.abs(melody.notes[0].time - 2 * 60 / bpm) < 0.001);
    assert.ok(Math.abs(melody.notes[0].duration - 60 / bpm) < 0.001);
    assert.ok(Math.abs(melody.notes[0].velocity - tracks[0].notes[0].velocity) <= 1 / 127);
  }
});

test("MIDI channels isolate pitched tracks while reserving channel 10 for drums", () => {
  const tracks = playbackFixtureTracks();
  tracks.forEach(track => {
    if (track.instrument.kind !== "drums") track.notes = [{ ...tracks[0].notes[0], midi: 60 }];
  });
  const midi = new Midi(createMidiBytes(tracks, 120));
  const pitched = midi.tracks.filter(track => track.name !== "Drums");
  assert.equal(new Set(pitched.map(track => track.channel)).size, 4);
  assert.ok(pitched.every(track => track.channel !== 9));
  assert.equal(midi.tracks.find(track => track.name === "Drums")!.channel, 9);
});

test("MIDI encoding sorts a copy and exports stored muted/solo notes independently of sounds", () => {
  const tracks = playbackFixtureTracks();
  tracks[0].notes.reverse();
  tracks[0].muted = true;
  tracks[1].solo = true;
  const before = structuredClone(tracks);
  const bytes = createMidiBytes(tracks, 120);
  const midi = new Midi(bytes);
  assert.equal(midi.tracks.length, 5);
  assert.deepEqual(midi.tracks[0].notes.map(note => note.ticks), [0, 1920, 3840, 5760]);
  assert.deepEqual(tracks, before);
  tracks[0].presetId = "melody.marimba";
  assert.deepEqual(createMidiBytes(tracks, 120), bytes);
});

test("empty MIDI export is valid and sub-tick note durations stay positive", () => {
  assert.equal(new Midi(createMidiBytes([], 120)).tracks.length, 0);
  const tracks = playbackFixtureTracks();
  tracks[0].notes = [{ ...tracks[0].notes[0], durationBeats: 0.0001 }];
  const midi = new Midi(createMidiBytes([tracks[0]], 120));
  assert.equal(midi.tracks[0].notes[0].durationTicks, 1);
});

test("MIDI rejects invalid BPM and note data instead of producing corrupt bytes", () => {
  const tracks = playbackFixtureTracks();
  for (const bpm of [NaN, Infinity, 0, 59, 181]) assert.throws(() => createMidiBytes(tracks, bpm), RangeError);
  const badNotes = [
    { midi: NaN }, { midi: 60.5 }, { midi: -1 }, { midi: 128 },
    { startBeat: -1 }, { startBeat: NaN }, { startBeat: Infinity }, { startBeat: 1e308 },
    { durationBeats: 0 }, { durationBeats: -1 }, { durationBeats: Infinity }, { durationBeats: 1e308 },
    { velocity: -0.1 }, { velocity: 1.1 }, { velocity: NaN }, { velocity: Infinity },
  ];
  for (const changes of badNotes) {
    const invalid = [{ ...tracks[0], notes: [{ ...tracks[0].notes[0], ...changes }] }];
    assert.throws(() => createMidiBytes(invalid, 120), RangeError);
  }
});

function mockDownload(t: TestContext, failure?: "create" | "click") {
  const state = { blobs: [] as Blob[], revoked: [] as string[], delays: [] as number[], clicks: 0 };
  const element = {
    href: "", download: "",
    click() {
      state.clicks++;
      if (failure === "click") throw new Error("Download click failed.");
    },
  };
  t.mock.method(URL, "createObjectURL", (blob: Blob) => {
    state.blobs.push(blob);
    return "blob:humstudio-test";
  });
  t.mock.method(URL, "revokeObjectURL", (url: string) => { state.revoked.push(url); });
  t.mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => {
    state.delays.push(delay);
    callback();
    return 0;
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(tag: string) {
        assert.equal(tag, "a");
        if (failure === "create") throw new Error("Anchor creation failed.");
        return element;
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  });
  return { state, element };
}

test("MIDI download supplies valid bytes and schedules URL cleanup after clicking", async (t) => {
  const { state, element } = mockDownload(t);
  exportMidi(playbackFixtureTracks(), 120);
  assert.equal(state.clicks, 1);
  assert.equal(element.href, "blob:humstudio-test");
  assert.equal(element.download, "humstudio.mid");
  assert.equal(state.blobs[0].type, "audio/midi");
  const midi = new Midi(new Uint8Array(await state.blobs[0].arrayBuffer()));
  assert.equal(midi.tracks.length, 5);
  assert.deepEqual(state.delays, [1000]);
  assert.deepEqual(state.revoked, ["blob:humstudio-test"]);
});

test("MIDI download revokes its URL when the click fails", (t) => {
  const { state } = mockDownload(t, "click");
  assert.throws(() => exportMidi(playbackFixtureTracks(), 120), /Download click failed/);
  assert.equal(state.clicks, 1);
  assert.deepEqual(state.delays, [1000]);
  assert.deepEqual(state.revoked, ["blob:humstudio-test"]);
});

test("MIDI download revokes its URL when anchor creation fails", (t) => {
  const { state } = mockDownload(t, "create");
  assert.throws(() => exportMidi(playbackFixtureTracks(), 120), /Anchor creation failed/);
  assert.equal(state.clicks, 0);
  assert.deepEqual(state.delays, [1000]);
  assert.deepEqual(state.revoked, ["blob:humstudio-test"]);
});

test("both MIDI encoder names preserve isolated channels and reject invalid inputs", () => {
  const tracks = playbackFixtureTracks();
  assert.equal(midiBytes, createMidiBytes);
  assert.deepEqual(midiBytes(tracks, 120), createMidiBytes(tracks, 120));
  for (const encode of [midiBytes, createMidiBytes]) {
    assert.throws(() => encode(tracks, 0), RangeError);
    assert.throws(() => encode([{ ...tracks[0], notes: [{ ...tracks[0].notes[0], durationBeats: -1 }] }], 120), RangeError);
    const midi = new Midi(encode(tracks, 120));
    assert.equal(new Set(midi.tracks.map(track => track.channel)).size, 5);
  }
});

test("shared file download preserves project content and revokes URLs on either DOM failure", async (t) => {
  for (const failure of [undefined, "create", "click"] as const) {
    await t.test(failure ?? "successful download", async (subtest) => {
      const { state, element } = mockDownload(subtest, failure);
      const content = '{"schemaVersion":2}';
      if (failure) assert.throws(() => download(content, "application/json", "idea.humstudio.json"), /failed/);
      else {
        download(content, "application/json", "idea.humstudio.json");
        assert.equal(element.download, "idea.humstudio.json");
        assert.equal(element.href, "blob:humstudio-test");
        assert.equal(state.clicks, 1);
      }
      assert.equal(state.blobs[0].type, "application/json");
      assert.equal(await state.blobs[0].text(), content);
      assert.deepEqual(state.delays, [1000]);
      assert.deepEqual(state.revoked, ["blob:humstudio-test"]);
    });
  }
});
