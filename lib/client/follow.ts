"use client";

import type { Seg } from "../news-model";

// Read-along timing: where in a clip the voice really speaks, and how far into the text it has got.
// The voices start ~0.3 s in, stop at commas for 0.2-0.5 s and say 気象庁 (3 characters) as 7 sounds,
// so spreading the characters evenly over the clip ran ahead and then fell behind.

// Seconds into the clip: the first and last sound, and the quiet stretches between.
export type Speech = { from: number; to: number; gaps: [number, number][] };

const WIN = 0.01;
const MIN_GAP = 0.12;

let ctx: BaseAudioContext | null = null;
function decoder() {
  if (ctx) return ctx;
  const W = window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Off = W.OfflineAudioContext ?? W.webkitOfflineAudioContext;
  if (!Off) return null;
  ctx = new Off(1, 1, 24000);
  return ctx;
}

export async function speechOf(buf: ArrayBuffer): Promise<Speech | null> {
  try {
    const c = decoder();
    if (!c) return null;
    const audio = await new Promise<AudioBuffer>((ok, no) => {
      const p = c.decodeAudioData(buf.slice(0), ok, no);
      if (p) p.then(ok, no);
    });
    const d = audio.getChannelData(0);
    const step = Math.max(1, Math.round(audio.sampleRate * WIN));
    const rms: number[] = [];
    for (let i = 0; i < d.length; i += step) {
      let s = 0;
      const end = Math.min(d.length, i + step);
      for (let k = i; k < end; k++) s += d[k] * d[k];
      rms.push(Math.sqrt(s / (end - i)));
    }
    const peak = Math.max(...rms);
    if (!peak) return null;
    const loud = rms.map((r) => r > Math.max(0.006, peak * 0.05));
    const first = loud.indexOf(true);
    const last = loud.lastIndexOf(true);
    if (first < 0) return null;
    const gaps: [number, number][] = [];
    let q = -1;
    for (let i = first; i <= last; i++) {
      if (!loud[i] && q < 0) q = i;
      if (loud[i] && q >= 0) {
        if ((i - q) * WIN >= MIN_GAP) gaps.push([q * WIN, i * WIN]);
        q = -1;
      }
    }
    return { from: first * WIN, to: (last + 1) * WIN, gaps };
  } catch {
    return null;
  }
}

// About how many sounds (morae) each character takes: a word with its reading spreads the reading over
// its characters; small ゃゅょ join the one before; punctuation takes none.
const SMALL = /[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/;
const KANA = /[ぁ-ゖァ-ヺー]/;
const BREAK = /[、。，,！？!?　 ]/;
function charWeights(segs: Seg[]) {
  const w: number[] = [];
  const brk: boolean[] = [];
  for (const s of segs) {
    const chars = [...s.t];
    if (s.r) {
      const m = [...s.r].filter((c) => !SMALL.test(c)).length;
      for (const c of chars) {
        w.push(m / chars.length);
        brk.push(BREAK.test(c));
      }
      continue;
    }
    for (const c of chars) {
      brk.push(BREAK.test(c));
      if (BREAK.test(c) || /[「」『』（）()・…]/.test(c)) w.push(0);
      else if (SMALL.test(c)) w.push(0);
      else if (KANA.test(c)) w.push(1);
      else if (/[0-9０-９]/.test(c)) w.push(1.6);
      else if (/[A-Za-zＡ-Ｚａ-ｚ]/.test(c)) w.push(1.2);
      else w.push(2);
    }
  }
  return { w, brk };
}

// How many characters of segs (fractional) have been said sec seconds into the clip. Without a
// measured speech, frac of the clip (the old even spread).
export function fillOf(segs: Seg[], speech: Speech | null | undefined, sec: number, frac: number) {
  const { w, brk } = charWeights(segs);
  const n = w.length;
  if (!speech) return frac * n;
  const W = w.reduce((a, b) => a + b, 0);
  if (!W) return frac * n;
  if (sec >= speech.to) return n;
  if (sec <= speech.from) return 0;
  // Where each clause ends (in weight), and which pause the voice took there: an order-keeping match
  // of clause ends to pauses, each pause near where an even pace would put that end.
  const ends: number[] = [];
  let cum = 0;
  for (let k = 0; k < n; k++) {
    cum += w[k];
    if (brk[k] && cum > 0 && cum < W && ends[ends.length - 1] !== cum) ends.push(cum);
  }
  const G = speech.gaps;
  const span = speech.to - speech.from;
  const at = (b: number) => speech.from + (b / W) * span;
  const SKIP = 0.7;
  const B = ends.length;
  const cost: number[][] = Array.from({ length: B + 1 }, () => new Array(G.length + 1).fill(Infinity));
  const how: number[][] = Array.from({ length: B + 1 }, () => new Array(G.length + 1).fill(0));
  cost[0][0] = 0;
  for (let i = 0; i <= B; i++)
    for (let g = 0; g <= G.length; g++) {
      const c = cost[i][g];
      if (c === Infinity) continue;
      if (g < G.length && c < cost[i][g + 1]) ((cost[i][g + 1] = c), (how[i][g + 1] = 1)); // pause inside a clause
      if (i < B && c + SKIP < cost[i + 1][g]) ((cost[i + 1][g] = c + SKIP), (how[i + 1][g] = 2)); // clause end without a pause
      if (i < B && g < G.length) {
        const d = c + Math.abs(at(ends[i]) - (G[g][0] + G[g][1]) / 2);
        if (d < cost[i + 1][g + 1]) ((cost[i + 1][g + 1] = d), (how[i + 1][g + 1] = 3));
      }
    }
  // Anchors (weight, time) through the matched pauses; the weight holds still while the voice pauses.
  const anchors: [number, number][] = [[W, speech.to]];
  for (let i = B, g = G.length; i > 0 || g > 0; ) {
    const h = how[i][g];
    if (h === 1) g--;
    else if (h === 2) i--;
    else {
      anchors.push([ends[i - 1], G[g - 1][1]], [ends[i - 1], G[g - 1][0]]);
      i--;
      g--;
    }
  }
  anchors.push([0, speech.from]);
  anchors.reverse();
  let done = W;
  for (let k = 1; k < anchors.length; k++) {
    const [w0, t0] = anchors[k - 1];
    const [w1, t1] = anchors[k];
    if (sec > t1) continue;
    done = t1 > t0 ? w0 + ((sec - t0) / (t1 - t0)) * (w1 - w0) : w1;
    break;
  }
  // Weight back to characters.
  let k = 0;
  let c = 0;
  while (k < n && c + w[k] <= done) c += w[k++];
  return k >= n ? n : k + (w[k] ? (done - c) / w[k] : 0);
}
