"use client";

import { closeness, type Kind } from "./fx";
import type { SttResult } from "./recorder";
import { seedKey, type DrillStep, type Ladder } from "@/lib/drill-model";

// 型ドリル on the phone: the ladder asked for, what was said judged at once (no AI wait), and the words
// practised kept with how fast they came by the end.

export async function loadLadder(seed: string, fresh = false): Promise<Ladder> {
  const res = await fetch("/api/kata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed, fresh }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "出题失败");
  return data as Ladder;
}

// Said vs the step's sentence: by the letters (kanji or kana, whichever the recogniser wrote), and by
// Azure's check against the sentence when the letters differ only in how they are written.
export function judge(r: SttResult, step: DrillStep): Kind {
  const c = Math.max(closeness(r.text, step.ja), step.kana ? closeness(r.text, step.kana) : 0);
  const s = r.scores;
  const sounded = !!s && s.completeness >= 85 && s.accuracy >= 70;
  if (c >= 0.85 || (sounded && c >= 0.5)) return "right";
  if (c >= 0.6 || (!!s && s.completeness >= 70 && c >= 0.35)) return "close";
  return "wrong";
}

// What changed from the step before: [same start, changed, same end].
export function diff(prev: string, cur: string): [string, string, string] {
  if (!prev) return ["", cur, ""];
  let a = 0;
  while (a < prev.length && a < cur.length && prev[a] === cur[a]) a++;
  let b = 0;
  while (b < prev.length - a && b < cur.length - a && prev[prev.length - 1 - b] === cur[cur.length - 1 - b]) b++;
  // Changing only the punctuation is no change worth showing: mark the whole sentence.
  const mid = cur.slice(a, cur.length - b);
  if (!mid.replace(/[。、！？\s]/g, "")) return ["", cur, ""];
  return [cur.slice(0, a), mid, cur.slice(cur.length - b)];
}

// Fast enough to be automatic: speaking began within this of the cue.
export const FAST_MS = 3000;

// ---- Words practised ----

export type Seed = { seed: string; meaning: string; plays: number; fast: number; total: number; last: number };
const KEY = "nihongo-speak:drill-seeds";

export function readSeeds(): Seed[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Seed[];
    return Array.isArray(list) ? list.sort((a, b) => b.last - a.last) : [];
  } catch {
    return [];
  }
}

// After a round: the best number said fast in a speed round is kept.
export function saveSeed(l: Ladder, fast: number | null, at: number) {
  const list = readSeeds();
  const key = seedKey(l.seed);
  const old = list.find((s) => seedKey(s.seed) === key);
  const next: Seed = {
    seed: l.seed,
    meaning: l.meaning_zh,
    plays: (old?.plays ?? 0) + (fast === null ? 1 : 0),
    fast: Math.max(old?.fast ?? 0, fast ?? 0),
    total: l.steps.length,
    last: at,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify([next, ...list.filter((s) => seedKey(s.seed) !== key)].slice(0, 40)));
  } catch {}
}

export const STARTERS = ["食べる", "行く", "〜てしまう", "〜たい"];
