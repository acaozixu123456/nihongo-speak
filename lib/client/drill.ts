"use client";

import { bare, closeness, type Kind } from "./fx";
import type { SttResult } from "./recorder";
import { TIERS, seedKey, tierOf, type DrillStep, type Ladder } from "@/lib/drill-model";
import { PATH_ITEMS } from "@/content/drill-path";

// 型ドリル on the phone: the ladder asked for, what was said judged at once (no AI wait), and the words
// practised kept with how fast they came by the end.

export async function loadLadder(seed: string, fresh = false, tier = 1): Promise<Ladder> {
  const res = await fetch("/api/kata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed, fresh, tier }) });
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

// Fast enough to be automatic: speaking began within this of the card, a little more for a long
// sentence and a little less in the 升级 ladders.
const TIER_PACE = [1, 1, 0.9, 0.8];
export const fastMs = (ja: string, tier = 1) => Math.round((2000 + 60 * ja.length) * (TIER_PACE[tier] ?? 0.8));

// ---- Words practised ----

// Per word or grammar point: the highest tier opened (升级), and for each tier its ladder and the best
// number said fast in a speed round on it (a new ladder starts over).
export type TierRun = { fast: number; total: number; made: number };
export type Seed = { seed: string; meaning: string; tier: number; tiers: Record<number, TierRun>; plays: number; last: number };
const KEY = "nihongo-speak:drill-seeds";

type Old = Partial<Seed> & { seed: string; fast?: number; total?: number; made?: number };

export function readSeeds(): Seed[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Old[];
    if (!Array.isArray(list)) return [];
    // Kept before 升级 existed: one ladder, tier 1.
    return list
      .filter((s) => s && typeof s.seed === "string")
      .map((s) => ({
        seed: s.seed,
        meaning: s.meaning ?? "",
        tier: s.tier ?? 1,
        tiers: s.tiers ?? (s.total ? { 1: { fast: s.fast ?? 0, total: s.total, made: s.made ?? 0 } } : {}),
        plays: s.plays ?? 0,
        last: s.last ?? 0,
      }))
      .sort((a, b) => b.last - a.last);
  } catch {
    return [];
  }
}

function writeSeeds(list: Seed[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 80)));
  } catch {}
}

export const findSeed = (list: Seed[], seed: string) => list.find((s) => seedKey(s.seed) === seedKey(seed));

// Every sentence of this tier's ladder said fast at least once: its 升级 is open.
export const cleared = (s: Seed | undefined, tier = s?.tier ?? 1) => {
  const r = s?.tiers[tier];
  return !!r && r.total > 0 && r.fast >= r.total;
};

// After a round. fast: how many were said fast in the speed round (null: the levels only).
export function saveSeed(l: Ladder, fast: number | null, at: number, typed = l.seed) {
  const list = readSeeds();
  const tier = tierOf(l);
  // Kept under what was typed or tapped (a path item), so its chip finds it again.
  const old = findSeed(list, typed) ?? findSeed(list, l.seed);
  const was = old?.tiers[tier];
  const same = was?.made === l.made;
  const next: Seed = {
    seed: old?.seed ?? typed,
    meaning: l.meaning_zh,
    tier: Math.max(old?.tier ?? 1, tier),
    tiers: { ...(old?.tiers ?? {}), [tier]: { fast: Math.max(same ? was!.fast : 0, fast ?? 0), total: l.steps.length, made: l.made } },
    plays: (old?.plays ?? 0) + (fast === null ? 1 : 0),
    last: at,
  };
  writeSeeds([next, ...list.filter((s) => s !== old)]);
}

// 升级: the next tier opened for this one.
export function openTier(seed: string, tier: number, at: number) {
  const list = readSeeds();
  const old = findSeed(list, seed);
  if (!old) return;
  writeSeeds([{ ...old, tier: Math.min(TIERS, Math.max(old.tier, tier)), last: at }, ...list.filter((s) => s !== old)]);
}

// What to practise next from the list: the first never opened, else the first not yet fast all through.
export function nextOnPath(list: Seed[]) {
  return PATH_ITEMS.find((p) => !findSeed(list, p.seed)) ?? PATH_ITEMS.find((p) => !cleared(findSeed(list, p.seed))) ?? null;
}
