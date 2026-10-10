import ToneMidi from "@tonejs/midi";
import { download } from "./download.ts";
import type { Track } from "./tracks";

const { Midi } = ToneMidi; // CommonJS package: Node has no named export

/** Standard MIDI bytes: one track per non-empty part, drums on channel index 9, beats -> seconds at `bpm`. */
export function midiBytes(tracks: readonly Track[], bpm: number): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const spb = 60 / bpm;
  for (const t of tracks) {
    if (!t.notes.length) continue;
    const mt = midi.addTrack();
    mt.name = t.instrument.name;
    mt.channel = t.instrument.kind === "drums" ? 9 : mt.channel;
    for (const n of [...t.notes].sort((a, b) => a.startBeat - b.startBeat))
      mt.addNote({ midi: n.midi, time: n.startBeat * spb, duration: n.durationBeats * spb, velocity: n.velocity });
  }
  return midi.toArray();
}

export function exportMidi(tracks: readonly Track[], bpm: number) {
  download(midiBytes(tracks, bpm) as BlobPart, "audio/midi", "humstudio.mid");
}
