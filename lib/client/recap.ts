"use client";

import { addDays, dayKey, type Learned, type LearnedSrc, type Progress } from "@/lib/progress-model";
import { RADIO_VOICE, skillKey } from "./progress";

// 今日: everything learned or practised over a few days, from every corner of the app, in one list.
// Episodes, the diary, weak points and 摸鱼 replays carry their own dates; 练一练, review, 瞬间说
// and shadowing are noted per day as they happen (DayStats.learned).

// say: what to read out (the example, for a grammar point).
// point: set on a grammar point, which the 连播 shows as one short example sentence instead of the
// pattern; seed is the learner's own corrected sentence, the first choice for that example.
export type RecapItem = Learned & { say: string; point?: { pattern: string; zh: string; seed?: string; ex?: Example } };
export type Example = { ja: string; zh: string };

export const SRC_JA: Record<LearnedSrc, string> = {
  radio: "电台",
  game: "练习",
  review: "复习",
  quick: "马上说",
  scene: "场景",
  weak: "弱项",
  diary: "日记",
  stuck: "默念",
};

export function recapDays(n: number, today = dayKey()) {
  return Array.from({ length: n }, (_, i) => addDays(today, -i));
}

export function recap(p: Progress, days: string[]): RecapItem[] {
  const inRange = new Set(days);
  const out: RecapItem[] = [];
  // A word written only in kanji is said from its reading: TTS can take bare kanji for Chinese.
  const add = (it: Learned, say = it.ja, point?: RecapItem["point"]) =>
    it.ja &&
    out.push({ voice: RADIO_VOICE.A, ...it, say: say === it.ja && it.kana && !/[\u3040-\u30ff]/.test(it.ja) ? it.kana : say, point });
  // A weak point, found by its pattern or tag: its latest corrected sentence, or a drill line that has a translation.
  const weakBy = new Map(Object.values(p.weak).map((w) => [w.pattern ?? w.tag, w]));
  const weakPoint = (ja: string, zh: string): RecapItem["point"] => {
    const w = weakBy.get(ja);
    const d = w?.drill?.[0];
    return { pattern: ja, zh, seed: w?.examples[0]?.better, ex: d && !w?.examples[0] ? { ja: d.ja, zh: d.zh } : undefined };
  };

  for (const ep of p.episodes.filter((e) => inRange.has(e.date))) {
    for (const w of ep.words ?? []) add({ ja: w.ja, kana: w.kana, zh: w.zh, src: "radio" });
    for (const g of ep.grammar ?? []) add({ ja: g.pattern, zh: g.zh, src: "radio" }, g.ja, { pattern: g.pattern, zh: g.zh, seed: g.ja });
    for (const x of ep.phrases) add({ ja: x.ja, zh: x.zh, src: "radio" });
    for (const x of ep.asked ?? []) add({ ja: x.text, zh: x.meaning_zh, src: "radio" });
  }
  for (const day of [...days].reverse()) {
    const s = p.stats[day];
    for (const l of s?.learned ?? []) {
      const pt = l.src === "weak" ? weakPoint(l.ja, l.zh) : undefined;
      add(l, pt?.seed ?? l.ja, pt);
    }
    for (const l of s?.stuck ?? []) add({ ja: l.ja, kana: l.reading, zh: l.zh, src: "stuck", voice: l.voice });
  }
  for (const w of Object.values(p.weak).filter((w) => inRange.has(w.last))) {
    const better = w.examples[0]?.better;
    const ja = w.pattern ?? w.tag;
    add({ ja, zh: w.zh, src: "weak", miss: !!w.lastMiss && inRange.has(w.lastMiss) }, better ?? ja, weakPoint(ja, w.zh));
  }
  for (const d of p.diary.filter((d) => inRange.has(d.date))) {
    for (const n of d.natural) add({ ja: n.ja, kana: n.kana, zh: n.zh, src: "diary" });
    for (const c of d.corrections) add({ ja: c.better, zh: c.why_zh, src: "diary", miss: true });
  }

  // The same thing met in two places is one item, missed if it was missed anywhere.
  const seen = new Map<string, RecapItem>();
  for (const it of out) {
    const k = skillKey(it.ja);
    const o = seen.get(k);
    if (!o) seen.set(k, it);
    else if ((it.miss && !o.miss) || (it.point && !o.point)) seen.set(k, { ...o, miss: o.miss || it.miss, point: o.point ?? it.point, say: o.point ? o.say : it.say });
  }
  return [...seen.values()];
}

// The order the 连播 plays: what went wrong first, then the rest; misses come round three times.
export function reelOrder(items: RecapItem[]) {
  const missed = items.filter((i) => i.miss);
  const rest = items.filter((i) => !i.miss);
  return [...missed, ...rest];
}

// ---- Example sentences for grammar points ----
// A grammar point is shown and said as one short sentence: the learner's own corrected sentence (with
// a translation from the AI), else one the AI writes. Kept on this device, keyed by the point.

const EX_KEY = "english-speak:point-examples:v2";
const exKey = (pt: NonNullable<RecapItem["point"]>) => `${pt.pattern}|${pt.seed ?? ""}`;

function readEx(): Record<string, Example> {
  try {
    return JSON.parse(localStorage.getItem(EX_KEY) ?? "{}") as Record<string, Example>;
  } catch {
    return {};
  }
}

// The items with every grammar point that has an example turned into that sentence.
export function withExamples(items: RecapItem[], known: Record<string, Example>): RecapItem[] {
  return items.map((it) => {
    const ex = it.point && (known[exKey(it.point)] ?? it.point.ex ?? (it.point.seed ? { ja: it.point.seed, zh: "" } : undefined));
    return ex ? { ...it, ja: ex.ja, zh: ex.zh, kana: undefined, say: ex.ja } : it;
  });
}

// Fetches examples for the points that have none yet; resolves to all known ones.
export async function loadExamples(items: RecapItem[]): Promise<Record<string, Example>> {
  const known = readEx();
  const need = [
    ...new Map(items.filter((i) => i.point && !known[exKey(i.point)] && !i.point.ex).map((i) => [exKey(i.point!), i.point!])).values(),
  ].slice(0, 20);
  if (!need.length) return known;
  try {
    const res = await fetch("/api/example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: need.map(({ pattern, zh, seed }) => ({ pattern: pattern.slice(0, 120), zh: zh.slice(0, 300), seed: seed?.slice(0, 200) })) }),
    });
    if (!res.ok) return known;
    const { items: got } = (await res.json()) as { items: Example[] };
    const next = { ...known };
    need.forEach((pt, i) => {
      const e = got[i];
      // The learner's own sentence stays as it is; only its translation comes from the AI.
      if (!e?.ja || !e.zh || /[／〜]|^[NV]/.test(e.ja)) return;
      if (pt.seed && e.ja.replace(/[。、\s]/g, "") !== pt.seed.replace(/[。、\s]/g, "")) return;
      next[exKey(pt)] = { ja: pt.seed ?? e.ja, zh: e.zh };
    });
    try {
      const keys = Object.keys(next);
      localStorage.setItem(EX_KEY, JSON.stringify(Object.fromEntries(keys.slice(-300).map((k) => [k, next[k]]))));
    } catch {}
    return next;
  } catch {
    return known;
  }
}
