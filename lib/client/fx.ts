"use client";

// Small rewards: a soft chime and a burst of confetti. Both are best-effort.

let ctx: AudioContext | null = null;

export function chime(big = false) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    const notes = big ? [660, 880, 1320] : [880, 1320];
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const t = ctx!.currentTime + i * 0.09;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {}
}

const COLORS = ["#ff5a4f", "#ffd94a", "#7ce0ff", "#5ad35a", "#ffffff"];

export function confetti(count = 60) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("div");
  layer.className = "confetti";
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("i");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = COLORS[i % COLORS.length];
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    piece.style.animationDuration = `${1.2 + Math.random() * 0.9}s`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2600);
}

// 练一练 sounds, all made on the spot (no files to load).
type Note = { f: number; at: number; len: number; type?: OscillatorType; vol?: number; to?: number };
const SOUNDS: Record<string, Note[]> = {
  tap: [{ f: 520, at: 0, len: 0.06, type: "triangle", vol: 0.08 }],
  // ピンポーン and ブッブー, as on Japanese quiz shows.
  right: [
    { f: 1319, at: 0, len: 0.16, type: "triangle", vol: 0.14 },
    { f: 1047, at: 0.15, len: 0.45, type: "triangle", vol: 0.14 },
  ],
  wrong: [
    { f: 150, at: 0, len: 0.12, type: "square", vol: 0.05 },
    { f: 150, at: 0.17, len: 0.38, type: "square", vol: 0.05 },
  ],
  combo: [
    { f: 784, at: 0, len: 0.1, type: "square", vol: 0.05 },
    { f: 988, at: 0.07, len: 0.1, type: "square", vol: 0.05 },
    { f: 1319, at: 0.14, len: 0.1, type: "square", vol: 0.05 },
    { f: 1568, at: 0.21, len: 0.3, type: "square", vol: 0.05 },
  ],
  pair: [{ f: 988, at: 0, len: 0.14, type: "sine", vol: 0.1, to: 1319 }],
  win: [
    { f: 523, at: 0, len: 0.16, type: "triangle" },
    { f: 659, at: 0.14, len: 0.16, type: "triangle" },
    { f: 784, at: 0.28, len: 0.16, type: "triangle" },
    { f: 1047, at: 0.42, len: 0.5, type: "triangle" },
    { f: 1319, at: 0.42, len: 0.5, type: "sine", vol: 0.06 },
  ],
  stamp: [{ f: 140, at: 0, len: 0.18, type: "sine", vol: 0.25, to: 60 }],
};

export function sfx(name: keyof typeof SOUNDS) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    for (const n of SOUNDS[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + n.at;
      osc.type = n.type ?? "sine";
      osc.frequency.setValueAtTime(n.f, t);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t + n.len);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(n.vol ?? 0.12, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + n.len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + n.len + 0.05);
    }
  } catch {}
}
