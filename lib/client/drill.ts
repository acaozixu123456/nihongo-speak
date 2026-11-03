"use client";

import { bare, closeness, type Kind } from "./fx";
import type { SttResult } from "./recorder";
import { TIERS, seedKey, tierOf, type DrillStep, type Ladder } from "@/lib/drill-model";
import { PATH_ITEMS } from "@/content/drill-path";
import { dayKey } from "@/lib/progress-model";

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

// Per word or grammar point: the highest tier opened (升级), and for each tier its ladder, the best
// number said fast in a speed round on it (a new ladder starts over), and the days a whole speed round
// at this tier came fast (any of its ladders).
export type TierRun = { fast: number; total: number; made: number; days?: string[] };
export type Seed = { seed: string; meaning: string; tier: number; tiers: Record<number, TierRun>; plays: number; last: number };
const KEY = "nihongo-speak:drill-seeds";

type Old = Partial<Seed> & { seed: string; fast?: number; total?: number; made?: number };

// Fast all through before days were kept (one session was enough then): counted as two days, so it
// stays cleared and isn't asked for again.
const legacy = (r: TierRun): TierRun =>
  r.days === undefined && r.total > 0 && r.fast >= r.total ? { ...r, days: ["0000-00-00", "0000-00-01"] } : r;

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
        tiers: Object.fromEntries(
          Object.entries(s.tiers ?? (s.total ? { 1: { fast: s.fast ?? 0, total: s.total, made: s.made ?? 0 } } : {})).map(([k, r]) => [k, legacy(r)]),
        ),
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

// Every sentence of this tier's ladder said fast at least once.
export const once = (s: Seed | undefined, tier = s?.tier ?? 1) => {
  const r = s?.tiers[tier];
  return !!r && r.total > 0 && r.fast >= r.total;
};

// Days a whole speed round at this tier has to come fast before 升级: on one day it can still be
// short-term memory; on a second, separate day it has stuck (successive relearning).
export const DAYS_TO_CLEAR = 2;
export const fastDays = (s: Seed | undefined, tier = s?.tier ?? 1) => s?.tiers[tier]?.days?.length ?? 0;

// Fast all through on two separate days: its 升级 is open.
export const cleared = (s: Seed | undefined, tier = s?.tier ?? 1) => once(s, tier) && fastDays(s, tier) >= DAYS_TO_CLEAR;

// Fast all through on an earlier day, not yet on a second: due for the check today.
export const dueAgain = (s: Seed | undefined, today = dayKey()) => {
  const days = s?.tiers[s.tier]?.days ?? [];
  return !!s && days.length > 0 && days.length < DAYS_TO_CLEAR && days[days.length - 1] < today;
};

// After a round. fast: how many were said fast in the speed round (null: the levels only).
export function saveSeed(l: Ladder, fast: number | null, at: number, typed = l.seed) {
  const list = readSeeds();
  const tier = tierOf(l);
  // Kept under what was typed or tapped (a path item), so its chip finds it again.
  const old = findSeed(list, typed) ?? findSeed(list, l.seed);
  const was = old?.tiers[tier];
  const same = was?.made === l.made;
  const today = dayKey();
  const days = [...(was?.days ?? [])];
  // This session's speed round came fast all through: today counts.
  if (fast !== null && fast >= l.steps.length && !days.includes(today)) days.push(today);
  const run = { fast: Math.max(same ? was!.fast : 0, fast ?? 0), total: l.steps.length, made: l.made, days: days.slice(-5) };
  // Fast all through on two days: its 升级 opens, so the chip and the next-up card lead there.
  const up = run.total > 0 && run.fast >= run.total && run.days.length >= DAYS_TO_CLEAR ? tier + 1 : tier;
  const next: Seed = {
    seed: old?.seed ?? typed,
    meaning: l.meaning_zh,
    tier: Math.min(TIERS, Math.max(old?.tier ?? 1, up)),
    tiers: { ...(old?.tiers ?? {}), [tier]: run },
    plays: (old?.plays ?? 0) + (fast === null ? 1 : 0),
    last: at,
  };
  writeSeeds([next, ...list.filter((s) => s !== old)]);
}

// What to practise next from the list: one fast on an earlier day and due for its second check, else the
// first never opened, else the first not yet cleared.
export function nextOnPath(list: Seed[]) {
  return (
    PATH_ITEMS.find((p) => dueAgain(findSeed(list, p.seed))) ??
    PATH_ITEMS.find((p) => !findSeed(list, p.seed)) ??
    PATH_ITEMS.find((p) => !cleared(findSeed(list, p.seed))) ??
    null
  );
}
