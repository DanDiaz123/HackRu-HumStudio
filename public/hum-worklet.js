// Audio-thread tap for hum.ts. Forwards every mic sample in fixed hops, stamped with the
// audio clock, so a busy page or background tab can't drop pitch readings. Analysis only:
// the node has no outputs and never reaches the speakers.
class HumTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.hop = options.processorOptions.hop;
    this.buf = new Float32Array(this.hop);
    this.n = 0;
    this.stopped = false;
    this.port.onmessage = (event) => { if (event.data === "stop") this.stopped = true; };
  }

  process(inputs) {
    if (this.stopped) return false;
    const samples = inputs[0]?.[0];
    if (!samples) return true; // input not connected yet
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.n++] = samples[i];
      if (this.n === this.hop) {
        // endFrame: audio-clock index just past the newest sample in this hop.
        this.port.postMessage({ samples: this.buf, endFrame: currentFrame + i + 1 }, [this.buf.buffer]);
        this.buf = new Float32Array(this.hop);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("hum-tap", HumTap);
