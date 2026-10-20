"use client";

import { useEffect, useSyncExternalStore } from "react";
import { NEWS_VOICE, type NewsArticle } from "@/lib/news-model";
import type { Clip } from "./moyu";
import { preload, ttsUrl } from "./player";
import { dayKey, type Progress } from "./progress";

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

// This morning's articles: the newest day NHK put out, in NHK's order.
export function morning(items: NewsArticle[]): NewsArticle[] {
  const day = items[0]?.day;
  return day ? items.filter((a) => a.day === day).sort((x, y) => x.rank - y.rank) : [];
}

// The article for today's 三回話す: one heard today and not told yet, else the one told today.
export function newsToday(p: Progress, items: NewsArticle[] = newsItems()): NewsArticle | null {
  const today = dayKey();
  const heard = items.filter((a) => p.news?.[a.id]?.heard === today);
  return heard.find((a) => p.news?.[a.id]?.told !== today) ?? heard.find((a) => p.news?.[a.id]?.told === today) ?? null;
}

export const newsMinutes = (as: NewsArticle[]) => Math.max(1, Math.round(as.reduce((n, a) => n + a.sentences.reduce((m, s) => m + s.say.length, 0), 0) / 330));

// The title, then every sentence (a little pause between paragraphs).
export function articleClips(a: NewsArticle, pass = 1): Clip[] {
  return [
    { block: "news", show: a.title_ja, sub: pass === 2 ? "2回目" : undefined, parts: [{ voice: NEWS_VOICE, text: a.title_ja, pauseMs: 900 }] },
    ...a.sentences.map(
      (s, i): Clip => ({ block: "news", show: s.ja, sub: s.zh, parts: [{ voice: NEWS_VOICE, text: s.say, pauseMs: a.sentences[i + 1]?.p ? 700 : 350 }] }),
    ),
  ];
}

// Every sentence of these articles fetched ahead of the train.
export function preloadNews(as: NewsArticle[]) {
  preload(as.flatMap((a) => [a.title_ja, ...a.sentences.map((s) => s.say)].map((t) => ttsUrl(t, NEWS_VOICE))));
}
