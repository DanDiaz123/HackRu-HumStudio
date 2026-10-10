// Live hum capture for the spectrogram. Audio stays in this tab: nothing is uploaded or stored.
import { PitchDetector } from "pitchy";

export const BIN_COUNT = 48;
export const F_LO = 80;
export const F_HI = 1000;

export interface HumFrame {
  tSec: number; // seconds since recording start
  bins: Float32Array; // BIN_COUNT log-spaced magnitudes 80..1000 Hz, 0..1, low -> high
  hz: number | null;
  rms: number;
  zcrHz?: number; // zero crossings as a frequency: ~fundamental for a hum, several kHz for "ts" noise
}

const binHz = (i: number) => F_LO * Math.pow(F_HI / F_LO, i / (BIN_COUNT - 1));

export function micErrorMessage(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext)
    return "The microphone needs a secure page. Open this over https or localhost.";
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access was blocked. Allow it in the address bar, or use the demo hum.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device.";
  if (name === "NotReadableError") return "Another app is using the microphone.";
  return "The microphone could not start.";
}

/** Samples Pitchy analyses per frame (~85 ms at 48 kHz). */
export const WINDOW_SIZE = 4096;
/** One frame per hop: 50 per second at any sample rate (spec: ~20 ms). */
export const HOPS_PER_SEC = 50;

/** Rolling buffer of the newest `size` samples; push a hop, get the full analysis window back. */
export function slidingWindow(size: number) {
  const buf = new Float32Array(size);
  return (hop: Float32Array) => {
    buf.copyWithin(0, hop.length);
    buf.set(hop, size - hop.length);
    return buf;
  };
}

/** Audio-clock time a window's pitch belongs to: its centre, not its newest sample. */
export const windowCenterSec = (endFrame: number, sampleRate: number, size = WINDOW_SIZE) =>
  (endFrame - size / 2) / sampleRate;

/**
 * Pitchy fundamental, gated: too quiet, unclear, or out of hum range reads as unvoiced (null).
 * zcrHz tells beatboxed hats (hiss, high) from snares (lower) above the spectrogram's 1 kHz.
 */
export function analyzeWindow(wave: Float32Array, sampleRate: number, detector: PitchDetector<Float32Array>) {
  let sum = 0;
  let crossings = 0;
  for (let i = 0; i < wave.length; i++) {
    sum += wave[i] * wave[i];
    if (i && (wave[i] >= 0) !== (wave[i - 1] >= 0)) crossings++;
  }
  const rms = Math.sqrt(sum / wave.length);
  const [pitch, clarity] = detector.findPitch(wave, sampleRate);
  const hz = rms >= 0.01 && clarity >= 0.85 && pitch >= F_LO && pitch <= F_HI ? pitch : null;
  return { hz, rms, zcrHz: (crossings * sampleRate) / (2 * wave.length) };
}

/** What the mic needs from an audio context. Studio passes Tone's, so frames share the click's clock. */
export interface MicContext {
  readonly sampleRate: number;
  /** Seconds from scheduling a sound to it leaving the speakers. */
  readonly outputLatencySec: number;
  addModule(url: string): Promise<void>;
  createMediaStreamSource(stream: MediaStream): MediaStreamAudioSourceNode;
  createAnalyser(): AnalyserNode;
  createWorklet(name: string, options: AudioWorkletNodeOptions): AudioWorkletNode;
}

/**
 * Starts analysis without monitoring the microphone. Frames use `ctx`'s audio clock;
 * the caller rebases them to recording start. Returns an idempotent stop function.
 * Failed setup releases every acquired resource while leaving the shared context open.
 */
