"use client";

import { bare, closeness, type Kind } from "./fx";
import type { SttResult } from "./recorder";
import { CHAINED, TIERS, replyPass, seedKey, tierOf, type DrillReply, type DrillStep, type Ladder } from "@/lib/drill-model";
import { BUILD_ITEMS, FORM_ITEMS, PATH_ITEMS, type PathItem } from "@/content/drill-path";
import { dayKey } from "@/lib/progress-model";

// 型ドリル on the phone: the ladder asked for, what was said judged at once (no AI wait), and the words
// practised kept with how fast they came by the end.

async function fetchLadder(seed: string, fresh: boolean, tier: number, replies = false): Promise<Ladder> {
  const ask = () => fetch("/api/kata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed, fresh, tier, ...(replies ? { replies } : {}) }) });
  // The connection cut (screen locked while it was being made): the server kept the ladder, so asking
  // once more gets it at once.
  const res = await ask().catch(() => new Promise<Response>((ok) => setTimeout(ok, 1500)).then(ask)).catch(() => null);
  if (!res) throw new Error("连不上，再试一次");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "出题失败");
  return data as Ladder;
}

// Ladders asked for (or made ahead) in this visit, so a tap while one is still on its way waits for
// that one instead of making a second. 新しい文 (fresh) always asks anew.
const asked = new Map<string, Promise<Ladder>>();

export function loadLadder(seed: string, fresh = false, tier = 1): Promise<Ladder> {
  const k = `${seedKey(seed)}@${tier}`;
  const had = asked.get(k);
  if (had && !fresh) return had;
  // A 新しい文 replaces the kept ladder, here too: the next plain open gets the new one.
  const p = fetchLadder(seed, fresh, tier);
  asked.set(k, p);
  p.catch(() => asked.get(k) === p && asked.delete(k));
  return p;
}

// A ladder kept from before 返す: its rounds are written now (once; asked again only after a failure),
// and the ladder with them is the one kept for this visit.
const filling = new Map<string, Promise<Ladder>>();
export function withReplies(seed: string, l: Ladder): Promise<Ladder> {
  if (l.replies?.length) return Promise.resolve(l);
  const tier = tierOf(l);
  const k = `${seedKey(seed)}@${tier}#${l.made}`;
  const had = filling.get(k);
  if (had) return had;
  const p = fetchLadder(seed, false, tier, true).then((got) => {
    if (!got.replies?.length) throw new Error("出题失败");
    asked.set(`${seedKey(seed)}@${tier}`, Promise.resolve(got));
    return got;
  });
  filling.set(k, p);
  p.catch(() => filling.get(k) === p && filling.delete(k));
  return p;
}

// Made ahead while the learner looks at the done screen: the next tap starts at once.
export const prefetchLadder = (seed: string, tier = 1) => void loadLadder(seed, false, tier).catch(() => {});

// Hiragana only, for comparing readings: katakana folded, punctuation and spaces gone.
const hira = (s: string) => bare(s.normalize("NFKC")).replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

const near = (said: string, s: DrillStep) => Math.max(closeness(said, s.ja), s.kana ? closeness(hira(said), hira(s.kana)) : 0);

const KANA = /^[ぁ-ゖァ-ヶー]+$/;

// The one place this step changes, said as asked: 会社に for 会社で is 90% the same sentence but it is
// exactly the part being practised. Found by its letters or its reading, it was said. Not found, it
// counts as missed only when what was said still has the old part (with the kana right next to it, so
// 行きたい is caught when 行きたくない is wanted): the recogniser may just have written the new part
// another way (分かります for わかります, ご飯 for ごはん).
function changeSaid(said: string, step: DrillStep, prev: DrillStep) {
  const [a, mid, b] = diff(bare(prev.ja), bare(step.ja));
  if (!mid || mid === bare(step.ja)) return true;
  const s = bare(said.normalize("NFKC"));
  const h = hira(said);
  const l = KANA.test(a.slice(-1)) ? a.slice(-1) : "";
  const r = KANA.test(b.slice(0, 1)) ? b.slice(0, 1) : "";
  const has = (x: string) => !!x && (s.includes(x) || h.includes(hira(x)));
  if (has(KANA.test(mid) ? l + mid + r : mid)) return true;
  const [, kmid] = diff(hira(prev.kana), hira(step.kana));
  if (kmid && h.includes(kmid)) return true;
  const [, old] = diff(bare(step.ja), bare(prev.ja));
  return !has(KANA.test(old || "あ") ? l + old + r : old);
}

// A card that builds its sentence (組み立てる, 直す, つなぐ…): the part it practises (会議に, 作ると,
// 遅れていて) must be in what was said, by its letters or its reading.
function markSaid(said: string, step: DrillStep) {
  if (!step.mark) return true;
  const s = bare(said.normalize("NFKC"));
  const h = hira(said);
  return s.includes(bare(step.mark)) || h.includes(hira(step.mark)) || (!!step.mark_kana && h.includes(hira(step.mark_kana)));
}

