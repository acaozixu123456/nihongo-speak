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

const COLORS = ["#f97316", "#facc15", "#22c55e", "#3b82f6", "#ec4899"];

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
