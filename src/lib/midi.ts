import { Midi } from "@tonejs/midi";
import type { Track } from "./tracks";

export function exportMidi(tracks: Track[], bpm: number) {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const spb = 60 / bpm;
  for (const t of tracks) {
    if (!t.notes.length) continue;
    const mt = midi.addTrack();
    mt.name = t.instrument.name;
    mt.channel = t.instrument.kind === "drums" ? 9 : mt.channel;
    for (const n of t.notes)
      mt.addNote({ midi: n.midi, time: n.startBeat * spb, duration: n.durationBeats * spb, velocity: n.velocity });
  }
  const url = URL.createObjectURL(new Blob([midi.toArray() as BlobPart], { type: "audio/midi" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "humstudio.mid" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