// Said vs the step's sentence: by the letters (kanji or kana, whichever the recogniser wrote), and by
// the reading the recogniser gives (Gemini) or Azure's check against the sentence (until 2026-11-16)
// when the letters differ only in how they are written. Three things keep a near miss from passing as
// right: the kana ending must be the one asked for (食べます when 食べました is wanted), the changed
// part must be the one asked for, and saying the step before again (the change left out) isn't the answer.
export function judge(r: SttResult, step: DrillStep, prev?: DrillStep): Kind {
  const heardKana = r.kana ? hira(r.kana) : "";
  const nearR = (s: DrillStep) => Math.max(near(r.text, s), heardKana && s.kana ? closeness(heardKana, hira(s.kana)) : 0);
  const c = nearR(step);
  const s = r.scores;
  const sounded = !!s && s.completeness >= 85 && s.accuracy >= 70;
  let kind: Kind = c >= 0.85 || (sounded && c >= 0.5) ? "right" : c >= 0.6 || (!!s && s.completeness >= 70 && c >= 0.35) ? "close" : "wrong";
  if (kind === "right") {
    const end = hira(step.ja).match(/[ぁ-ゖー]{1,3}$/)?.[0] ?? "";
    const chained = CHAINED.includes(step.op);
    if (end && !hira(r.text).endsWith(end) && !heardKana.endsWith(end)) kind = "close";
    else if (chained && prev && nearR(prev) > c) kind = "close";
    // By the letters only: a reading has no kanji, so the old part (会社で) is never "still there" in it.
    else if (chained && prev && step.op !== "base" && !changeSaid(r.text, step, prev)) kind = "close";
    // The wrong sentence read out as it was shown: not fixed.
    else if (step.op === "fix" && step.parts?.[0] && closeness(r.text, step.parts[0]) > closeness(r.text, step.ja)) kind = "close";
    else if (!chained && !markSaid(r.text, step) && !(r.kana && markSaid(r.kana, step))) kind = "close";
  }
  return kind;
}

// ---- 返す ----

// An answer given in Chinese is judged like a card that builds its sentence: the letters, the ending,
// and the word or grammar point (mark) in it.
export const replyStep = (r: DrillReply): DrillStep => ({ lv: 0, op: "finish", cue: "", cue_zh: "", ja: r.ja, kana: r.kana, zh: r.zh, mark: r.mark, mark_kana: r.mark_kana });

// A question about the learner: 森先生 decides (the word or grammar point used, the sentence finished).
export type OwnCheck = { kind: Kind; better: string; fix_zh: string };
export async function checkOwn(seed: string, r: DrillReply, said: string): Promise<OwnCheck> {
  try {
    const res = await fetch("/api/kata/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed, ask: r.ask, said, ja: r.ja }) });
    const d = (await res.json()) as { used?: boolean; answered?: boolean; better?: string; fix_zh?: string };
    if (!res.ok || typeof d.used !== "boolean") throw new Error("judge");
    const better = (d.better ?? "").trim();
    // Made natural without a letter changed: nothing to show.
    const same = !better || bare(better) === bare(said);
    return { kind: d.used && d.answered ? "right" : d.used || d.answered ? "close" : "wrong", better: same ? "" : better, fix_zh: same ? "" : (d.fix_zh ?? "").trim() };
  } catch {
    // No answer from her: the word or grammar point heard in it is all that can be told here.
    const s = bare(said.normalize("NFKC"));
    const h = hira(said);
    const core = bare(seedKey(seed).split(/[・〜]/)[0]);
    const used = [r.mark, r.mark_kana, core].some((x) => x.length > 1 && (s.includes(bare(x)) || h.includes(hira(x))));
    return { kind: used ? "right" : "close", better: "", fix_zh: "" };
  }
}

// From the end of her line to the first sound of the answer: the ladder's pace, and a little more to
// think of something true to say.
export const replyFastMs = (r: DrillReply, tier = 1) => fastMs(r.ja, tier) + (r.own ? 1500 : 0);

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
// re: 返す rounds played on this ladder (the next one takes the other round). byRe: a day here was earned
// in 返す, so the tier clears on its days alone (see cleared).
export type TierRun = { fast: number; total: number; made: number; days?: string[]; re?: number; byRe?: boolean };
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
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 300)));
  } catch {}
}

export const findSeed = (list: Seed[], seed: string) => list.find((s) => seedKey(s.seed) === seedKey(seed));

// Every sentence of this tier's ladder said fast at least once.
export const once = (s: Seed | undefined, tier = s?.tier ?? 1) => {
  const r = s?.tiers[tier];
  return !!r && r.total > 0 && r.fast >= r.total;
};

