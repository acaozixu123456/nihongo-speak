"use client";

import { bare, closeness, type Kind } from "./fx";
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

// Hiragana only, for comparing readings: katakana folded, punctuation and spaces gone.
const hira = (s: string) => bare(s.normalize("NFKC")).replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

const near = (said: string, s: DrillStep) => Math.max(closeness(said, s.ja), s.kana ? closeness(hira(said), hira(s.kana)) : 0);

// Said vs the step's sentence: by the letters (kanji or kana, whichever the recogniser wrote), and by
// Azure's check against the sentence when the letters differ only in how they are written. Two things
// keep a near miss from passing as right: the kana ending must be the one asked for (食べます when
// 食べました is wanted), and saying the step before again (the change left out) isn't the answer.
export function judge(r: SttResult, step: DrillStep, prev?: DrillStep): Kind {
  const c = near(r.text, step);
  const s = r.scores;
  const sounded = !!s && s.completeness >= 85 && s.accuracy >= 70;
  let kind: Kind = c >= 0.85 || (sounded && c >= 0.5) ? "right" : c >= 0.6 || (!!s && s.completeness >= 70 && c >= 0.35) ? "close" : "wrong";
  if (kind === "right") {
    const end = hira(step.ja).match(/[ぁ-ゖー]{1,3}$/)?.[0] ?? "";
    if (end && !hira(r.text).endsWith(end)) kind = "close";
    else if (prev && near(r.text, prev) > c) kind = "close";
  }
  return kind;
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

// Fast enough to be automatic: speaking began within this of the card, a little more for a long sentence.
export const fastMs = (ja: string) => 2000 + 60 * ja.length;

// ---- Words practised ----

export type Seed = { seed: string; meaning: string; plays: number; fast: number; total: number; made: number; last: number };
const KEY = "nihongo-speak:drill-seeds";

export function readSeeds(): Seed[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Seed[];
    return Array.isArray(list) ? list.sort((a, b) => b.last - a.last) : [];
  } catch {
    return [];
  }
}

// After a round: the best number said fast in a speed round is kept, for this ladder (a new one starts over).
export function saveSeed(l: Ladder, fast: number | null, at: number) {
  const list = readSeeds();
  const key = seedKey(l.seed);
  const old = list.find((s) => seedKey(s.seed) === key);
  const same = old?.made === l.made;
  const next: Seed = {
    seed: l.seed,
    meaning: l.meaning_zh,
    plays: (old?.plays ?? 0) + (fast === null ? 1 : 0),
    fast: Math.max(same ? old!.fast : 0, fast ?? 0),
    total: l.steps.length,
    made: l.made,
    last: at,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify([next, ...list.filter((s) => seedKey(s.seed) !== key)].slice(0, 40)));
  } catch {}
}

export const STARTERS = ["食べる", "行く", "〜てしまう", "〜たい"];
