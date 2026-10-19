"use client";

// Quiet music for the pause between two tellings of 三回話す, so the wait isn't dead silence.
// Slow, soft and wordless (lib/radio-music.ts "pause"): a voice or a tune to follow would compete
// with the Japanese still in the learner's head. It fades in, dips under any voice the app plays,
// and fades out before the mic opens again. Copies of the clip overlap by a few seconds so the loop
// has no seam, and it stops by itself after a couple of minutes.

import { audioCtx } from "./audio";
import { onSound } from "./player";

const SRC = "/api/radio-music/pause";
const LEVEL = 0.2;
const DUCKED = 0.06;
const OVERLAP = 3;
const LONGEST = 150;

let clip: Promise<AudioBuffer | null> | null = null;
let out: { ctx: AudioContext; gain: GainNode; srcs: AudioBufferSourceNode[] } | null = null;
let turn = 0;
let loud = true;

export function loadPause() {
  clip ??= fetch(SRC)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => new OfflineAudioContext(2, 1, 44100).decodeAudioData(b))
    .catch(() => {
      clip = null;
      return null;
    });
  return clip;
}

function level(to: number, sec: number) {
  if (!out) return;
  const g = out.gain.gain;
  const t = out.ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(Math.max(g.value, 0.0001), t);
  g.exponentialRampToValueAtTime(Math.max(to, 0.0001), t + sec);
}

if (typeof window !== "undefined") {
  onSound((on) => {
    loud = !on;
    level(loud ? LEVEL : DUCKED, loud ? 1.2 : 0.3);
  });
}

export async function startPause() {
  stopPause(0);
  const mine = ++turn;
  const b = await loadPause();
  if (!b || mine !== turn) return;
  let ctx: AudioContext;
  try {
    ctx = audioCtx();
  } catch {
    return;
  }
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(loud ? LEVEL : DUCKED, t0 + 2.5);
  gain.gain.setValueAtTime(loud ? LEVEL : DUCKED, t0 + LONGEST - 4);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + LONGEST);
  const step = Math.max(OVERLAP + 1, b.duration - OVERLAP);
  const srcs: AudioBufferSourceNode[] = [];
  for (let at = t0; at < t0 + LONGEST; at += step) {
    const src = ctx.createBufferSource();
    src.buffer = b;
    const fade = ctx.createGain();
    if (at > t0) {
      fade.gain.setValueAtTime(0.0001, at);
      fade.gain.linearRampToValueAtTime(1, at + OVERLAP);
    }
    fade.gain.setValueAtTime(1, at + b.duration - OVERLAP);
    fade.gain.linearRampToValueAtTime(0.0001, at + b.duration);
    src.connect(fade).connect(gain);
    src.start(at);
    src.stop(at + b.duration);
    srcs.push(src);
  }
  out = { ctx, gain, srcs };
}

// Fades out over `sec` seconds; resolves once it is silent.
export function stopPause(sec = 0.6) {
  turn++;
  const o = out;
  out = null;
  if (!o) return Promise.resolve();
  const t = o.ctx.currentTime;
  const g = o.gain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(Math.max(g.value, 0.0001), t);
  g.exponentialRampToValueAtTime(0.0001, t + Math.max(sec, 0.02));
  return new Promise<void>((resolve) =>
    setTimeout(() => {
      for (const s of o.srcs) {
        try {
          s.stop();
        } catch {}
      }
      o.gain.disconnect();
      resolve();
    }, sec * 1000 + 30),
  );
}
