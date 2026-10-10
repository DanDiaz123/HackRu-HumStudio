"use client";

import { useEffect, useRef } from "react";
import { hzToMidi, octaveShift } from "@/lib/generate";
import { BIN_COUNT, F_HI, F_LO, type HumFrame } from "@/lib/hum";
import { type Instrument, TOTAL_BEATS, pitchRows } from "@/lib/tracks";

const CELL = 7; // halftone screen pitch in CSS px
const COL = 3; // time resolution of the sampled field in CSS px
const ANGLE = Math.PI / 4; // 45° screen, like a printed sleeve photo
const INK = "#0d0d0d";
const MIDI_LO = hzToMidi(F_LO);
const MIDI_HI = hzToMidi(F_HI);

/**
 * The hum, printed as black halftone dots on the flooded lane.
 * Melodic lanes share the notes' pitch axis (same octave shift as generate.ts), so notes land on their dots.
 */
export default function Spectrogram({
  frames,
  bpm,
  live,
  inst,
}: {
  frames: HumFrame[];
  bpm: number;
  live: boolean;
  inst: Instrument;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!frames.length || !w || !h) return;

      // Field: max magnitude per (time column, bin).
      const cols = Math.ceil(w / COL) + 1;
      const pxPerSec = ((bpm / 60) / TOTAL_BEATS) * w;
      const field = new Float32Array(cols * BIN_COUNT);
      // Melodic lanes print around the detected fundamental so harmonics don't land where no note will.
      const binsPerSemi = (BIN_COUNT - 1) / (MIDI_HI - MIDI_LO);
      for (const f of frames) {
        const c = Math.floor((f.tSec * pxPerSec) / COL);
        if (c >= cols) break;
        const fb = f.hz ? (hzToMidi(f.hz) - MIDI_LO) * binsPerSemi : -1;
        for (let b = 0; b < BIN_COUNT; b++) {
          const d = (b - fb) / binsPerSemi; // semitones from the fundamental
          const v = inst.kind === "drums" ? f.bins[b] : f.hz ? f.bins[b] * Math.exp(-(d * d) / 12) : 0;
          const i = c * BIN_COUNT + b;
          if (v > field[i]) field[i] = v;
        }
      }
      const lastCol = Math.min(cols - 1, Math.floor((frames[frames.length - 1].tSec * pxPerSec) / COL));

      // y (px) -> fractional bin, through the lane's pitch axis.
      const drums = inst.kind === "drums";
      const rows = pitchRows(inst);
      const shift = drums ? 0 : octaveShift(inst, frames.flatMap((f) => (f.hz ? [Math.round(hzToMidi(f.hz))] : [])));
      const binAt = (y: number) => {
        if (drums) return (1 - y / h) * (BIN_COUNT - 1);
        const midi = inst.hi + 0.5 - (y / h) * rows - shift;
        return ((midi - MIDI_LO) / (MIDI_HI - MIDI_LO)) * (BIN_COUNT - 1);
      };
      const sample = (x: number, y: number) => {
        const cx = x / COL;
        const by = binAt(y);
        if (cx < 0 || cx > lastCol || by < 0 || by > BIN_COUNT - 1) return 0;
        const c0 = Math.floor(cx), b0 = Math.floor(by);
        const c1 = Math.min(lastCol, c0 + 1), b1 = Math.min(BIN_COUNT - 1, b0 + 1);
        const tx = cx - c0, ty = by - b0;
        const at = (c: number, b: number) => field[c * BIN_COUNT + b];
        return (at(c0, b0) * (1 - tx) + at(c1, b0) * tx) * (1 - ty) + (at(c0, b1) * (1 - tx) + at(c1, b1) * tx) * ty;
      };

      // Rotated screen: walk lattice points covering the canvas.
      const cos = Math.cos(ANGLE), sin = Math.sin(ANGLE);
      const reach = Math.ceil(Math.hypot(w, h) / CELL);
      ctx.fillStyle = INK;
      ctx.beginPath();
      for (let i = -reach; i <= reach; i++) {
        for (let j = -reach; j <= reach; j++) {
          const x = (i * cos - j * sin) * CELL;
          const y = (i * sin + j * cos) * CELL;
          if (x < 0 || x > w || y < 0 || y > h) continue;
          const v = sample(x, y);
          if (v < 0.14) continue;
          const rad = (CELL / 2) * Math.min(1.05, v * 1.15);
          ctx.moveTo(x + rad, y);
          ctx.arc(x, y, rad, 0, Math.PI * 2);
        }
      }
      ctx.fill();

      if (live) {
        ctx.fillRect(Math.min(w, frames[frames.length - 1].tSec * pxPerSec) - 1, 0, 2, h);
        raf = requestAnimationFrame(draw);
      }
    };

    draw();
    const ro = new ResizeObserver(() => !live && draw());
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [frames, bpm, live, inst]);

  return <canvas ref={ref} className="spectrogram" aria-hidden />;
}
