import { midiName } from "../../lib/tracks.ts";

/** Synthetic PCM for capture/decoding checks; this does not measure real instrument timbre. */
export function wave(seconds, pulsed = false) {
  const rate = 48000, count = Math.round(rate * seconds), bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate, level = pulsed && t % 0.6 > 0.4 ? 0 : 0.25;
    bytes.writeInt16LE(Math.round(level * Math.sin(2 * Math.PI * 392 * t) * 32767), 44 + i * 2);
  }
  return bytes;
}

const sample = wave(0.1);
const audio = `data:audio/wav;base64,${sample.toString("base64")}`;
const soundfont = `MIDI.Soundfont.fixture = {${Array.from({ length: 128 }, (_, midi) => `${JSON.stringify(midiName(midi))}:${JSON.stringify(audio)}`).join(",")},};`;
const drumSamples = {
  "TR-808": ["kick", "snare", "hihat-close", "hihat-open", "cymbal"],
  "LM-2": ["kick", "snare", "hhclosed", "hhopen", "crash"],
  "Casio-RZ1": ["kick", "snare", "hihat-closed", "hihat-open", "crash"],
};

/** Exercise real smplr decoding for every family without contacting upstream sample hosts. */
export async function installSampleFixtures(context, { delayMs = 0, shouldFail = () => false, onRequest = () => {} } = {}) {
  await context.route(/https:\/\/(gleitz|smpldsnds)\.github\.io\//, async route => {
    const url = route.request().url();
    onRequest(url);
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    let body = sample, contentType = "audio/wav";
    if (url.includes("gleitz.github.io")) { body = soundfont; contentType = "text/plain"; }
    else if (url.endsWith("/dm.json")) {
      const name = new URL(url).pathname.split("/").at(-2);
      if (!Object.hasOwn(drumSamples, name)) throw new Error("Unexpected fixture drum kit.");
      body = JSON.stringify({ name, samples: drumSamples[name] }); contentType = "application/json";
    } else if (url.endsWith(".sfz")) {
      body = "<group> ampeg_release=0.2\n<region> sample=fixture.wav pitch_keycenter=60 lokey=0 hikey=127 lovel=1 hivel=127";
      contentType = "text/plain";
    }
    const failed = shouldFail(url);
    await route.fulfill({ status: failed ? 503 : 200, headers: { "access-control-allow-origin": "*" },
      contentType: failed ? "text/plain" : contentType, body: failed ? "Fixture sample download failure" : body });
  });
}
