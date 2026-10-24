"use client";

import { useEffect, useSyncExternalStore } from "react";
import { NEWS_VOICES, VOICE_LABEL, newsPace, newsVoice, otherVoice, type NewsArticle } from "@/lib/news-model";
import type { Clip } from "./moyu";
import { preload, ttsUrl } from "./player";
import { dayKey, markNews, teacherPlan, type Progress } from "./progress";

// NHKやさしいことばニュース on the phone: the kept articles (/api/news), saved here too so the train
// without signal still has them.

const KEY = "nihongo-speak:news";
const STALE_MS = 20 * 60_000;
type Saved = { fetched: number; items: NewsArticle[] };
const NONE: Saved = { fetched: 0, items: [] };

let state: Saved | null = null;
const listeners = new Set<() => void>();

function read(): Saved {
  if (state) return state;
  try {
    state = (JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null) ?? NONE;
  } catch {
    state = NONE;
  }
  return state;
}

function save(s: Saved) {
  state = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
  listeners.forEach((l) => l());
}

let asking: Promise<void> | null = null;
export function refreshNews(force = false) {
  if (!force && Date.now() - read().fetched < STALE_MS) return Promise.resolve();
  asking ??= fetch("/api/news")
    .then((r) => (r.ok ? (r.json() as Promise<{ items: NewsArticle[] }>) : null))
    .then((d) => {
      if (d?.items) save({ fetched: Date.now(), items: d.items });
    })
    .catch(() => {})
    .finally(() => (asking = null));
  return asking;
}

export const newsItems = () => read().items;

export function useNews(): NewsArticle[] {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => NONE,
  );
  useEffect(() => {
    refreshNews();
  }, []);
  return s.items;
}

// The newest day NHK put out, in NHK's order.
export function morning(items: NewsArticle[]): NewsArticle[] {
  const day = items[0]?.day;
  return day ? items.filter((a) => a.day === day).sort((x, y) => x.rank - y.rank) : [];
}

// Heard on an earlier day than today (heard today stays in today's set, so it doesn't change under the learner).
const heardBefore = (p: Progress, a: NewsArticle) => {
  const h = p.news?.[a.id]?.heard;
  return !!h && h !== dayKey();
};

// The articles to listen to now: the newest day that still has some not heard before today (the night's new
// ones, or a day missed), without those heard already. fresh: false when every kept article was heard, and
// it is the newest day again.
export function listenSet(p: Progress, items: NewsArticle[] = newsItems()): { day: string; items: NewsArticle[]; fresh: boolean } {
  const days = [...new Set(items.map((a) => a.day))].sort().reverse();
  for (const day of days) {
    const left = items.filter((a) => a.day === day && !heardBefore(p, a)).sort((x, y) => x.rank - y.rank);
    if (left.length) return { day, items: left, fresh: true };
  }
  const m = morning(items);
  return { day: m[0]?.day ?? "", items: m, fresh: false };
}

