"use client";

import { addDays, dayKey, type Learned, type LearnedSrc, type Progress } from "@/lib/progress-model";
import { RADIO_VOICE, skillKey } from "./progress";

// 今日: everything learned or practised over a few days, from every corner of the app, in one list.
// Episodes, the diary, weak points and 摸鱼 replays carry their own dates; 练一练, review, 瞬间说
// and shadowing are noted per day as they happen (DayStats.learned).

export type RecapItem = Learned & { say: string }; // say: what to read out (the example, for a grammar point)

export const SRC_JA: Record<LearnedSrc, string> = {
  radio: "ラジオ",
  game: "練習",
  review: "復習",
  quick: "瞬間",
  scene: "場面",
  weak: "弱点",
  diary: "日記",
  stuck: "流す",
};

export function recapDays(n: number, today = dayKey()) {
  return Array.from({ length: n }, (_, i) => addDays(today, -i));
}

export function recap(p: Progress, days: string[]): RecapItem[] {
  const inRange = new Set(days);
  const out: RecapItem[] = [];
  const add = (it: Learned, say = it.ja) => it.ja && out.push({ voice: RADIO_VOICE.A, ...it, say });

  for (const ep of p.episodes.filter((e) => inRange.has(e.date))) {
    for (const w of ep.words ?? []) add({ ja: w.ja, kana: w.kana, zh: w.zh, src: "radio" });
    for (const g of ep.grammar ?? []) add({ ja: g.pattern, zh: g.zh, src: "radio" }, g.ja);
    for (const x of ep.phrases) add({ ja: x.ja, zh: x.zh, src: "radio" });
    for (const x of ep.asked ?? []) add({ ja: x.text, zh: x.meaning_zh, src: "radio" });
  }
  for (const day of [...days].reverse()) {
    const s = p.stats[day];
    for (const l of s?.learned ?? []) add(l);
    for (const l of s?.stuck ?? []) add({ ja: l.ja, kana: l.reading, zh: l.zh, src: "stuck", voice: l.voice });
  }
  for (const w of Object.values(p.weak).filter((w) => inRange.has(w.last))) {
    const better = w.examples[0]?.better;
    add({ ja: w.pattern ?? w.tag, zh: w.zh, src: "weak", miss: !!w.lastMiss && inRange.has(w.lastMiss) }, better ?? w.pattern ?? w.tag);
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
    else if (it.miss && !o.miss) seen.set(k, { ...o, miss: true });
  }
  return [...seen.values()];
}

// The order the 连播 plays: what went wrong first, then the rest; misses come round three times.
export function reelOrder(items: RecapItem[]) {
  const missed = items.filter((i) => i.miss);
  const rest = items.filter((i) => !i.miss);
  return [...missed, ...rest];
}
