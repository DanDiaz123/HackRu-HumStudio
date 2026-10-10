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
    const drums = inst.kind === "drums";
    const rows = pitchRows(inst);
    const binsPerSemi = (BIN_COUNT - 1) / (MIDI_HI - MIDI_LO);
    const cos = Math.cos(ANGLE), sin = Math.sin(ANGLE);
    let raf = 0;
    // Incremental state: live takes grow `frames` in place, so only new frames are folded and only their strip repainted.
    let w = 0, h = 0, cols = 0, pxPerSec = 0;
    let field = new Float32Array(0); // max magnitude per (time column, bin)
    let folded = 0; // frames already in `field`
    let lastCol = -1;
    let shift = 0;
    let cursorX = -1; // last painted cursor x, or -1
    const midis: number[] = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / COL) + 1;
      pxPerSec = ((bpm / 60) / TOTAL_BEATS) * w;
      field = new Float32Array(cols * BIN_COUNT);
      folded = 0;
      lastCol = -1;
      midis.length = 0;
      cursorX = -1;
    };

    /** Fold frames[folded..] into the field; returns the first column touched (or Infinity). */
    const fold = () => {
      let first = Infinity;
      for (; folded < frames.length; folded++) {
        const f = frames[folded];
        if (f.hz) midis.push(Math.round(hzToMidi(f.hz)));
        const c = Math.floor((f.tSec * pxPerSec) / COL);
        if (c >= cols) continue;
        if (c < first) first = c;
        // Melodic lanes print around the detected fundamental so harmonics don't land where no note will.
        const fb = f.hz ? (hzToMidi(f.hz) - MIDI_LO) * binsPerSemi : -1;
        for (let b = 0; b < BIN_COUNT; b++) {
          const d = (b - fb) / binsPerSemi; // semitones from the fundamental
          const v = drums ? f.bins[b] : f.hz ? f.bins[b] * Math.exp(-(d * d) / 12) : 0;
          const i = c * BIN_COUNT + b;
          if (v > field[i]) field[i] = v;
        }
      }
      return first;
    };

    // y (px) -> fractional bin, through the lane's pitch axis.
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

    /** Clear and re-dot the strip x0..x1; dots centred just outside it are redrawn clipped, so seams match a full draw. */
    const paint = (x0: number, x1: number) => {
      x0 = Math.max(0, x0);
      x1 = Math.min(w, x1);
      if (x1 <= x0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0, h);
      ctx.clip();
      ctx.clearRect(x0, 0, x1 - x0, h);
      // Lattice indices (i, j) whose rotated points cover [x0 - CELL, x1 + CELL] × [0, h].
      const xa = (x0 - CELL) / CELL, xb = (x1 + CELL) / CELL, yb = h / CELL;
      const corners = [[xa, 0], [xb, 0], [xa, yb], [xb, yb]];
      const is = corners.map(([u, v]) => u * cos + v * sin);
      const js = corners.map(([u, v]) => -u * sin + v * cos);
      const iLo = Math.floor(Math.min(...is)), iHi = Math.ceil(Math.max(...is));
      const jLo = Math.floor(Math.min(...js)), jHi = Math.ceil(Math.max(...js));
      ctx.fillStyle = INK;
      ctx.beginPath();
      for (let i = iLo; i <= iHi; i++) {
        for (let j = jLo; j <= jHi; j++) {
          const x = (i * cos - j * sin) * CELL;
          const y = (i * sin + j * cos) * CELL;
          if (x < 0 || x > w || y < 0 || y > h || x < x0 - CELL || x > x1 + CELL) continue;
          const v = sample(x, y);
          if (v < 0.14) continue;
          const rad = (CELL / 2) * Math.min(1.05, v * 1.15);
          ctx.moveTo(x + rad, y);
          ctx.arc(x, y, rad, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      if (live && cursorX >= 0) ctx.fillRect(cursorX - 1, 0, 2, h);
      ctx.restore();
    };

    /** Bring the canvas up to date with `frames`; repaints everything when `full`. */
    const update = (full: boolean) => {
      if (!w || !h) return;
      const n = folded;
      const first = fold();
      if (!frames.length) return;
      const prevLast = lastCol;
      lastCol = Math.min(cols - 1, Math.floor((frames[frames.length - 1].tSec * pxPerSec) / COL));
      const prevShift = shift;
      shift = drums ? 0 : octaveShift(inst, midis);
      const prevCursor = cursorX;
      cursorX = live ? Math.min(w, frames[frames.length - 1].tSec * pxPerSec) : -1;
      if (full || shift !== prevShift || n === 0) {
        ctx.clearRect(0, 0, w, h);
        paint(0, w);
        return;
      }
      // Bilinear sampling reaches one column either side; the old cursor must be erased too.
      const c0 = Math.min(first, prevLast);
      let x0 = (c0 - 1) * COL;
      if (prevCursor >= 0) x0 = Math.min(x0, prevCursor - 2);
      paint(x0, Math.max((lastCol + 1) * COL, cursorX + 2));
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (frames.length !== folded) update(false);
    };

    resize();
    update(true);
    if (live) raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => {
      if (canvas.clientWidth === w && canvas.clientHeight === h) return;
      resize();
      update(true);
    });
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [frames, bpm, live, inst]);

  return <canvas ref={ref} className="spectrogram" aria-hidden />;
}
