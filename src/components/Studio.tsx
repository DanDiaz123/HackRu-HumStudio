"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type GenTrace, detectTrackProfiles, renderTrackProfiles } from "@/lib/generate";
import { DRUM_ONSET_PRESETS, type NoteSensitivity } from "@/lib/audio/note-sensitivity";
import { type HumFrame, micErrorMessage, startDemoHum, startMic } from "@/lib/hum";
import { download } from "@/lib/download";
import { exportMidi } from "@/lib/midi";
import { pasteCopiedNotes, type NoteClipboard } from "@/lib/note-clipboard";
import { deleteNoteById, repeatFirstHalf, replaceDrumPartNotes } from "@/lib/note-edit";
import { type LoadedProject, MAX_PROJECT_BYTES, MAX_PROJECT_NOTES, STORAGE_KEY, readAutosave, newProjectMeta, parseProject, serializeProject } from "@/lib/persistence/project";
import {
  DEFAULT_HARMONY,
  type Key,
  KEYS,
  chordName,
  chordsFromVoicing,
  harmonyLabel,
  inferHarmony,
  keyName,
  solfege,
} from "@/lib/music/harmony";
import { applyNoteSettings, captureArrangementSnapshot, projectArrangementSnapshot, type ArrangementSnapshot as Snapshot, type RecordedTakes, type SnapSources } from "@/lib/music/arrangement-settings";
import * as playback from "@/lib/playback";
import type { PlaybackEngine } from "@/lib/audio/playback-engine";
import { presetForTrack } from "@/lib/audio/instrument-presets";
import type { PresetStatus } from "@/lib/audio/preset-manager";
import {
  MAX_RECORD_SEC,
  type Note,
  type QuantizeDivision,
  TOTAL_BEATS,
  type Track,
  beatX,
  initialTracks,
  normalizeSoloTracks,
  toggleTrackFlag,
  midiName,
  noteId,
  drumPart,
  type DrumPart,
} from "@/lib/tracks";
import { DownloadIcon, OpenIcon, PauseIcon, PlayIcon, RedoIcon, RewindIcon, SaveIcon, StopIcon, UndoIcon } from "./icons";
import TrackRow, { type Phase, REVEAL_SEC, type Reveal } from "./TrackRow";

const COLLAPSED_H = 36;
const MAX_UNDO = 100;

/** Keys that work anywhere except while typing in a field. */
const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["R", "Record or stop (open track)"],
  ["1 – 5", "Open a track"],
  ["Esc", "Cancel copy / back to all tracks"],
  ["Ctrl C", "Select a region, then drag copies to paste"],
  ["Ctrl V", "Paste copied region at the playhead"],
  ["M / S", "Mute / solo the open track"],
  ["K", "Metronome"],
  ["L", "Learn"],
  ["Ctrl Z / Ctrl Shift Z", "Undo / redo"],
  ["Ctrl S", "Save project"],
  ["?", "This list"],
];

/** Cancel reveal timers promptly when a take or the page goes away. */
function revealDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

function readout(beat: number) {
  const bar = Math.floor(beat / 4) + 1;
  const b = Math.floor(beat % 4) + 1;
  const s = Math.floor((beat % 1) * 4) + 1;
  return `${bar}.${b}.${s}`;
}

