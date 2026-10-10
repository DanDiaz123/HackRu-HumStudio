"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type GenTrace, generateNotes } from "@/lib/generate";
import { DEFAULT_NOTE_SENSITIVITY, NOTE_SENSITIVITY_LEVELS, NOTE_SENSITIVITY_PRESETS, isNoteSensitivity, type NoteSensitivity } from "@/lib/audio/note-sensitivity";
import { type HumFrame, micErrorMessage, startDemoHum, startMic } from "@/lib/hum";
import { download } from "@/lib/download";
import { exportMidi } from "@/lib/midi";
import { repeatFirstHalf } from "@/lib/note-edit";
import { type LoadedProject, MAX_PROJECT_CHARS, STORAGE_KEY, newProjectMeta, parseProject, serializeProject } from "@/lib/persistence/project";
import {
  DEFAULT_HARMONY,
  type Harmony,
  type Key,
  KEYS,
  type Mode,
  chordName,
  chordsFromVoicing,
  fitToHarmony,
  harmonyLabel,
  inferHarmony,
  keyName,
  solfege,
  voiceChords,
  withKey,
} from "@/lib/music/harmony";
import * as playback from "@/lib/playback";
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
  midiName,
  noteId,
} from "@/lib/tracks";
import { DownloadIcon, OpenIcon, PauseIcon, PlayIcon, RedoIcon, RewindIcon, SaveIcon, StopIcon, UndoIcon } from "./icons";
import TrackRow, { type Phase, REVEAL_SEC, type Reveal } from "./TrackRow";

const COLLAPSED_H = 36;
const MAX_UNDO = 100;

/** Everything an undo step puts back. Takes ride along so Sensitivity/Snap re-read the right audio analysis. */
interface Snapshot {
  tracks: Track[];
  harmony: Harmony;
  takes: Record<string, HumFrame[]>;
  pickedKey: Key | null;
}

/** Keys that work anywhere except while typing in a field. */
const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["R", "Record or stop (open track)"],
  ["1 – 5", "Open a track"],
  ["Esc", "Back to all tracks"],
  ["M / S", "Mute / solo the open track"],
  ["K", "Metronome"],
  ["L", "Learn"],
  ["Ctrl Z / Ctrl Shift Z", "Undo / redo"],
  ["Ctrl S", "Save project"],
  ["?", "This list"],
];

/**
 * Move a part onto new harmony without deleting notes: the Keys sample is re-voiced, drums stay put.
 * Melody moves only on an explicit key pick; otherwise its hummed or hand-edited semitones are kept.
 */
