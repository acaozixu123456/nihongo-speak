"use client";

// Sounds for the 今日 连播: a soft kick-and-hat loop under the voice, a thud when a card lands and a
// ping when its meaning shows. All synthesized with Web Audio, nothing to download. Best-effort.

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function ac() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx ??= new Ctx();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function kick(c: AudioContext, t: number, vol: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.25);
}

function hat(c: AudioContext, t: number, vol: number) {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate * 0.05, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noise;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const gain = c.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  src.connect(hp).connect(gain).connect(c.destination);
  src.start(t);
}

function tone(freqs: number[], step: number, vol: number, len = 0.3, type: OscillatorType = "triangle") {
  try {
    const c = ac();
    freqs.forEach((f, i) => {
      const t = c.currentTime + i * step;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + len + 0.05);
    });
  } catch {}
}

export const BPM = 104;
const BEAT = 60 / BPM;

// A loop that keeps going until stopped: kick on every beat, a hat between.
export function startBeat(): () => void {
  let c: AudioContext;
  try {
    c = ac();
  } catch {
    return () => {};
  }
  let next = c.currentTime + 0.05;
  let n = 0;
  const timer = setInterval(() => {
    while (next < c.currentTime + 0.2) {
      kick(c, next, n % 4 === 0 ? 0.32 : 0.2);
      hat(c, next + BEAT / 2, 0.05);
      next += BEAT;
      n++;
    }
  }, 50);
  return () => clearInterval(timer);
}

export const thud = () => tone([110, 70], 0.03, 0.35, 0.25, "sine");
export const ping = () => tone([1175, 1568], 0.06, 0.08, 0.25);
export const buzz = () => tone([220, 208], 0.12, 0.09, 0.22, "square");
export const fanfare = () => tone([523, 659, 784, 1047, 784, 1047], 0.11, 0.12, 0.35);

// Call from the tap that opens the 连播: iPhone only lets sound start from a tap.
export function primeBeat() {
  try {
    ac();
  } catch {}
}