export default function Studio() {
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [harmony, setHarmony] = useState(DEFAULT_HARMONY);
  const [learn, setLearn] = useState(true);
  const [bpm, setBpm] = useState(120);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [profileTracks, setProfileTracks] = useState<string[]>([]);
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [frames, setFrames] = useState<HumFrame[]>([]);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [demo, setDemo] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [startingAudio, setStartingAudio] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [presetStatuses, setPresetStatuses] = useState<Record<string, PresetStatus>>({});
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const [avail, setAvail] = useState(0);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [fileError, setFileError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [restored, setRestored] = useState(false);
  const [help, setHelp] = useState(false);
  const [openingProject, setOpeningProject] = useState(false);

  const rowsRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<HTMLOutputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  // Re-record clears the part up front; a failed take puts it back (never lose a part to an empty take).
  const clearedRef = useRef<{ id: string; notes: Note[] } | null>(null);
  // Musical detections and profile caches support regeneration without persisting capture frames.
  const takesRef = useRef<RecordedTakes>({});
  const snapSourcesRef = useRef<SnapSources>({});
  const harmonyDriverRef = useRef<"melody" | "keys" | null>(null);
  // A key the user picked by hand; regeneration keeps it until the next Melody take sets a new one.
  const pickedKeyRef = useRef<Key | null>(null);
  const playbackRequest = useRef(0);
  const arrangementRef = useRef({ tracks, bpm });
  const stopTake = useRef<() => void>(() => {});
  const unsubscribePresets = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);
  const takeControllerRef = useRef<AbortController | null>(null);
  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  // The state before the take in progress, so a whole take is one undo step.
  const takeUndoRef = useRef<Snapshot | null>(null);
  const metaRef = useRef(newProjectMeta());
  const fileRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const projectRequestRef = useRef(0);

  const busy = openingProject || startingAudio || phase === "requesting" || phase === "recording" || phase === "generating" || phase === "revealing";
  const zoomed = tracks.find((t) => t.instrument.id === zoomedId) ?? null;
  const soundSelections = tracks.map(track => track.presetId).join("\n");

  /** Keep event/async snapshots current immediately, including a failed take restored before the next effect. */
  const commitTracks = useCallback((next: Track[]) => {
    const normalized = normalizeSoloTracks(next);
    arrangementRef.current = { ...arrangementRef.current, tracks: normalized };
    setTracks(normalized);
    setProfileTracks(Object.keys(takesRef.current));
  }, []);
  const pushHistory = useCallback((s: Snapshot) => {
    const h = historyRef.current;
    h.past = [...h.past, s].slice(-MAX_UNDO);
    h.future = [];
    setHistory({ undo: h.past.length, redo: 0 });
  }, []);

  useLayoutEffect(() => {
    const el = rowsRef.current!;
    const ro = new ResizeObserver(() => setAvail(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the transport in sync with notes, mutes and tempo.
  useEffect(() => {
    arrangementRef.current = { tracks, bpm };
    const engine = playback.getEngine();
    engine?.schedule(tracks, bpm);
  }, [tracks, bpm]);

  const setPos = (beat: number) => {
    if (headRef.current) headRef.current.style.left = `${beatX(beat)}%`;
    if (posRef.current) posRef.current.textContent = readout(beat);
    // Light the chord under the playhead in the zoomed lane (Learn); DOM only, like the playhead.
    const bar = Math.floor(beat / 4);
    document.querySelectorAll(".lane-chords li").forEach((li, i) => li.classList.toggle("now", i === bar));
  };

  // Playhead + position readout run outside React.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const engine = playback.getEngine();
      setPos(engine?.positionBeats() ?? 0);
      if (engine?.state() !== "started") {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Cancel pending starts and release browser audio resources when the page goes away.
  useEffect(() => {
    mountedRef.current = true;
    const requests = playbackRequest;
    const projectRequests = projectRequestRef;
    return () => {
      mountedRef.current = false;
      takeControllerRef.current?.abort();
      projectRequests.current++;
      stopRef.current?.();
      requests.current++;
      unsubscribePresets.current?.();
      unsubscribePresets.current = null;
      playback.dispose();
    };
  }, []);

  function pauseIfPlaying() {
    const live = playback.getEngine();
    if (live?.state() !== "started") return false;
    live.pause();
    setPos(live.positionBeats());
    setPlaying(false);
    return true;
  }

  /** Share loading feedback between automatic preloads and user-gesture audio startup. */
  const subscribeToPresets = useCallback((engine: PlaybackEngine) => {
    unsubscribePresets.current ??= engine.subscribePresets(status => {
      if (arrangementRef.current.tracks.find(track => track.instrument.id === status.trackId)?.presetId !== status.presetId) return;
      setPresetStatuses(previous => ({ ...previous, [status.trackId]: status }));
    });
  }, []);

  // Wait for storage restoration; Open/undo preload changed sounds even on empty/muted tracks.
  useEffect(() => {
    if (!restored) return;
    let cancelled = false;
    void playback.initializeAudio().then(engine => {
      if (cancelled || !mountedRef.current) return;
      subscribeToPresets(engine);
      return engine.prepare(arrangementRef.current.tracks);
    }).catch(() => {
      if (cancelled || !mountedRef.current) return;
      setPresetStatuses(Object.fromEntries(arrangementRef.current.tracks.map(track => [track.instrument.id, {
        trackId: track.instrument.id, presetId: track.presetId, state: "fallback",
        message: "Sounds could not load. Check your output device and retry this sound.",
      }])));
    });
    return () => { cancelled = true; };
  }, [restored, soundSelections, subscribeToPresets]);

  async function connectAudio() {
    const engine = await playback.ensureAudio();
    if (!mountedRef.current) throw new Error("page closed");
    subscribeToPresets(engine);
    return engine;
  }

  /** Change only playback timbre; retain the category, note array, and all note IDs. */
  async function changePreset(trackId: string, presetId: string) {
    const preset = presetForTrack(trackId, presetId);
    const current = arrangementRef.current;
    if (current.tracks.find(track => track.instrument.id === trackId)?.presetId !== preset.id) remember();
    const next = current.tracks.map(track => track.instrument.id === trackId ? { ...track, presetId: preset.id } : track);
    arrangementRef.current = { ...current, tracks: next };
    setTracks(next);
    setPresetStatuses(previous => ({ ...previous, [trackId]: { trackId, presetId, state: "loading" } }));
    try {
      const engine = await connectAudio();
      const latest = arrangementRef.current;
      const track = latest.tracks.find(t => t.instrument.id === trackId)!;
      if (track.presetId !== preset.id) return;
      engine.schedule(latest.tracks, latest.bpm);
      await engine.prepare([track], true);
    } catch {
      if (!mountedRef.current || arrangementRef.current.tracks.find(t => t.instrument.id === trackId)?.presetId !== preset.id) return;
      setPresetStatuses(previous => ({ ...previous, [trackId]: { trackId, presetId, state: "fallback",
        message: "Audio could not start. Check your output device and retry this sound." } }));
    }
  }

  /** Put the arrangement and metronome setting back after a click-only recording. */
  function restoreTransport() {
    if (!mountedRef.current) return;
    const engine = playback.getEngine();
    if (!engine) return;
    engine.stop();
    engine.setMetronome(metronome);
    engine.schedule(arrangementRef.current.tracks, arrangementRef.current.bpm);
    setPos(0);
  }

  async function togglePlay() {
    if (pauseIfPlaying()) return;
    if (startingAudio) return;
    const request = ++playbackRequest.current;
    setStartingAudio(true);
    setPlaybackError("");
    try {
      const engine = await connectAudio();
      if (request !== playbackRequest.current) return;
      const current = arrangementRef.current;
      engine.schedule(current.tracks, current.bpm);
      const solo = current.tracks.some(track => track.solo);
      await engine.prepare(current.tracks.filter(track => track.notes.length && !track.muted && (!solo || track.solo)));
      if (request !== playbackRequest.current) return;
      const latest = arrangementRef.current;
      engine.schedule(latest.tracks, latest.bpm);
      engine.setMetronome(metronome);
      if (countIn) {
        const completed = await engine.countIn(latest.bpm, setCountInBeat);
        if (!completed || request !== playbackRequest.current) return;
      }
      setCountInBeat(null);
      engine.play();
      setPlaying(engine.state() === "started");
    } catch {
      if (request !== playbackRequest.current) return;
      playback.getEngine()?.stop();
      setPlaying(false);
      setPlaybackError("Audio could not start. Check your output device and try Play again.");
    } finally {
      if (request === playbackRequest.current) {
        setStartingAudio(false);
        setCountInBeat(null);
      }
    }
  }

  function stopPlayback() {
    playbackRequest.current++;
    setStartingAudio(false);
    setCountInBeat(null);
    playback.getEngine()?.stop();
    setPlaying(false);
    setPos(0);
  }

  function rewind() {
    playback.getEngine()?.rewind();
    setPos(0);
  }

  const open = useCallback(
    (id: string) => {
      if (busy) return;
      setZoomedId(id);
      setPhase("idle");
      setFrames([]);
      setError("");
    },
    [busy],
  );

  const back = useCallback(() => {
    if (busy) return;
    setZoomedId(null);
    setPhase("idle");
    setFrames([]);
  }, [busy]);

  // One window listener; it always calls the latest handler (shortcuts read current state).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const restoreCleared = useCallback(() => {
    const c = clearedRef.current;
    clearedRef.current = null;
    takeUndoRef.current = null;
    if (c) commitTracks(arrangementRef.current.tracks.map((t) => (t.instrument.id === c.id ? { ...t, notes: c.notes } : t)));
  }, [commitTracks]);

  const finish = useCallback(async (taken: HumFrame[], signal: AbortSignal) => {
      if (signal.aborted || !mountedRef.current) return;
      stopRef.current?.();
      stopRef.current = null;
      if (!zoomed) return;
      // Beatbox hits are mostly unvoiced, so drums count loud frames instead of pitched ones.
      const { quantize, sensitivity } = zoomed;
      const heard = zoomed.instrument.kind === "drums" ? (f: HumFrame) => f.rms > DRUM_ONSET_PRESETS[sensitivity].minRms : (f: HumFrame) => f.hz !== null;
      if (taken.filter(heard).length < 10) {
        restoreCleared();
        setPhase("error");
        setError("We didn't catch a hum. Get closer to the mic and try again.");
        return;
      }
      if (process.env.NODE_ENV === "development") {
        // Dev only: `copy(__humTake)` in the console saves this take for src/tests/takes (analysis frames, no audio).
        const frames = taken.map((f) => ({ ...f, bins: Array.from(f.bins) }));
        Object.assign(window, { __humTake: { instrument: zoomed.instrument.id, bpm, quantize, harmony, frames } });
      }
      setPhase("generating");
      try {
        const inst = zoomed.instrument;
        const trace = {} as GenTrace;
        const selectedDrumPart = inst.kind === "drums" ? drumPart(zoomed.drumPart).id : undefined;
        const sources = detectTrackProfiles(inst, taken, bpm, selectedDrumPart);
        const variants = renderTrackProfiles(inst, sources, bpm, quantize, harmony, sensitivity, trace, selectedDrumPart);
        trace.voicedFrames = taken.filter(frame => frame.hz !== null && Number.isFinite(frame.hz) && frame.hz >= 80 && frame.hz <= 1000 && frame.rms >= 0.01).length;
        if (!variants[sensitivity].length) throw new Error("empty");
        let notes = variants[sensitivity];
        if (selectedDrumPart) {
          const selectedMidi = drumPart(selectedDrumPart).midi;
          const existing = arrangementRef.current.tracks.find(track => track.instrument.id === inst.id)?.notes ?? [];
          const otherParts = existing.filter(note => note.midi !== selectedMidi);
          notes = [...otherParts, ...notes].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi || a.id.localeCompare(b.id));
        }
        if (!notes.length) throw new Error("empty");
        // A Melody take sets the key and chords, a Keys take re-picks the chords; other pitched parts
        // are re-fitted (moved, never deleted).
        const h = inst.id === "melody" ? inferHarmony(notes) : inst.id === "keys" ? chordsFromVoicing(notes, harmony) : null;
        const after = h ?? harmony;
        // Every step shows what the pipeline actually produced; nothing here is a progress estimate.
        const drums = inst.kind === "drums";
        // Every Melody profile keeps its confirmed semitones; sensitivity changes detection, not scale correction.
        const keptPitch = inst.id === "melody";
        const fitted = keptPitch ? "pitches kept as hummed" : `fitted to ${keyName(after)}`;
        const noun = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
        const steps = [
          drums
            ? { title: noun(trace.raw.length, "hit"), sub: "Heard in your beatbox" }
            : { title: noun(trace.raw.length, "note"), sub: `Found in ${trace.voicedFrames} pitched frames of your hum` },
          {
            title: trace.grid ? "On the beat" : drums || keptPitch ? "As hummed" : "In key",
            sub: trace.grid ? `Snapped to the ${quantize} grid` + (drums ? "" : `, ${fitted}`) : drums ? "Timing kept as hummed" : `${fitted[0].toUpperCase()}${fitted.slice(1)}, timing kept`,
          },
          ...(drums ? [] : [{ title: keyName(after), sub: after.bars.map(chordName).join(" ") }]),
        ];
        const stepMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1100;
        setReveal({ step: 0, raw: trace.raw, final: notes, harmony: after, steps });
        setPhase("revealing");
        for (let i = 1; i <= steps.length; i++) {
          await revealDelay(i === 1 && stepMs ? (REVEAL_SEC + 0.3) * 1000 : stepMs, signal); // step 0 lasts as long as the print-in sweep
          if (signal.aborted || !mountedRef.current) return;
          setReveal((r) => r && { ...r, step: i });
        }
        const pickedKey = inst.id === "melody" ? null : pickedKeyRef.current;
        const driver = inst.id === "melody" || inst.id === "keys" ? inst.id : harmonyDriverRef.current;
        const takes = { ...takesRef.current, [inst.id]: { sources, bpm, variants,
          ...(selectedDrumPart ? { drumPart: selectedDrumPart } : {}) } };
        const snapSources = { ...snapSourcesRef.current };
        if (selectedDrumPart) {
          const selectedMidi = drumPart(selectedDrumPart).midi;
          const oldTake = takesRef.current[inst.id];
          let source = snapSources[inst.id] ?? arrangementRef.current.tracks.find(track => track.instrument.id === inst.id)!.notes;
          if (oldTake?.drumPart && oldTake.drumPart !== selectedDrumPart) {
            const oldMidi = drumPart(oldTake.drumPart).midi;
            const unsnapped = renderTrackProfiles(inst, oldTake.sources, oldTake.bpm, "off", harmony, sensitivity, undefined, oldTake.drumPart)[sensitivity];
            if (unsnapped.length) source = [...source.filter(note => note.midi !== oldMidi), ...unsnapped];
          }
          snapSources[inst.id] = source.filter(note => note.midi !== selectedMidi);
        } else delete snapSources[inst.id];
        const next = applyNoteSettings({ tracks: arrangementRef.current.tracks, harmony, takes, snapSources,
          trackId: inst.id, harmonyDriver: driver, keyOverride: pickedKey });
        if (takeUndoRef.current) pushHistory(takeUndoRef.current);
        takeUndoRef.current = null;
        pickedKeyRef.current = pickedKey;
        harmonyDriverRef.current = driver;
        takesRef.current = next.takes;
        snapSourcesRef.current = next.snapSources;
        clearedRef.current = null;
        setHarmony(next.harmony);
        commitTracks(next.tracks);
        setReveal(null);
        setPhase("done");
      } catch (cause) {
        if (signal.aborted || !mountedRef.current) return;
        restoreCleared();
        setReveal(null);
        setPhase("error"); // the cleared part comes back
        setError(cause instanceof RangeError ? cause.message : "No notes came out of that take. Try a longer, steadier hum.");
      }
  }, [zoomed, bpm, harmony, commitTracks, restoreCleared, pushHistory]);

  async function record(useDemo: boolean) {
    if (!zoomed || busy) return;
    if (!zoomed.sample && zoomed.notes.length &&
      !window.confirm(`Record over your ${zoomed.instrument.name} part? Undo (Ctrl+Z) brings it back.`)) return;
    takeUndoRef.current = snapshot();
    takeControllerRef.current?.abort();
    const controller = new AbortController();
    takeControllerRef.current = controller;
    const signal = controller.signal;
    pauseIfPlaying();
    clearedRef.current = null;
    if (zoomed.notes.length && (zoomed.instrument.kind === "drums" || !zoomed.sample)) {
      clearedRef.current = { id: zoomed.instrument.id, notes: zoomed.notes };
      const selectedMidi = zoomed.instrument.kind === "drums" ? drumPart(zoomed.drumPart).midi : null;
      commitTracks(arrangementRef.current.tracks.map((t) => (t.instrument.id === zoomed.instrument.id
        ? { ...t, notes: selectedMidi === null ? [] : t.notes.filter(note => note.midi !== selectedMidi) }
        : t)));
    }
    const taken: HumFrame[] = [];
    setFrames(taken);
    setDemo(useDemo);
    setError("");
    const limitSec = Math.min(MAX_RECORD_SEC, (TOTAL_BEATS * 60) / bpm);
    let done = false;
    // Mic frames carry audio-clock time; t=0 is the first click after the count-in, as the singer hears it.
    // Frames before it (the count-in) are dropped.
    let originSec: number | null = useDemo ? 0 : null;
    const onFrame = (raw: HumFrame) => {
      if (done || signal.aborted || originSec === null || raw.tSec < originSec) return;
      const f = originSec ? { ...raw, tSec: raw.tSec - originSec } : raw;
      // Canvas/readouts observe this runtime analysis stream without React rerenders; canonical Note[] stays immutable.
      // eslint-disable-next-line react-hooks/immutability
      taken.push(f);
      if (f.tSec >= limitSec) {
        done = true;
        void finish(taken, signal);
      }
    };
    stopRef.current = () => {
      done = true;
    };
    try {
      if (useDemo) {
        const stopDemo = startDemoHum(onFrame);
        stopRef.current = () => { done = true; stopDemo(); };
      } else {
        setPhase("requesting");
        // Audio first: the mic runs on Tone's context, so its frames share the click's clock.
        const engine = await connectAudio();
        if (signal.aborted) return;
        const mic = await playback.micContext();
        if (signal.aborted) return;
        const stopMic = await startMic(mic, onFrame);
        if (signal.aborted) { stopMic(); return; }
        stopRef.current = () => {
          done = true;
          stopMic();
          restoreTransport();
        };
        // Count in, then keep the click going so the hum lands on the beat grid. No backing tracks: the mic would hear them.
        engine.schedule([], bpm);
        engine.setMetronome(true);
        const counted = await engine.countIn(bpm, setCountInBeat);
        if (signal.aborted) return;
        setCountInBeat(null);
        if (!counted || done) throw new Error("count-in cancelled");
        originSec = engine.nowSec() + mic.outputLatencySec;
        engine.play();
      }
      setPhase("recording");
    } catch (e) {
      if (signal.aborted || !mountedRef.current) return;
      stopRef.current?.();
      stopRef.current = null;
      restoreCleared();
      setPhase("error");
      setError(e instanceof Error && e.message === "count-in cancelled" ? "Recording was cancelled." : micErrorMessage(e));
    }
    // Stop button finishes with the live array.
    stopTake.current = () => {
      if (done) return; // a double-click or the time limit already finished this take
      done = true;
      void finish(taken, signal);
    };
  }

  /** A wrong key guess is one pick away: chords re-picked from the melody, every pitched part refitted. */
  function changeKey(value: string) {
    const key = KEYS.find(option => `${option.tonic} ${option.mode}` === value);
    if (!key) return;
    const before = snapshot();
    const previousKey = pickedKeyRef.current;
    pickedKeyRef.current = key;
    if (regenerate(undefined, undefined, undefined, true, false)) pushHistory(before);
    else pickedKeyRef.current = previousKey;
  }

  /** A hand edit replaces the part's notes; an edited Sample is the user's part from then on. */
  function editNotes(id: string, notes: Note[], selectedPart?: DrumPart) {
    if (busy) return;
    const track = arrangementRef.current.tracks.find(t => t.instrument.id === id);
    if (selectedPart && track?.instrument.kind === "drums") {
      notes = replaceDrumPartNotes(track.notes, selectedPart, notes);
    }
    const total = notes.length + arrangementRef.current.tracks.reduce((count, track) => count + (track.instrument.id === id ? 0 : track.notes.length), 0);
    if (total > MAX_PROJECT_NOTES) { setFileError(`This project can hold at most ${MAX_PROJECT_NOTES.toLocaleString()} notes. Remove notes before adding or repeating a part.`); return; }
    remember();
    delete takesRef.current[id];
    snapSourcesRef.current[id] = notes.map(note => ({ ...note }));
    commitTracks(arrangementRef.current.tracks.map((t) => (t.instrument.id === id ? { ...t, notes, sample: false } : t)));
  }

  /** Insert all copied drum/pitched rows in one history step; never use selected-lane replacement. */
  function pasteNotes(id: string, clipboard: NoteClipboard, anchorBeat: number): string | null {
    if (busy) return "Finish the current operation before pasting.";
    const current = arrangementRef.current.tracks;
    const track = current.find(t => t.instrument.id === id);
    if (!track) return "Open the source instrument to paste.";
    try {
      const notes = pasteCopiedNotes(track, clipboard, anchorBeat,
        current.reduce((count, t) => count + t.notes.length, 0), current.flatMap(t => t.notes.map(note => note.id)));
      editNotes(id, notes);
      return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "The copied group could not be pasted."; }
  }

  /** Deletion spans visible drum lanes, so it bypasses the selected-part replacement contract. */
  function deleteNote(id: string, noteId: string) {
    if (busy) return;
    const track = arrangementRef.current.tracks.find(t => t.instrument.id === id);
    if (!track?.notes.some(note => note.id === noteId)) return;
    editNotes(id, deleteNoteById(track.notes, noteId));
  }

  function toggle(id: string, key: "muted" | "solo") {
    if (busy) return;
    remember();
    commitTracks(toggleTrackFlag(arrangementRef.current.tracks, id, key));
  }

  // Undo / redo
  const snapshot = (): Snapshot => captureArrangementSnapshot({ tracks: arrangementRef.current.tracks, harmony,
    bpm: arrangementRef.current.bpm, meta: metaRef.current,
    takes: takesRef.current, snapSources: snapSourcesRef.current, pickedKey: pickedKeyRef.current,
    harmonyDriver: harmonyDriverRef.current });
  /** Call before any change worth undoing (edits, takes, key, regeneration, clear/repeat, open). */
  const remember = () => pushHistory(snapshot());
  function restore(s: Snapshot) {
    stopPlayback();
    takeControllerRef.current?.abort();
    stopRef.current?.();
    stopRef.current = null;
    clearedRef.current = null;
    takeUndoRef.current = null;
    metaRef.current = { ...s.meta };
    arrangementRef.current = { tracks: s.tracks, bpm: s.bpm };
    setHarmony(s.harmony);
    setBpm(s.bpm);
    setEditorEpoch(epoch => epoch + 1);
    takesRef.current = { ...s.takes };
    snapSourcesRef.current = { ...s.snapSources };
    pickedKeyRef.current = s.pickedKey;
    harmonyDriverRef.current = s.harmonyDriver;
    commitTracks(s.tracks);
    setFrames([]);
    setReveal(null);
    setError("");
    setPhase("idle");
  }
  function step(from: "past" | "future") {
    const h = historyRef.current;
    const s = h[from].at(-1);
    if (!s || busy) return;
    h[from] = h[from].slice(0, -1);
    const to = from === "past" ? "future" : "past";
    h[to] = [...h[to], snapshot()];
    restore(s);
    setHistory({ undo: h.past.length, redo: h.future.length });
  }

  function clearPart(id: string, selectedPart?: DrumPart) {
    remember();
    delete takesRef.current[id];
    delete snapSourcesRef.current[id];
    commitTracks(arrangementRef.current.tracks.map((t) => {
      if (t.instrument.id !== id) return t;
      const midi = selectedPart && t.instrument.kind === "drums" ? drumPart(selectedPart).midi : null;
      return { ...t, notes: midi === null ? [] : t.notes.filter(note => note.midi !== midi), sample: false };
    }));
  }
  function repeatPart(id: string, selectedPart?: DrumPart) {
    const t = tracks.find((x) => x.instrument.id === id);
    if (t) {
      const source = selectedPart && t.instrument.kind === "drums"
        ? t.notes.filter(note => note.midi === drumPart(selectedPart).midi)
        : t.notes;
      editNotes(id, repeatFirstHalf(source, noteId), selectedPart);
    }
  }

  function changeDrumPart(id: string, selectedPart: DrumPart) {
    const current = arrangementRef.current.tracks.find(track => track.instrument.id === id);
    if (!current || current.instrument.kind !== "drums" || current.drumPart === selectedPart) return;
    remember();
    commitTracks(arrangementRef.current.tracks.map(track => track.instrument.id === id ? { ...track, drumPart: selectedPart } : track));
  }

  // Project files: autosave to this browser, Save/Open as .humstudio.json
  const current = (): LoadedProject => ({ meta: metaRef.current, bpm, harmony, tracks,
    regeneration: { takes: takesRef.current, snapSources: snapSourcesRef.current,
      pickedKey: pickedKeyRef.current, harmonyDriver: harmonyDriverRef.current } });
  function applyProject(p: LoadedProject) {
    restore(projectArrangementSnapshot(p));
    setZoomedId(null);
    setPlaybackError("");
  }
  // Restore the autosave once, after mount (localStorage is browser-only). A bad save is ignored, not loaded.
  useEffect(() => {
    try {
      const saved = readAutosave(localStorage);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
      if (saved) applyProject(saved);
    } catch {}
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);
  // Debounced autosave. Skipped mid-take: the part being re-recorded is temporarily empty.
  useEffect(() => {
    if (!restored || busy) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeProject(current()));
        setStorageError("");
      } catch {
        setStorageError("Autosave isn't available in this browser. Use Save to keep your project.");
      }
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- current() reads exactly these
  }, [restored, busy, tracks, harmony, bpm]);

  function saveProject() {
    try {
      download(serializeProject(current()), "application/json", "humstudio-project.humstudio.json");
      setFileError("");
    } catch (cause) { setFileError(cause instanceof Error ? cause.message : "The project could not be saved."); }
  }
  async function openProject(file: File | undefined) {
    if (!file || (busy && !openingProject)) return;
    const request = ++projectRequestRef.current;
    setOpeningProject(true);
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error("This is not a valid HumStudio project: file is too large.");
      const p = parseProject(await file.text());
      if (!mountedRef.current || request !== projectRequestRef.current) return;
      remember();
      applyProject(p);
      setFileError("");
    } catch (e) {
      if (!mountedRef.current || request !== projectRequestRef.current) return;
      setFileError(e instanceof Error && e.message.startsWith("This is not") ? e.message : "That file couldn't be opened.");
    } finally {
      if (mountedRef.current && request === projectRequestRef.current) setOpeningProject(false);
    }
  }

  // Help is a native modal dialog: focus trap and Esc come free.
  useEffect(() => {
    const d = helpRef.current;
    if (help && d && !d.open) d.showModal();
    if (!help && d?.open) d.close();
  }, [help]);

  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (help || e.repeat || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        step(e.shiftKey ? "future" : "past");
      } else if (mod && k === "y") {
        e.preventDefault();
        step("future");
      } else if (mod && k === "s") {
        e.preventDefault();
        if (!busy) saveProject();
      } else if (mod || e.altKey) {
        return;
      } else if (e.key === "?") {
        setHelp((v) => !v);
      } else if (e.key === "Escape") {
        if (!help) back();
      } else if (k === "r" && zoomed) {
        if (phase === "recording") stopTake.current();
        else if (!busy) void record(false);
      } else if (busy) {
        return;
      } else if (e.key === " ") {
        if (el?.tagName === "BUTTON" || el?.tagName === "A") return; // Space already presses those
        e.preventDefault();
        void togglePlay();
      } else if (/^[1-5]$/.test(e.key)) {
        open(tracks[Number(e.key) - 1].instrument.id);
      } else if ((k === "m" || k === "s") && zoomed) {
        toggle(zoomed.instrument.id, k === "m" ? "muted" : "solo");
      } else if (k === "k") {
        playback.getEngine()?.setMetronome(!metronome);
        setMetronome(!metronome);
      } else if (k === "l") {
        setLearn((v) => !v);
      }
    };
  });

  const noteLabel = (m: number) => `${midiName(m).replace(/-?\d+$/, "")} ${solfege(m, harmony) ?? ""}`;

  /** Swap cached profiles; grid changes regenerate at each take's capture tempo, without rounding twice. */
  function regenerate(trackId?: string, level?: NoteSensitivity, division?: QuantizeDivision, fitEditedMelody = false, recordHistory = true) {
    try {
      const next = applyNoteSettings({ tracks: arrangementRef.current.tracks, harmony, takes: takesRef.current,
        snapSources: snapSourcesRef.current, trackId, sensitivity: level, quantize: division,
        harmonyDriver: harmonyDriverRef.current, keyOverride: pickedKeyRef.current, resnap: division !== undefined, fitEditedMelody });
      if (recordHistory) remember();
      takesRef.current = next.takes;
      snapSourcesRef.current = next.snapSources;
      setHarmony(next.harmony);
      commitTracks(next.tracks);
      return true;
    } catch (cause) {
      setFileError(cause instanceof RangeError ? cause.message : "The note settings couldn't be applied. Your parts are unchanged.");
      return false;
    }
  }

  const rowH = (id: string) => {
    if (!zoomedId) return Math.max(56, avail / tracks.length);
    return id === zoomedId ? Math.max(240, avail - COLLAPSED_H * (tracks.length - 1)) : COLLAPSED_H;
  };

  return (
    <div className={`studio${zoomedId ? " is-zoomed" : ""}`}>
      <header className="transport">
        <h1 className="wordmark">
          <span>Hum</span>Studio
        </h1>
        <div className="transport-group">
          <button className="t-btn" onClick={rewind} disabled={busy} aria-label="Back to start">
            <RewindIcon />
          </button>
          <button className={`t-btn play${playing ? " on" : ""}`} onClick={togglePlay} disabled={busy} aria-label={startingAudio ? "Starting audio" : playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="t-btn" onClick={stopPlayback} disabled={busy && !startingAudio} aria-label="Stop">
            <StopIcon />
          </button>
          <button className={metronome ? "t-btn play" : "t-btn"} aria-label="Metronome" title="Metronome" aria-pressed={metronome} disabled={busy} onClick={() => {
            playback.getEngine()?.setMetronome(!metronome);
            setMetronome(!metronome);
          }}>M</button>
          <button className={countIn ? "t-btn play" : "t-btn"} aria-label="Four-beat count-in" title="Four-beat count-in before playback" aria-pressed={countIn} disabled={busy} onClick={() => setCountIn(!countIn)}>4</button>
          <button className={learn ? "t-btn learn play" : "t-btn learn"} title="Learn: chords and scale degrees" aria-pressed={learn} onClick={() => setLearn(!learn)}>Learn</button>
          <output ref={posRef} className="position" aria-label="Position, bar.beat.sixteenth">
            1.1.1
          </output>
        </div>
        <div className="transport-fields">
          <label className="field">
            <span>BPM</span>
            <input
              type="number"
              min={60}
              max={180}
              value={bpm}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v)) {
                  const next = Math.min(180, Math.max(60, Math.round(v)));
                  if (next !== bpm) { remember(); arrangementRef.current = { ...arrangementRef.current, bpm: next }; setBpm(next); }
                }
              }}
            />
          </label>
          <div className="field harmony-field" title={`Song chords, one per bar: ${harmonyLabel(harmony)}. A Melody take sets them; pick a key to override.`}>
            <span>Key</span>
            <select aria-label="Song key" value={`${harmony.tonic} ${harmony.mode}`} disabled={busy} onChange={(e) => changeKey(e.target.value)}>
              {KEYS.map((k) => (
                <option key={`${k.tonic} ${k.mode}`} value={`${k.tonic} ${k.mode}`}>{keyName(k)}</option>
              ))}
            </select>
            <output className="position harmony-value" aria-label="Song chords" aria-live="polite">{harmony.bars.slice(0, 4).map(chordName).join(" ")}</output>
          </div>
        </div>
        <div className="file-group">
          <button className="t-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={busy || !history.undo} onClick={() => step("past")}>
            <UndoIcon />
          </button>
          <button className="t-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={busy || !history.redo} onClick={() => step("future")}>
            <RedoIcon />
          </button>
          <button className="t-btn" aria-label="Open project" title="Open a .humstudio.json project" disabled={busy} onClick={() => fileRef.current?.click()}>
            <OpenIcon />
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => {
            void openProject(e.target.files?.[0]);
            e.target.value = ""; // the same file can be opened again
          }} />
          <button className="t-btn" aria-label="Save project" title="Save project (Ctrl+S)" disabled={busy} onClick={saveProject}>
            <SaveIcon />
          </button>
          <button className="t-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelp(true)}>?</button>
          <button className="export" aria-label="Export MIDI" onClick={() => exportMidi(tracks, bpm)} disabled={busy || tracks.every((t) => !t.notes.length)}>
            <DownloadIcon /> <span className="lbl">Export MIDI</span>
          </button>
        </div>
      </header>

      {playbackError && <p role="alert">{playbackError}</p>}
      {fileError && <p className="sound-notice" role="alert">{fileError}</p>}
      {storageError && <p className="sound-notice" role="status">{storageError}</p>}
      {countInBeat !== null && <p role="status" aria-live="polite">Count-in: {countInBeat}</p>}

      <div className="ruler-row">
        <div className="ruler-corner">{!zoomed
            ? `${tracks.length} tracks`
            : zoomed.instrument.kind === "drums"
              ? `Rhythm · ${drumPart(zoomed.drumPart).name}`
              : `${midiName(zoomed.instrument.lo)}–${midiName(zoomed.instrument.hi)}`}</div>
        <div className="ruler" aria-hidden>
          {Array.from({ length: TOTAL_BEATS / 4 }, (_, i) => (
            <span key={i} style={{ left: `${beatX(i * 4)}%` }}>
              {i + 1}
            </span>
          ))}
        </div>
      </div>

      <div className="rows" ref={rowsRef} style={{ gridTemplateRows: tracks.map((t) => `${rowH(t.instrument.id)}px`).join(" ") }}>
        {tracks.map((t) => (
          <TrackRow
            key={t.instrument.id}
            track={t}
            zoomed={t.instrument.id === zoomedId}
            collapsed={!!zoomedId && t.instrument.id !== zoomedId}
            busy={busy}
            phase={phase}
            error={error}
            frames={frames}
            reveal={reveal}
            noteLabel={learn ? noteLabel : undefined}
            learn={learn}
            harmony={harmony}
            editorEpoch={editorEpoch}
            onSettingsChange={(level, division) => regenerate(t.instrument.id, level, division)}
            sensitivityAvailable={profileTracks.includes(t.instrument.id)}
            onPasteNotes={(clipboard, anchorBeat) => pasteNotes(t.instrument.id, clipboard, anchorBeat)}
            pasteBeat={() => playback.getEngine()?.positionBeats() ?? 0}
            onEditNotes={(notes) => editNotes(t.instrument.id, notes, t.drumPart)}
            onDeleteNote={(noteId) => deleteNote(t.instrument.id, noteId)}
            onClear={() => clearPart(t.instrument.id, t.drumPart)}
            onRepeat={() => repeatPart(t.instrument.id, t.drumPart)}
            demo={demo}
            bpm={bpm}
            countIn={t.instrument.id === zoomedId ? countInBeat : null}
            presetStatus={presetStatuses[t.instrument.id]}
            onPresetChange={id => { void changePreset(t.instrument.id, id); }}
            onOpen={() => open(t.instrument.id)}
            onBack={back}
            onRecord={record}
            onStop={() => stopTake.current()}
            onToggle={(k) => toggle(t.instrument.id, k)}
            onDrumPartChange={(part) => changeDrumPart(t.instrument.id, part)}
          />
        ))}
        <div className="playhead-track" aria-hidden>
          <div className="playhead" ref={headRef} />
        </div>
      </div>

      <dialog ref={helpRef} className="help" aria-labelledby="help-title" onClose={() => setHelp(false)}>
        <h2 id="help-title">Keyboard shortcuts</h2>
        <dl>
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}>
              <dt><kbd>{keys}</kbd></dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <p>Ctrl+C arms region selection. Draw a box, release, then drag the highlighted group to paste. Ctrl+V pastes at the current playhead (beat 1 when stopped). Escape cancels. In an open track: click to add a note, drag to move, drag either edge to stretch, double-click or Delete to remove, arrows to nudge (Shift+arrows stretch).</p>
        <button className="ghost-btn" onClick={() => setHelp(false)}>Close</button>
      </dialog>
    </div>
  );
}