const refit = (t: Track, h: Harmony, melodyToo = false): Track =>
  t.instrument.kind === "drums" || (t.instrument.id === "melody" && !melodyToo) ? t
  : { ...t, notes: t.sample ? voiceChords(h) : fitToHarmony(t.notes, t.instrument, h) };

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
  const [quantize, setQuantize] = useState<QuantizeDivision>("1/4");
  const [sensitivity, setSensitivity] = useState<NoteSensitivity>(DEFAULT_NOTE_SENSITIVITY);
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

  const rowsRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<HTMLOutputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  // Re-record clears the part up front; a failed take puts it back (never lose a part to an empty take).
  const clearedRef = useRef<{ id: string; notes: Note[] } | null>(null);
  // Analysis frames of each part's latest take (never audio), so Sensitivity/Snap can re-read it. Not persisted.
  const takesRef = useRef<Record<string, HumFrame[]>>({});
  // A key the user picked by hand; regeneration keeps it until the next Melody take sets a new one.
  const pickedKeyRef = useRef<Key | null>(null);
  const playbackRequest = useRef(0);
  const arrangementRef = useRef({ tracks, bpm });
  const stopTake = useRef<() => void>(() => {});
  const unsubscribePresets = useRef<(() => void) | null>(null);
  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  // The state before the take in progress, so a whole take is one undo step.
  const takeUndoRef = useRef<Snapshot | null>(null);
  const metaRef = useRef(newProjectMeta());
  const fileRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);

  const busy = startingAudio || phase === "requesting" || phase === "recording" || phase === "generating" || phase === "revealing";
  const zoomed = tracks.find((t) => t.instrument.id === zoomedId) ?? null;

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
  useEffect(() => () => {
    stopRef.current?.();
    playbackRequest.current++;
    unsubscribePresets.current?.();
    playback.dispose();
  }, []);

  function pauseIfPlaying() {
    const live = playback.getEngine();
    if (live?.state() !== "started") return false;
    live.pause();
    setPos(live.positionBeats());
    setPlaying(false);
    return true;
  }

  /** Connect runtime loading feedback after a user gesture, outside serializable Track[]. */
  async function connectAudio() {
    const engine = await playback.ensureAudio();
    unsubscribePresets.current ??= engine.subscribePresets(status => {
      setPresetStatuses(previous => ({ ...previous, [status.trackId]: status }));
    });
    return engine;
  }

  /** Change only playback timbre; retain the category, note array, and all note IDs. */
  async function changePreset(trackId: string, presetId: string) {
    const preset = presetForTrack(trackId, presetId);
    const current = arrangementRef.current;
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
      if (arrangementRef.current.tracks.find(t => t.instrument.id === trackId)?.presetId !== preset.id) return;
      setPresetStatuses(previous => ({ ...previous, [trackId]: { trackId, presetId, state: "fallback",
        message: "Audio could not start. Check your output device and retry this sound." } }));
    }
  }

  /** Put the arrangement and metronome setting back after a click-only recording. */
  function restoreTransport() {
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

  const finish = useCallback(
    async (taken: HumFrame[]) => {
      stopRef.current?.();
      stopRef.current = null;
      if (!zoomed) return;
      // Beatbox hits are mostly unvoiced, so drums count loud frames instead of pitched ones.
      const heard = zoomed.instrument.kind === "drums" ? (f: HumFrame) => f.rms > 0.02 : (f: HumFrame) => f.hz !== null;
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
        const notes = generateNotes(inst, taken, bpm, quantize, harmony, sensitivity, trace);
        if (!notes.length) throw new Error("empty");
        // A Melody take sets the key and chords, a Keys take re-picks the chords; other pitched parts
        // are re-fitted (moved, never deleted).
        const h = inst.id === "melody" ? inferHarmony(notes) : inst.id === "keys" ? chordsFromVoicing(notes, harmony) : null;
        const after = h ?? harmony;
        // Every step shows what the pipeline actually produced; nothing here is a progress estimate.
        const drums = inst.kind === "drums";
        // Melody is pitch-corrected only on Low (generate.ts); say so rather than claim "in key".
        const keptPitch = inst.id === "melody" && sensitivity !== "low";
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
        const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
        setReveal({ step: 0, raw: trace.raw, final: notes, harmony: after, steps });
        setPhase("revealing");
        for (let i = 1; i <= steps.length; i++) {
          await wait(i === 1 && stepMs ? (REVEAL_SEC + 0.3) * 1000 : stepMs); // step 0 lasts as long as the print-in sweep
          setReveal((r) => r && { ...r, step: i });
        }
        if (takeUndoRef.current) pushHistory(takeUndoRef.current);
        takeUndoRef.current = null;
        if (h) setHarmony(h);
        if (inst.id === "melody") pickedKeyRef.current = null;
        takesRef.current[inst.id] = taken;
        clearedRef.current = null;
        setTracks((ts) =>
          ts.map((t) => {
            if (t.instrument.id === inst.id) return { ...t, notes, sample: false };
            return h ? refit(t, h) : t;
          }),
        );
        setReveal(null);
        setPhase("done");
      } catch {
        restoreCleared();
        setReveal(null);
        setPhase("error"); // the cleared part comes back
        setError("No notes came out of that take. Try a longer, steadier hum.");
      }
    },
    [zoomed, bpm, quantize, harmony, sensitivity],
  );

  function restoreCleared() {
    const c = clearedRef.current;
    clearedRef.current = null;
    if (c) setTracks((ts) => ts.map((t) => (t.instrument.id === c.id && !t.notes.length ? { ...t, notes: c.notes } : t)));
  }

  async function record(useDemo: boolean) {
    if (!zoomed || busy) return;
    if (!zoomed.sample && zoomed.notes.length &&
      !window.confirm(`Record over your ${zoomed.instrument.name} part? Undo (Ctrl+Z) brings it back.`)) return;
    takeUndoRef.current = snapshot();
    pauseIfPlaying();
    clearedRef.current = null;
    if (!zoomed.sample && zoomed.notes.length) {
      clearedRef.current = { id: zoomed.instrument.id, notes: zoomed.notes };
      setTracks((ts) => ts.map((t) => (t.instrument.id === zoomed.instrument.id ? { ...t, notes: [] } : t)));
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
      if (done || originSec === null || raw.tSec < originSec) return;
      const f = originSec ? { ...raw, tSec: raw.tSec - originSec } : raw;
      taken.push(f);
      if (f.tSec >= limitSec) {
        done = true;
        void finish(taken);
      }
    };
    stopRef.current = () => {
      done = true;
    };
    try {
      if (useDemo) {
        stopRef.current = startDemoHum(onFrame);
      } else {
        setPhase("requesting");
        // Audio first: the mic runs on Tone's context, so its frames share the click's clock.
        const engine = await connectAudio();
        const mic = await playback.micContext();
        const stopMic = await startMic(mic, onFrame);
        stopRef.current = () => {
          done = true;
          stopMic();
          restoreTransport();
        };
        // Count in, then keep the click going so the hum lands on the beat grid. No backing tracks: the mic would hear them.
        engine.schedule([], bpm);
        engine.setMetronome(true);
        const counted = await engine.countIn(bpm, setCountInBeat);
        setCountInBeat(null);
        if (!counted || done) throw new Error("count-in cancelled");
        originSec = engine.nowSec() + mic.outputLatencySec;
        engine.play();
      }
      setPhase("recording");
    } catch (e) {
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
      void finish(taken);
    };
  }

  /** A wrong key guess is one pick away: chords re-picked from the melody, every pitched part refitted. */
  function changeKey(value: string) {
    const [tonic, mode] = value.split(" ");
    const key: Key = { tonic: Number(tonic), mode: mode as Mode };
    remember();
    pickedKeyRef.current = key;
    const h = withKey(key, tracks.find((t) => t.instrument.id === "melody")?.notes ?? []);
    setHarmony(h);
    setTracks((ts) => ts.map((t) => refit(t, h, true)));
  }

  /** A hand edit replaces the part's notes; an edited Sample is the user's part from then on. */
  function editNotes(id: string, notes: Note[]) {
    remember();
    delete takesRef.current[id];
    setTracks((ts) => ts.map((t) => (t.instrument.id === id ? { ...t, notes, sample: false } : t)));
  }

  function toggle(id: string, key: "muted" | "solo") {
    setTracks((ts) => ts.map((t) => (t.instrument.id === id ? { ...t, [key]: !t[key] } : t)));
  }

  // Undo / redo
  const snapshot = (): Snapshot => ({ tracks, harmony, takes: { ...takesRef.current }, pickedKey: pickedKeyRef.current });
  function pushHistory(s: Snapshot) {
    const h = historyRef.current;
    h.past = [...h.past, s].slice(-MAX_UNDO);
    h.future = [];
    setHistory({ undo: h.past.length, redo: 0 });
  }
  /** Call before any change worth undoing (edits, takes, key, regeneration, clear/repeat, open). */
  const remember = () => pushHistory(snapshot());
  function restore(s: Snapshot) {
    setTracks(s.tracks);
    setHarmony(s.harmony);
    takesRef.current = { ...s.takes };
    pickedKeyRef.current = s.pickedKey;
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

  function clearPart(id: string) {
    remember();
    delete takesRef.current[id];
    setTracks((ts) => ts.map((t) => (t.instrument.id === id ? { ...t, notes: [], sample: false } : t)));
  }
  function repeatPart(id: string) {
    const t = tracks.find((x) => x.instrument.id === id);
    if (t) editNotes(id, repeatFirstHalf(t.notes, noteId));
  }

  // Project files: autosave to this browser, Save/Open as .humstudio.json
  const current = (): LoadedProject => ({ meta: metaRef.current, bpm, quantize, sensitivity, harmony, tracks });
  function applyProject(p: LoadedProject) {
    stopPlayback();
    metaRef.current = p.meta;
    takesRef.current = {};
    pickedKeyRef.current = null;
    setTracks(p.tracks);
    setHarmony(p.harmony);
    setBpm(p.bpm);
    setQuantize(p.quantize);
    setSensitivity(p.sensitivity);
    setZoomedId(null);
    setPhase("idle");
  }
  // Restore the autosave once, after mount (localStorage is browser-only). A bad save is ignored, not loaded.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
      if (saved) applyProject(parseProject(saved));
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
  }, [restored, busy, tracks, harmony, bpm, quantize, sensitivity]);

  function saveProject() {
    download(serializeProject(current()), "application/json", "humstudio-project.humstudio.json");
  }
  async function openProject(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_PROJECT_CHARS) throw new Error("This is not a valid HumStudio project: file is too large.");
      const p = parseProject(await file.text());
      remember();
      applyProject(p);
      setFileError("");
    } catch (e) {
      setFileError(e instanceof Error && e.message.startsWith("This is not") ? e.message : "That file couldn't be opened.");
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
        saveProject();
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

  /**
   * Re-read every kept take at a new sensitivity/snap without re-recording: Melody first (it sets the chords),
   * then Keys (it re-picks them), then the rest. Hand-edited parts drop their take, so edits are never overwritten.
   */
  function regenerate(level: NoteSensitivity, division: QuantizeDivision) {
    const takes = takesRef.current;
    if (!Object.keys(takes).length) return;
    remember();
    const order = (id: string) => (id === "melody" ? 0 : id === "keys" ? 1 : 2);
    let h = harmony;
    const fresh: Record<string, Note[]> = {};
    for (const t of [...tracks].sort((a, b) => order(a.instrument.id) - order(b.instrument.id))) {
      const frames = takes[t.instrument.id];
      if (!frames) continue;
      const notes = generateNotes(t.instrument, frames, bpm, division, h, level);
      if (!notes.length) continue; // keep what's there rather than erase a part
      fresh[t.instrument.id] = notes;
      if (t.instrument.id === "melody") h = pickedKeyRef.current ? withKey(pickedKeyRef.current, notes) : inferHarmony(notes);
      else if (t.instrument.id === "keys") h = chordsFromVoicing(notes, h);
    }
    if (h !== harmony) setHarmony(h);
    setTracks((ts) => ts.map((t) => (fresh[t.instrument.id] ? { ...t, notes: fresh[t.instrument.id], sample: false } : h !== harmony ? refit(t, h) : t)));
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
                if (Number.isFinite(v)) setBpm(Math.min(180, Math.max(60, Math.round(v))));
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
          <label className="field">
            <span>Snap</span>
            <select value={quantize} onChange={(e) => { const d = e.target.value as QuantizeDivision; setQuantize(d); regenerate(sensitivity, d); }} disabled={busy}>
              <option value="off">Off</option>
              <option value="1/4">1/4</option>
              <option value="1/8">1/8</option>
              <option value="1/16">1/16</option>
            </select>
          </label>
          <label className="field sensitivity-field">
            <span>Sensitivity</span>
            <select aria-label="Note sensitivity" value={sensitivity} disabled={busy}
              title={`${NOTE_SENSITIVITY_PRESETS[sensitivity].description} Switching re-reads your takes; hand-edited parts are kept.`} onChange={event => {
                if (isNoteSensitivity(event.target.value)) { setSensitivity(event.target.value); regenerate(event.target.value, quantize); }
              }}>
              {NOTE_SENSITIVITY_LEVELS.map(level => (
                <option key={level} value={level}>{NOTE_SENSITIVITY_PRESETS[level].label}</option>
              ))}
            </select>
          </label>
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
      {Object.values(presetStatuses).some(status => status.state === "loading") && (
        <p className="sound-notice" role="status">Loading selected sounds…</p>
      )}
      {Object.values(presetStatuses).filter(status => status.state === "fallback").map(status => (
        <p key={status.trackId} className="sound-notice" role="status">{status.message}</p>
      ))}
      {countInBeat !== null && <p role="status" aria-live="polite">Count-in: {countInBeat}</p>}

      <div className="ruler-row">
        <div className="ruler-corner">{!zoomed
            ? `${tracks.length} tracks`
            : zoomed.instrument.kind === "drums"
              ? "Kit"
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
            quantize={quantize}
            onEditNotes={(notes) => editNotes(t.instrument.id, notes)}
            onClear={() => clearPart(t.instrument.id)}
            onRepeat={() => repeatPart(t.instrument.id)}
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
        <p>In an open track: click to add a note, drag to move, drag either edge to stretch, double-click or Delete to remove, arrows to nudge (Shift+arrows stretch).</p>
        <button className="ghost-btn" onClick={() => setHelp(false)}>Close</button>
      </dialog>
    </div>
  );
}
