import { initialTracks, type Track } from "../../lib/tracks";

/** Deterministic five-instrument arrangement for playback tests and integration handoff. */
export function playbackFixtureTracks(): Track[] {
  const tracks = initialTracks();
  const phrases: Record<string, number[]> = {
    melody: [60, 64, 67, 72],
    bass: [33, 29, 36, 31],
    strings: [57, 53, 60, 55],
  };
  return tracks.map((track) => {
    const pitches = phrases[track.instrument.id];
    if (!pitches) return track;
    return {
      ...track,
      sample: true,
      notes: pitches.map((midi, index) => ({
        id: `playback-${track.instrument.id}-${index}`,
        midi,
        startBeat: index * 4,
        durationBeats: track.instrument.id === "melody" ? 1 : 3.5,
        velocity: 0.65,
      })),
    };
  });
}