// Days it takes before 升级: on one day it can still be short-term memory; on a second, separate day it
// has stuck (successive relearning). A day is a 返す round passed: new sentences, answered on hearing
// 森先生. For a ladder with no 返す (made before it, and none could be written) it is a whole speed
// round said fast, as it was.
export const DAYS_TO_CLEAR = 2;
export const fastDays = (s: Seed | undefined, tier = s?.tier ?? 1) => s?.tiers[tier]?.days?.length ?? 0;

const clearedRun = (r: TierRun | undefined) => !!r && (r.days?.length ?? 0) >= DAYS_TO_CLEAR && (!!r.byRe || (r.total > 0 && r.fast >= r.total));
// Two separate days: its 升级 is open.
export const cleared = (s: Seed | undefined, tier = s?.tier ?? 1) => clearedRun(s?.tiers[tier]);

// Fast all through on an earlier day, not yet on a second: due for the check today.
export const dueAgain = (s: Seed | undefined, today = dayKey()) => {
  const days = s?.tiers[s.tier]?.days ?? [];
  return !!s && days.length > 0 && days.length < DAYS_TO_CLEAR && days[days.length - 1] < today;
};

// After a round. fast: how many were said fast in the speed round (null: the levels only).
// re: a 返す round, with how many of its lines were answered right.
export function saveSeed(l: Ladder, fast: number | null, at: number, typed = l.seed, re?: { right: number; total: number }) {
  const list = readSeeds();
  const tier = tierOf(l);
  // Kept under what was typed or tapped (a path item), so its chip finds it again.
  const old = findSeed(list, typed) ?? findSeed(list, l.seed);
  const was = old?.tiers[tier];
  const same = was?.made === l.made;
  const today = dayKey();
  const days = [...(was?.days ?? [])];
  // Today counts: its 返す round passed, or, on a ladder with no 返す, its speed round came fast all through.
  const passed = re ? re.right >= replyPass(re.total) : !l.replies?.length && fast !== null && fast >= l.steps.length;
  if (passed && !days.includes(today)) days.push(today);
  const run: TierRun = {
    fast: Math.max(same ? was!.fast : 0, fast ?? 0),
    total: l.steps.length,
    made: l.made,
    days: days.slice(-5),
    re: (same ? (was!.re ?? 0) : 0) + (re ? 1 : 0),
    byRe: !!was?.byRe || (!!re && passed),
  };
  // Two days: its 升级 opens, so the chip and the next-up card lead there.
  const up = clearedRun(run) ? tier + 1 : tier;
  const next: Seed = {
    seed: old?.seed ?? typed,
    meaning: l.meaning_zh,
    tier: Math.min(TIERS, Math.max(old?.tier ?? 1, up)),
    tiers: { ...(old?.tiers ?? {}), [tier]: run },
    plays: (old?.plays ?? 0) + (fast === null && !re ? 1 : 0),
    last: at,
  };
  writeSeeds([next, ...list.filter((s) => s !== old)]);
}

// The 返す round to play now: the one not played yet on this ladder, taking turns after that.
export const replyRound = (l: Ladder, s: Seed | undefined): DrillReply[] | null => {
  const n = l.replies?.length ?? 0;
  if (!n) return null;
  const run = s?.tiers[tierOf(l)];
  return l.replies![(run?.made === l.made ? (run.re ?? 0) : 0) % n];
};

// What to practise next: anything fast on an earlier day and due for its second check (on the list or
// typed by the learner, latest first), else, taking turns between the first list and the 組み立て one
// (a 組み立て one after anything else, a first-list one after a 組み立て one), the first never opened,
// else the first not yet cleared.
export function nextOnPath(list: Seed[]): PathItem | null {
  const due = list.find((s) => dueAgain(s));
  if (due) return PATH_ITEMS.find((p) => findSeed([due], p.seed)) ?? { seed: due.seed, zh: due.meaning };
  const first = (items: PathItem[]) => items.find((p) => !findSeed(list, p.seed)) ?? items.find((p) => !cleared(findSeed(list, p.seed)));
  const form = first(FORM_ITEMS);
  const build = first(BUILD_ITEMS);
  const last = list[0];
  const afterBuild = !!last && BUILD_ITEMS.some((p) => findSeed([last], p.seed));
  return (afterBuild ? form ?? build : build ?? form) ?? null;
}

// The sentence split for showing what this card practised: the change from the sentence before, or the
// part a building card is about.
export function marked(step: DrillStep, prev = ""): [string, string, string] {
  if (CHAINED.includes(step.op)) return diff(prev, step.ja);
  const at = step.mark ? step.ja.indexOf(step.mark) : -1;
  if (at < 0) return ["", step.ja, ""];
  return [step.ja.slice(0, at), step.mark!, step.ja.slice(at + step.mark!.length)];
}
