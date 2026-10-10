import * as MidiModule from "@tonejs/midi";
import type { Track } from "./tracks";

// Node exposes the package's UMD build as default; the browser bundler exposes named exports.
const Midi = MidiModule.Midi ?? (MidiModule as unknown as { default: typeof MidiModule }).default.Midi;

/** Encode each nonempty track in quarter-note beats, rejecting invalid data before download. */
export function createMidiBytes(tracks: readonly Track[], bpm: number): Uint8Array {
  if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180) {
    throw new RangeError("BPM must be finite and between 60 and 180.");
  }
  for (const track of tracks) {
    for (const note of track.notes) {
      if (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127
        || !Number.isFinite(note.startBeat) || note.startBeat < 0
        || !Number.isFinite(note.durationBeats) || note.durationBeats <= 0
        || !Number.isFinite(note.startBeat + note.durationBeats)
        || !Number.isFinite(note.velocity) || note.velocity < 0 || note.velocity > 1) {
        throw new RangeError("MIDI notes must have valid pitch, beat timing, and velocity.");
      }
    }
  }
  const midi = new Midi();
  midi.header.setTempo(bpm);
  let melodicChannel = 0;
  for (const t of tracks) {
    if (!t.notes.length) continue;
    const mt = midi.addTrack();
    mt.name = t.instrument.name;
    // MIDI note-offs apply to a channel, even when events live in separate file tracks.
    mt.channel = t.instrument.kind === "drums" ? 9 : melodicChannel++;
    for (const n of [...t.notes].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)) {
      const ticks = Math.round(n.startBeat * midi.header.ppq);
      const durationTicks = Math.max(1, Math.round(n.durationBeats * midi.header.ppq));
      // MIDI encodes time deltas in at most 28 bits; avoid overflow and zero-length notes.
      if (!Number.isSafeInteger(ticks + durationTicks) || ticks + durationTicks > 0x0fffffff) {
        throw new RangeError("Note timing exceeds the MIDI file range.");
      }
      mt.addNote({ midi: n.midi, ticks, durationTicks, velocity: n.velocity });
    }
  }
  return midi.toArray();
}

/** Download a local MIDI file; sound selections, mute, and solo do not remove stored notes. */
export function exportMidi(tracks: Track[], bpm: number): void {
  const bytes = createMidiBytes(tracks, bpm);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/midi" }));
  try {
    const a = Object.assign(document.createElement("a"), { href: url, download: "humstudio.mid" });
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
