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
  tick: [{ f: 1800, at: 0, len: 0.025, type: "sine", vol: 0.04 }],
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

// ---- One verdict for every practice page ----
// right / close (meaning right, wording off) / wrong. Plays the sound, gives a tap of haptics, and counts
// today's run of right answers across all pages; the ピンポン climbs a semitone with each one in a row.
export type Kind = "right" | "close" | "wrong";

const STREAK_KEY = "nihongo-speak:streak";
type Streak = { day: string; n: number; best: number };
const MILESTONES = [3, 5, 10, 20, 30];

function today() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function readStreak(): Streak {
  try {
    const s = JSON.parse(localStorage.getItem(STREAK_KEY) ?? "null") as Streak | null;
    if (s && s.day === today()) return s;
  } catch {}
  return { day: today(), n: 0, best: 0 };
}

function saveStreak(s: Streak) {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(s));
  } catch {}
  window.dispatchEvent(new Event("nihongo-streak"));
}

function note(f: number, at: number, len: number, type: OscillatorType, vol: number) {
  const osc = ctx!.createOscillator();
  const gain = ctx!.createGain();
  const t = ctx!.currentTime + at;
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(gain).connect(ctx!.destination);
  osc.start(t);
  osc.stop(t + len + 0.05);
}

function tone(kind: Kind, step: number) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    if (kind === "right") {
      const up = 2 ** (Math.min(step, 7) / 12);
      note(1319 * up, 0, 0.16, "triangle", 0.14);
      note(1047 * up, 0.15, 0.45, "triangle", 0.14);
    } else if (kind === "close") {
      note(784, 0, 0.14, "sine", 0.16);
      note(988, 0.1, 0.14, "sine", 0.16);
      note(784, 0.2, 0.35, "sine", 0.12);
    } else {
      note(150, 0, 0.12, "square", 0.05);
      note(150, 0.17, 0.38, "square", 0.05);
    }
  } catch {}
}

// Android vibrates; iPhone Safari has no vibration API, but since iOS 18 toggling a switch input gives a
// system haptic tick, so a hidden one is clicked instead.
let haptic: HTMLLabelElement | null = null;
export function buzz(times = 1) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(times > 1 ? [30, 70, 30] : 18);
      return;
    }
    if (!haptic) {
      haptic = document.createElement("label");
      haptic.setAttribute("aria-hidden", "true");
      haptic.style.cssText = "position:fixed;left:-100px;top:0;opacity:0;pointer-events:none";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      haptic.appendChild(input);
      document.body.appendChild(haptic);
    }
    for (let i = 0; i < times; i++) setTimeout(() => haptic?.click(), i * 110);
  } catch {}
}

// Returns today's run after this answer, and whether it just reached a milestone worth a big stamp.
// quiet: nothing was said (gave up, peeked); the run ends without the buzzer.
// celebrate: false for pages (练一练) that cheer their own run.
export function verdict(kind: Kind, quiet = false, celebrate = true): { streak: number; milestone: boolean } {
  const s = readStreak();
  const n = kind === "right" ? s.n + 1 : 0;
  saveStreak({ day: s.day, n, best: Math.max(s.best, n) });
  if (quiet) return { streak: n, milestone: false };
  tone(kind, s.n);
  buzz(kind === "wrong" ? 2 : 1);
  const milestone = celebrate && kind === "right" && MILESTONES.includes(n);
  if (milestone) {
    setTimeout(() => sfx("combo"), 500);
    confetti(n >= 10 ? 90 : 50);
  }
  return { streak: n, milestone };
}

// Punctuation and spaces don't count when comparing what was said or built.
export const bare = (s: string) => s.replace(/[\s、。，,.!！?？「」『』・〜~…]/g, "");

// How much of the answer the learner said, by longest common subsequence (speech recognition writes
// kanji or kana as it likes, so a near miss still counts).
export function closeness(said: string, want: string) {
  const a = [...bare(said)];
  const b = [...bare(want)];
  if (!b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (const ca of a) {
    const cur = [0];
    for (let j = 0; j < b.length; j++) cur.push(ca === b[j] ? prev[j] + 1 : Math.max(prev[j + 1], cur[j]));
    prev = cur;
  }
  return prev[b.length] / Math.max(a.length, b.length);
}