// "10/19のニュース"
export const newsDay = (day: string) => (day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8))}のニュース` : "ニュース");

// The article for today's 三回話す: one heard today and not told yet (森先生's pick first), else the one told today.
export function newsToday(p: Progress, items: NewsArticle[] = newsItems()): NewsArticle | null {
  const today = dayKey();
  const pick = teacherPlan()?.news;
  const heard = items.filter((a) => p.news?.[a.id]?.heard === today).sort((x, y) => (x.id === pick ? -1 : y.id === pick ? 1 : 0));
  return heard.find((a) => p.news?.[a.id]?.told !== today) ?? heard.find((a) => p.news?.[a.id]?.told === today) ?? null;
}

// The article to be told tonight, shown before it is heard: today's (above), else 森先生's pick, else NHK's first.
export function newsToTell(p: Progress, set: NewsArticle[], items: NewsArticle[] = newsItems()): NewsArticle | null {
  const pick = teacherPlan()?.news;
  return newsToday(p, items) ?? set.find((a) => a.id === pick) ?? set[0] ?? null;
}

// What the title is said as (older articles were kept without it).
export const titleSay = (a: NewsArticle) => a.title_say ?? a.title_ja;

// How long listening takes, in minutes: the voice says about 5.2 characters a second, plus the pause after
// each clip; passes: each article is played this many times (twice back to back on /news, the first at its pace).
export function newsSeconds(as: NewsArticle[], passes = 2) {
  return as.reduce((n, a) => {
    const one = (titleSay(a).length + a.sentences.reduce((m, s) => m + s.say.length, 0)) / 5.2 + (a.sentences.length + 1) * 0.45;
    return n + (passes > 1 ? one / newsPace(a) + one * (passes - 1) : one);
  }, 0);
}
export const newsMinutes = (as: NewsArticle[], passes = 2) => Math.max(1, Math.round(newsSeconds(as, passes) / 60));

// Before a sentence that has a picture, when it is heard without the text: the picture alone for a moment, so
// the situation is in mind when the voice starts.
export const LEAD_MS = 1200;
const lead = (on: boolean, s: NewsArticle["sentences"][number], voice: string): Clip["parts"] => (on && s.scene_image ? [{ voice, pauseMs: LEAD_MS }] : []);

// The title, then every sentence (a little pause between paragraphs). ear: the pass without the text, whose
// lock screen shows only the title and how far it has got, not the sentence. pics: each sentence's picture
// first (above).
export function articleClips(a: NewsArticle, voice: string, mode: "read" | "ear" | "text" = "read", pics = false): Clip[] {
  const n = a.sentences.length;
  return [
    { block: "news", show: a.title_ja, sub: mode === "text" ? "2回目" : undefined, parts: [{ voice, text: titleSay(a), pauseMs: 900 }] },
    ...a.sentences.map(
      (s, i): Clip => ({
        block: "news",
        show: mode === "ear" ? `${a.title_ja}（${i + 1}/${n}）` : s.ja,
        sub: s.zh,
        parts: [...lead(pics, s, voice), { voice, text: s.say, pauseMs: a.sentences[i + 1]?.p ? 700 : 350 }],
      }),
    ),
  ];
}

// 6つの声: the title, then each sentence said by all six voices before the next, one round per sentence (so
// it starts at once and the next sentence is made while this one plays). Round r + 1 is sentence r.
// talk: after each voice a beep and 3-5 s (by the sentence's length) to say it.
export const talkGap = (say: string) => Math.min(5000, Math.max(3000, say.length * 120));
export function sixRounds(a: NewsArticle, voice: string, talk = false, pics = false): Clip[][] {
  return [
    [{ block: "news", show: a.title_ja, parts: [{ voice, text: titleSay(a), pauseMs: 900 }] }],
    ...a.sentences.map((s, i) =>
      NEWS_VOICES.map(
        (v, k): Clip => ({
          block: "news",
          show: s.ja,
          sub: `${VOICE_LABEL[k]} · ${s.zh}`,
          parts: [...lead(pics && k === 0, s, v), ...(talk
            ? [{ voice: v, text: s.say, pauseMs: 250 }, { voice: v, sound: "/beep2.mp3", pauseMs: talkGap(s.say) }]
            : [{ voice: v, text: s.say, pauseMs: k === NEWS_VOICES.length - 1 ? (a.sentences[i + 1]?.p ? 1000 : 800) : 450 }])],
        }),
      ),
    ),
  ];
}

// Every sentence of these articles fetched ahead of the train.
export function preloadNews(p: Progress, as: NewsArticle[]) {
  preload(as.flatMap((a) => [titleSay(a), ...a.sentences.map((s) => s.say)].map((t) => ttsUrl(t, voiceOf(p, a)))));
}

// ---- ？: sentences not caught by ear ----

export const missOf = (p: Progress, a: NewsArticle) => p.news?.[a.id]?.miss ?? [];

export function toggleMiss(p: Progress, a: NewsArticle, i: number) {
  const m = missOf(p, a);
  markNews(a.id, { miss: m.includes(i) ? m.filter((x) => x !== i) : [...m, i].sort((x, y) => x - y) });
}

// The voice the article is read in: the one picked for it, else the anchor's.
export const voiceOf = (p: Progress, a: NewsArticle) => newsVoice(p.news?.[a.id]?.voice);

export type Back = { a: NewsArticle; i: number };
const BACK_MAX = 8;
// The sentences marked ？ in articles other than these, oldest first, at most eight.
export function backSet(p: Progress, not: NewsArticle[], items: NewsArticle[] = newsItems()): Back[] {
  const skip = new Set(not.map((a) => a.id));
  return [...items]
    .filter((a) => !skip.has(a.id))
    .sort((x, y) => (x.id < y.id ? -1 : 1))
    .flatMap((a) => missOf(p, a).filter((i) => a.sentences[i]).map((i) => ({ a, i })))
    .slice(0, BACK_MAX);
}

// The sentences again: first in a voice of the other sex without the text, then in the article's own with it.
export function backClips(p: Progress, back: Back[], mode: "ear" | "text"): Clip[] {
  return back.map(({ a, i }, k) => {
    const s = a.sentences[i];
    return {
      block: "news",
      show: mode === "ear" ? `聞き直す（${k + 1}/${back.length}）` : s.ja,
      sub: s.zh,
      parts: [{ voice: mode === "ear" ? otherVoice(voiceOf(p, a)) : voiceOf(p, a), text: s.say, pauseMs: 1200 }],
    };
  });
}

// Once heard again, those marks are cleared.
export function clearBack(p: Progress, back: Back[]) {
  for (const a of new Set(back.map((b) => b.a))) {
    const done = back.filter((b) => b.a === a).map((b) => b.i);
    markNews(a.id, { miss: missOf(p, a).filter((i) => !done.includes(i)) });
  }
}
