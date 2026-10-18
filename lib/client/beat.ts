"use client";

import { audioCtx, currentAudio, renewAudio } from "./audio";
import { setAudioSession } from "./recorder";

// Music and sounds for the 今日 连播: a little four-chord dance track under the voice (kick, hats,
// clap, bass and a plucked arpeggio), a thud when a card lands, a ping when its meaning shows.
// All synthesized with Web Audio, nothing to download. Best-effort.

let noise: AudioBuffer | null = null;

// The app's shared context (see audio.ts): renewed after the app has been in the background.
const ac = audioCtx;

function env(c: AudioContext, t: number, vol: number, len: number) {
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  gain.connect(c.destination);
  return gain;
}

function kick(c: AudioContext, t: number, vol: number) {
  const osc = c.createOscillator();
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.14);
  osc.connect(env(c, t, vol, 0.24));
  osc.start(t);
  osc.stop(t + 0.26);
}

function hiss(c: AudioContext, t: number, vol: number, len: number, freq: number) {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate * 0.3, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = freq > 4000 ? "highpass" : "bandpass";
  f.frequency.value = freq;
  src.connect(f).connect(env(c, t, vol, len));
  src.start(t);
  src.stop(t + len + 0.02);
}

function note(c: AudioContext, t: number, freq: number, vol: number, len: number, type: OscillatorType) {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(env(c, t, vol, len));
  osc.start(t);
  osc.stop(t + len + 0.02);
}

// C – G – Am – F, a bar each: bass root, then the chord as an arpeggio.
const ROOTS = [65.41, 98.0, 110.0, 87.31];
const CHORDS = [
  [523.25, 659.25, 783.99],
  [493.88, 587.33, 783.99],
  [523.25, 659.25, 880.0],
  [523.25, 698.46, 880.0],
];

export type BeatMode = "calm" | "wild";
export const BPM: Record<BeatMode, number> = { calm: 104, wild: 148 };

// A loop that keeps going until stopped. "wild" is faster and fuller: kick on every beat with a
// clap on two and four, sixteenth hats, an octave-jumping bass and a riser every four bars.
export function startBeat(mode: BeatMode = "calm"): () => void {
  let c: AudioContext;
  try {
    c = ac();
  } catch {
    return () => {};
  }
  const wild = mode === "wild";
  const beat = 60 / BPM[mode];
  const v = wild ? 1 : 0.7;
  let next = c.currentTime + 0.05;
  let n = 0; // eighth notes
  const timer = setInterval(() => {
    // The context was replaced (after the app came back from the background): carry on in the new one.
    const now = currentAudio();
    if (now && now !== c) {
      c = now;
      next = c.currentTime + 0.05;
    }
    if (c.state !== "running") {
      void c.resume().catch(() => {});
      next = c.currentTime + 0.05;
      return;
    }
    while (next < c.currentTime + 0.25) {
      const t = next;
      const bar = Math.floor(n / 8) % 4;
      const inBar = n % 8;
      if (inBar % 2 === 0) kick(c, t, (inBar === 0 ? 0.34 : 0.24) * v);
      if (wild && (inBar === 2 || inBar === 6)) hiss(c, t, 0.12, 0.12, 1500);
      hiss(c, inBar % 2 ? t : t + beat / 4, 0.035 * v, 0.04, 8000);
      if (wild) hiss(c, t + beat / 4, 0.025, 0.03, 9000);
      // Bass on the off-beats, an octave up every other one when wild.
      if (inBar % 2 === 1) note(c, t, ROOTS[bar] * (wild && inBar % 4 === 3 ? 2 : 1), 0.12 * v, beat * 0.45, "sawtooth");
      const chord = CHORDS[bar];
      note(c, t, chord[inBar % 3] * (inBar >= 6 ? 2 : 1) / 2, 0.025 * v, beat * 0.4, "triangle");
      // A rising whoosh into every fourth bar.
      if (wild && n % 32 === 24) {
        const osc = c.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(1600, t + beat * 4);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.03, t + beat * 4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 4 + 0.05);
        osc.connect(g).connect(c.destination);
        osc.start(t);
        osc.stop(t + beat * 4 + 0.1);
      }
      next += beat / 2;
      n++;
    }
  }, 50);
  return () => clearInterval(timer);
}

function tone(freqs: number[], step: number, vol: number, len = 0.3, type: OscillatorType = "triangle") {
  try {
    const c = ac();
    freqs.forEach((f, i) => note(c, c.currentTime + i * step, f, vol, len, type));
  } catch {}
}

export const thud = () => tone([110, 70], 0.03, 0.35, 0.25, "sine");
export const ping = () => tone([1175, 1568], 0.06, 0.08, 0.25);
export const buzz = () => tone([220, 208], 0.12, 0.09, 0.22, "square");
export const fanfare = () => tone([523, 659, 784, 1047, 784, 1047], 0.11, 0.12, 0.35);
export const hey = () => {
  try {
    const c = ac();
    hiss(c, c.currentTime, 0.25, 0.15, 1200);
    note(c, c.currentTime, 880, 0.08, 0.12, "square");
  } catch {}
};

// Call from the tap that opens the 连播: iPhone only lets sound start from a tap, and Web Audio
// follows the ring/silent switch unless the session is set to playback.
export function primeBeat() {
  setAudioSession("playback");
  renewAudio();
}