export async function startMic(ctx: MicContext, onFrame: (f: HumFrame) => void): Promise<() => void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
    throw new DOMException("insecure", "SecurityError");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  let src: MediaStreamAudioSourceNode | undefined;
  let tap: AudioWorkletNode | undefined;
  let analyser: AnalyserNode | undefined;
  let stopped = false;
  // The context is shared with playback, so it stays open.
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (tap) tap.port.onmessage = null;
    // One failed disconnect must not prevent the remaining resources from being released.
    const release = [
      () => tap?.port.postMessage("stop"),
      () => tap?.port.close(),
      () => tap?.disconnect(),
      () => analyser?.disconnect(),
      () => src?.disconnect(),
      ...stream.getTracks().map((track) => () => track.stop()),
    ];
    for (const dispose of release) {
      try { dispose(); } catch { /* Continue releasing the other microphone resources. */ }
    }
  };

  try {
    src = ctx.createMediaStreamSource(stream);
    // The worklet delivers every sample on the audio thread; the main thread only analyses.
    await ctx.addModule("/hum-worklet.js");
    tap = ctx.createWorklet("hum-tap", {
      numberOfInputs: 1,
      numberOfOutputs: 0, // analysis only, never to ctx.destination
      channelCount: 1,
      channelCountMode: "explicit", // stereo mics are mixed down to mono
      processorOptions: { hop: Math.round(ctx.sampleRate / HOPS_PER_SEC) },
    });
    // The analyser only feeds the display; pitch comes from the worklet's samples.
    const display = ctx.createAnalyser();
    analyser = display;
    display.fftSize = WINDOW_SIZE;
    display.smoothingTimeConstant = 0.2;
    src.connect(display);
    src.connect(tap);

    const spec = new Float32Array(display.frequencyBinCount);
    const hzPerBin = ctx.sampleRate / display.fftSize;
    const detector = PitchDetector.forFloat32Array(WINDOW_SIZE);
    const push = slidingWindow(WINDOW_SIZE);

    tap.port.onmessage = (e: MessageEvent<{ samples: Float32Array; endFrame: number }>) => {
      if (stopped) return;
      const { hz, rms, zcrHz } = analyzeWindow(push(e.data.samples), ctx.sampleRate, detector);
      display.getFloatFrequencyData(spec);
      const bins = new Float32Array(BIN_COUNT);
      for (let i = 0; i < BIN_COUNT; i++) {
        const k = Math.min(spec.length - 1, Math.round(binHz(i) / hzPerBin));
        bins[i] = Math.min(1, Math.max(0, (spec[k] + 90) / 60)); // -90..-30 dB -> 0..1
      }
      onFrame({ tSec: windowCenterSec(e.data.endFrame, ctx.sampleRate), bins, hz, rms, zcrHz });
    };
    return cleanup;
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Synthetic hum for demos without a mic. Labeled "Demo hum" wherever it's shown. */
export function startDemoHum(onFrame: (f: HumFrame) => void): () => void {
  const contour = [0, 2, 4, 4, 7, 5, 4, 2, 0, 0, 4, 7, 9, 7, 4, 2]; // semitones over C4
  const t0 = performance.now();
  const id = window.setInterval(() => {
    const tSec = (performance.now() - t0) / 1000;
    const step = Math.floor(tSec / 0.6);
    const voiced = tSec % 0.6 < 0.5;
    const hz = voiced ? 261.63 * Math.pow(2, (contour[step % contour.length] + Math.sin(tSec * 30) * 0.15) / 12) : null;
    const bins = new Float32Array(BIN_COUNT);
    if (hz) {
      for (let i = 0; i < BIN_COUNT; i++) {
        let v = 0;
        for (let h = 1; h <= 3; h++) {
          const d = Math.log2(binHz(i) / (hz * h)) * 12; // semitone distance to harmonic
          v += Math.exp(-(d * d) / 2) / h;
        }
        bins[i] = Math.min(1, v * (0.85 + Math.random() * 0.15));
      }
    } else {
      for (let i = 0; i < BIN_COUNT; i++) bins[i] = Math.random() * 0.08;
    }
    onFrame({ tSec, bins, hz, rms: hz ? 0.1 : 0.003 });
  }, 1000 / HOPS_PER_SEC);
  return () => clearInterval(id);
}
