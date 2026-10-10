import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { PitchDetector } from "pitchy";
import { generateTrack } from "../lib/generate.ts";
import { type HumFrame, type MicContext, HOPS_PER_SEC, WINDOW_SIZE, analyzeWindow, slidingWindow, startMic, windowCenterSec } from "../lib/hum.ts";
import { DEFAULT_HARMONY } from "../lib/music/harmony.ts";
import { INSTRUMENTS } from "../lib/tracks.ts";

test("slidingWindow keeps the newest samples, oldest first", () => {
  const push = slidingWindow(4);
  push(Float32Array.of(1, 2));
  assert.deepEqual([...push(Float32Array.of(3, 4, 5))], [2, 3, 4, 5]);
});

test("a window is timed at its centre on the audio clock", () => {
  assert.equal(windowCenterSec(48000 + WINDOW_SIZE / 2, 48000), 1);
});

test("mic path: a hummed G4 with a 5 ms dropout becomes one G4", async () => {
  // Simulate what the worklet sends: 2 s of a hum-like G4 (harmonics + noise) in 20 ms hops.
  const rate = 48000;
  const hop = rate / HOPS_PER_SEC;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  const audio = new Float32Array(rate * 2).map((_, i) => {
    const t = i / rate;
    if (t >= 1 && t < 1.005) return 0; // mic dropout
    const w = 2 * Math.PI * 392 * t;
    return 0.3 * Math.sin(w) + 0.1 * Math.sin(2 * w) + 0.05 * Math.sin(3 * w) + noise();
  });

  const push = slidingWindow(WINDOW_SIZE);
  const detector = PitchDetector.forFloat32Array(WINDOW_SIZE);
  const frames: HumFrame[] = [];
  for (let end = hop; end <= audio.length; end += hop) {
    const { hz, rms } = analyzeWindow(push(audio.subarray(end - hop, end)), rate, detector);
    frames.push({ tSec: windowCenterSec(end, rate), hz, rms, bins: new Float32Array(0) });
  }

  const melody = INSTRUMENTS.find((i) => i.id === "melody")!;
  const notes = await generateTrack(melody, frames.filter((f) => f.tSec >= 0), 120, "1/16", DEFAULT_HARMONY);
  assert.deepEqual(notes.map((n) => n.midi), [67]);
  assert.ok(notes[0].durationBeats >= 3.5);
});

test("mic analysis recovery after 120 ms dropouts does not re-strike a continuous hum", async () => {
  const rate = 48000;
  const hop = rate / HOPS_PER_SEC;
  const audio = new Float32Array(rate * 3).map((_, i) => {
    const t = i / rate;
    if (t % 1.6 >= 0.8 && t % 1.6 < 0.92) return 0;
    const phase = 2 * Math.PI * 392 * t;
    return 0.25 * Math.sin(phase) + 0.08 * Math.sin(2 * phase);
  });
  const push = slidingWindow(WINDOW_SIZE);
  const detector = PitchDetector.forFloat32Array(WINDOW_SIZE);
  const frames: HumFrame[] = [];
  for (let end = hop; end <= audio.length; end += hop) {
    const { hz, rms } = analyzeWindow(push(audio.subarray(end - hop, end)), rate, detector);
    const tSec = windowCenterSec(end, rate);
    if (tSec >= 0) frames.push({ tSec, hz, rms, bins: new Float32Array(0) });
  }
  const melody = INSTRUMENTS.find(instrument => instrument.id === "melody")!;
  for (const level of ["low", "medium", "high"] as const) {
    const notes = await generateTrack(melody, frames, 120, "off", DEFAULT_HARMONY, level);
    assert.deepEqual(notes.map(note => note.midi), [67], `${level} must bridge the analysis recovery ramp`);
    assert.ok(notes[0].durationBeats >= 5.5);
  }
});

/** Browser doubles expose resource ownership without opening a real microphone. */
function micFixture(t: TestContext, failure?: string, failDisconnect = false) {
  const released: string[] = [];
  const setupError = new Error("mic setup failed");
  const fail = (stage: string) => { if (failure === stage) throw setupError; };
  const tracks = ["track-a", "track-b"].map((name) => ({ stop: () => { released.push(name); } }));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => tracks }) } },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
  const disconnect = (name: string) => () => {
    released.push(name);
    if (failDisconnect) throw new Error("already disconnected");
  };
  const port = {
    onmessage: null as ((event: MessageEvent<{ samples: Float32Array; endFrame: number }>) => void) | null,
    postMessage: (value: unknown) => { assert.equal(value, "stop"); released.push("worklet-stop"); },
    close: () => { released.push("port"); },
  };
  const ctx: MicContext = {
    sampleRate: 48000,
    outputLatencySec: 0,
    addModule: async () => { fail("module"); },
    createMediaStreamSource: () => {
      fail("source");
      return { connect: () => { fail("connect"); }, disconnect: disconnect("source") } as unknown as MediaStreamAudioSourceNode;
    },
    createWorklet: () => {
      fail("worklet");
      return { port, disconnect: disconnect("worklet") } as unknown as AudioWorkletNode;
    },
    createAnalyser: () => {
      fail("analyser");
      return { frequencyBinCount: 2048, getFloatFrequencyData: () => {}, disconnect: disconnect("analyser") } as unknown as AnalyserNode;
    },
  };
  return { ctx, port, released, setupError };
}

for (const stage of ["source", "module", "worklet", "analyser", "connect"]) {
  test(`microphone setup failure at ${stage} stops every acquired stream track`, async (t) => {
    const { ctx, port, released, setupError } = micFixture(t, stage);
    await assert.rejects(startMic(ctx, () => {}), (error) => error === setupError);
    assert.equal(released.filter((name) => name === "track-a").length, 1);
    assert.equal(released.filter((name) => name === "track-b").length, 1);
    assert.equal(port.onmessage, null);
    if (stage !== "source") assert.ok(released.includes("source"));
    if (["analyser", "connect"].includes(stage)) {
      assert.ok(released.includes("worklet-stop"));
      assert.ok(released.includes("port"));
      assert.ok(released.includes("worklet"));
    }
    if (stage === "connect") assert.ok(released.includes("analyser"));
  });
}

test("microphone stop is idempotent and stale deliveries cannot publish frames", async (t) => {
  const { ctx, port, released } = micFixture(t);
  let deliveries = 0;
  const stop = await startMic(ctx, () => { deliveries++; });
  const deliver = port.onmessage!;
  stop();
  stop();
  deliver({ data: { samples: new Float32Array(960), endFrame: 960 } } as MessageEvent);
  assert.equal(deliveries, 0);
  assert.equal(port.onmessage, null);
  assert.deepEqual(released, ["worklet-stop", "port", "worklet", "analyser", "source", "track-a", "track-b"]);
});

test("failed graph disconnections do not prevent microphone tracks from stopping", async (t) => {
  const { ctx, released } = micFixture(t, undefined, true);
  const stop = await startMic(ctx, () => {});
  assert.doesNotThrow(stop);
  assert.ok(released.includes("track-a"));
  assert.ok(released.includes("track-b"));
});
