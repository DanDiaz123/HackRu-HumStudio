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
}

export type StopFn = () => void;

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

export async function startMic(onFrame: (f: HumFrame) => void): Promise<StopFn> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("insecure", "SecurityError");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.2;
  src.connect(analyser); // analysis only, never to ctx.destination

  const spec = new Float32Array(analyser.frequencyBinCount);
  const wave = new Float32Array(analyser.fftSize);
  const hzPerBin = ctx.sampleRate / analyser.fftSize;
  const detector = PitchDetector.forFloat32Array(analyser.fftSize);
  const t0 = performance.now();
  let raf = 0;

  const tick = () => {
    analyser.getFloatFrequencyData(spec);
    analyser.getFloatTimeDomainData(wave);
    let sum = 0;
    for (const s of wave) sum += s * s;
    const rms = Math.sqrt(sum / wave.length);

    const bins = new Float32Array(BIN_COUNT);
    for (let i = 0; i < BIN_COUNT; i++) {
      const k = Math.min(spec.length - 1, Math.round(binHz(i) / hzPerBin));
      bins[i] = Math.min(1, Math.max(0, (spec[k] + 90) / 60)); // -90..-30 dB -> 0..1
    }
    const [pitch, clarity] = detector.findPitch(wave, ctx.sampleRate);
    const hz = rms >= 0.01 && clarity >= 0.85 && pitch >= F_LO && pitch <= F_HI ? pitch : null;
    onFrame({ tSec: (performance.now() - t0) / 1000, bins, hz, rms });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}

/** Synthetic hum for demos without a mic. Labeled "Demo hum" wherever it's shown. */
export function startDemoHum(onFrame: (f: HumFrame) => void): StopFn {
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
  }, 1000 / 60);
  return () => clearInterval(id);
}
