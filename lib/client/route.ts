"use client";

import { useEffect, useState } from "react";
import { calls } from "@/content/calls";
import { makeRadio } from "./moyu";
import { listenSet, newsDay, newsMinutes } from "./news";
import { dayKey, dueSkillCount, todaysCards, retellToday, teacherFix, teacherPlan, weakItems, weakList, type Progress } from "./progress";

// 今日のルート: one fixed line of stops for today (listen → speak → the teacher), so opening the app
// never asks what to do. Each page calls stepDone() when its part is over; the bar on top then moves
// on to the next stop by itself.

export type StopKey = "fix" | "listen" | "game" | "song" | "retell" | "skills" | "review" | "quick" | "call" | "flow";
export type Stop = { key: StopKey; ja: string; meta: string; href: string; min: number };
export type Route = { day: string; quiet: boolean; stops: Stop[]; at: number };

const KEY = "english-speak:route";
const EVENT = "english-speak:route";
export const NEXT = "english-speak:route-next";
// The episode a route is waiting on, until /api/podcast has written it.
export const NEW_EP = "/ep/new";
const QUICK_N = 5;

export function read(): Route | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? "null") as Route | null;
    return r && r.day === dayKey() ? r : null;
  } catch {
    return null;
  }
}

function write(r: Route | null) {
  try {
    if (r) localStorage.setItem(KEY, JSON.stringify(r));
    else localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function useRoute(): Route | null {
  const [r, setR] = useState<Route | null>(null);
  useEffect(() => {
    const sync = () => setR(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return r;
}

const path = (href: string) => href.split("?")[0];
export const current = (r: Route | null) => (r && r.at < r.stops.length ? r.stops[r.at] : null);
export const finished = (r: Route | null) => !!r && r.at >= r.stops.length;

// True while this page is today's current stop, so it can start on its own and hide its back link.
export function useOnRoute(): boolean {
  const r = useRoute();
  const [here, setHere] = useState("");
  useEffect(() => setHere(location.pathname), []);
  const c = current(r);
  return !!c && !!here && path(c.href) === here;
}

// Today's episode: the newest one not heard yet, or the one heard today.
export function todaysEpisode(p: Progress) {
  const e = p.episodes[0];
  return e && (!e.heard || e.date === dayKey()) ? e : null;
}

// The episode listened to today: the route's 聴く stop once it is behind, else one written and heard today.
export function heardToday(p: Progress) {
  const r = read();
  const i = r ? r.stops.findIndex((s) => s.key === "listen") : -1;
  const id = r && i >= 0 && i < r.at ? path(r.stops[i].href).split("/")[2] : undefined;
  const ep = p.episodes.find((e) => e.id === id) ?? p.episodes[0];
  return ep && ep.heard && (ep.id === id || ep.date === dayKey()) ? ep : null;
}

// The stops for today, from what is due. A route made before the new episode is written starts
// with something else, so there is no waiting.
export function plan(p: Progress, quiet: boolean): Stop[] {
  // The news not heard yet; when all of it was heard on earlier days, the day goes on without listening again.
  const news = listenSet(p);
  if (news.items.length) return newsPlan(p, quiet, news.fresh ? news.items.length : 0, newsMinutes(news.items), news.day);
  const ep = todaysEpisode(p);
  const epHref = ep ? `/ep/${ep.id}` : NEW_EP;
  // min: what each stop really takes, so the total on the start card is honest.
  const listen: Stop = { key: "listen", ja: "听", meta: ep ? (ep.title_ja ?? ep.title_zh) : "新的一期", href: epHref, min: 7 };
  // The episode's 洗脑歌, sung right after it.
  const song: Stop = { key: "song", ja: "歇一下", meta: "洗脑歌", href: `${epHref}/song`, min: 2 };
  if (quiet) return [listen, song, { key: "flow", ja: "默念", meta: "在心里说", href: "/moyu", min: 10 }];

  const cards = todaysCards(p).length;
  const review: Stop[] = cards > 0 ? [{ key: "review", ja: "复习", meta: `${cards} 句`, href: "/review", min: Math.ceil(cards / 2) }] : [];
  const day = Number(dayKey().replace(/-/g, ""));
  // The people who remember earlier calls come first.
  const pool = calls.filter((c) => c.person);
  const call = (pool.length ? pool : calls)[day % (pool.length || calls.length)];
  const phone: Stop = { key: "call", ja: "电话", meta: call.who, href: `/call/${call.id}`, min: 4 };
  // The episode's 練習 also brings back older items that are due and the weak points, so there is no
  // second practice round on a day with an episode.
  const game: Stop = { key: "game", ja: "练习", meta: "刚才这期", href: `${epHref}/game`, min: 5 };
  // 話す is 三回話す (today's story, three times) once a day; on a second route the same day it is 瞬間.
  const speak: Stop = retellToday(p)
    ? { key: "quick", ja: "说", meta: `马上说 ${QUICK_N} 题`, href: "/quick", min: 3 }
    : { key: "retell", ja: "说", meta: "复述三遍", href: "/retell", min: 10 };
  // Today follows the three cards on 今日: 聴く (the episode and its song), 話す (三回話す on the story
  // just heard, then 電話, which brings it up too), and 先生 last: the teacher's one point, the
  // episode's 練習 and the sentences due.
  const f = teacherFix(p);
  const fix: Stop[] = f ? [{ key: "fix", ja: "改", meta: f.better, href: `/quick?drill=${encodeURIComponent(f.tag)}`, min: 1 }] : [];
  const episode: Stop[] = [listen, song, speak, phone, ...fix, game];
  if (ep) return [...episode, ...review];
  // No episode yet: open with something that doesn't need it while it is written.
  const skills = dueSkillCount(p) + weakItems(p, 3).length;
  const lead: Stop[] = skills > 0 ? [{ key: "skills", ja: "练习", meta: `之前的 ${Math.min(skills, 12)} 题`, href: "/practice", min: 5 }] : review;
  return [...lead, ...episode, ...(lead === review ? [] : review)];
}

// A day around the BBC news: what is not heard yet on the train (each article twice), 三回話す on one of
// them, a call, then the teacher's point, practice and the sentences due.
// n: articles not heard yet (0: none, so no listening stop); min: both passes of them.
function newsPlan(p: Progress, quiet: boolean, n: number, min: number, day: string): Stop[] {
  const listen: Stop[] = n ? [{ key: "listen", ja: "听", meta: `${newsDay(day)} ${n} 篇`, href: "/news", min }] : [];
  if (quiet) return [...listen, { key: "flow", ja: "默念", meta: "在心里说", href: "/moyu", min: 10 }];
  const cards = todaysCards(p).length;
  const review: Stop[] = cards > 0 ? [{ key: "review", ja: "复习", meta: `${cards} 句`, href: "/review", min: Math.ceil(cards / 2) }] : [];
  const d = Number(dayKey().replace(/-/g, ""));
  const pool = calls.filter((c) => c.person);
  const call = (pool.length ? pool : calls)[d % (pool.length || calls.length)];
  const speak: Stop = retellToday(p)
    ? { key: "quick", ja: "说", meta: `马上说 ${QUICK_N} 题`, href: "/quick", min: 3 }
    : { key: "retell", ja: "说", meta: "复述三遍", href: "/retell", min: 10 };
  const f = teacherFix(p);
  const fix: Stop[] = f ? [{ key: "fix", ja: "改", meta: f.better, href: `/quick?drill=${encodeURIComponent(f.tag)}`, min: 1 }] : [];
  const skills = dueSkillCount(p) + weakItems(p, 3).length;
  const practice: Stop[] = skills > 0 ? [{ key: "skills", ja: "练习", meta: `之前的 ${Math.min(skills, 12)} 题`, href: "/practice", min: 5 }] : [];
  return [...listen, speak, { key: "call", ja: "电话", meta: call.who, href: `/call/${call.id}`, min: 4 }, ...fix, ...practice, ...review];
}

// Which of the three cards on 今日 a stop belongs to.
export type Pillar = "listen" | "speak" | "teacher";
export const PILLARS: Pillar[] = ["listen", "speak", "teacher"];
export function pillarOf(k: StopKey): Pillar {
  if (k === "listen" || k === "song" || k === "flow") return "listen";
  if (k === "retell" || k === "quick" || k === "call") return "speak";
  return "teacher";
}

export const minutes = (stops: Stop[]) => stops.reduce((a, s) => a + s.min, 0);

let making: Promise<string> | null = null;

// Writes today's episode once, and points the route's listen and practise stops at it.
function makeEpisode(): Promise<string> {
  making ??= makeRadio()
    .then((ep) => {
      const r = read();
      if (r) write({ ...r, stops: r.stops.map((s) => (s.href.startsWith(NEW_EP) ? { ...s, href: s.href.replace(NEW_EP, `/ep/${ep.id}`), meta: s.key === "listen" ? (ep.title_ja ?? ep.title_zh) : s.meta } : s)) });
      return ep.id;
    })
    .finally(() => (making = null));
  return making;
}

export function startRoute(p: Progress, quiet: boolean): string {
  const r = read();
  // Already under way: carry on where it stopped.
  const route = r && r.at > 0 && r.quiet === quiet ? r : { day: dayKey(), quiet, stops: plan(p, quiet), at: 0 };
  write(route);
  if (route.stops.some((s) => s.href.startsWith(NEW_EP))) makeEpisode().catch(() => {});
  return current(route)!.href;
}

const QUIET_KEY = "english-speak:quiet";
export function quietPref() {
  try {
    return localStorage.getItem(QUIET_KEY) === "1";
  } catch {
    return false;
  }
}

// The 声を出せない switch: what is done stays done, the rest is planned again.
export function setQuiet(p: Progress, quiet: boolean) {
  try {
    localStorage.setItem(QUIET_KEY, quiet ? "1" : "0");
  } catch {}
  const r = read();
  if (!r || r.at === 0) return write(r ? { ...r, quiet, stops: plan(p, quiet) } : null);
  const done = r.stops.slice(0, r.at);
  const next = plan(p, quiet).filter((s) => !done.some((d) => d.key === s.key));
  write({ ...r, quiet, stops: [...done, ...next] });
}

// Called by a page when its part is over. Only counts on the page that is today's current stop.
export function stepDone() {
  const r = read();
  const c = current(r);
  if (!r || !c || path(c.href) !== location.pathname) return;
  write({ ...r, at: r.at + 1 });
  window.dispatchEvent(new Event(NEXT));
}

// Where the next stop is, waiting for the new episode if that is what comes next.
// If the episode can't be written, its two stops are skipped rather than blocking the rest.
export async function nextHref(): Promise<string> {
  const c = current(read());
  if (!c) return "/";
  if (!c.href.startsWith(NEW_EP)) return c.href;
  try {
    await makeEpisode();
  } catch {
    const r = read();
    if (r) write({ ...r, stops: r.stops.filter((s, i) => i < r.at || !s.href.startsWith(NEW_EP)) });
  }
  return current(read())?.href ?? "/";
}

// The one thing to fix tomorrow: the teacher's first point (or the shakiest), with the last thing said
// wrong, and the teacher's reason when it chose it.
export function oneFix(p: Progress) {
  const f = teacherFix(p);
  if (f) return { said: f.said, better: f.better, why: f.zh, miss: p.weak[f.tag].miss };
  const w = weakList(p)[0];
  const ex = w?.examples[0];
  const t = teacherPlan();
  const why = t?.order[0] === w?.tag && t?.why_zh ? t.why_zh : w?.zh;
  return w && ex ? { said: ex.said, better: ex.better, why, miss: w.miss } : null;
}
