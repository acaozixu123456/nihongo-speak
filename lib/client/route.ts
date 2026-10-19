"use client";

import { useEffect, useState } from "react";
import { calls } from "@/content/calls";
import { makeRadio } from "./moyu";
import { dayKey, dueSkillCount, todaysCards, retellToday, teacherPlan, weakItems, weakList, type Progress } from "./progress";

// 今日のルート: one fixed line of stops for today (listen → practise → a song to unwind → speak → call), so opening the app
// never asks what to do. Each page calls stepDone() when its part is over; the bar on top then moves
// on to the next stop by itself.

export type StopKey = "listen" | "game" | "song" | "retell" | "skills" | "review" | "quick" | "call" | "flow";
export type Stop = { key: StopKey; ja: string; meta: string; href: string; min: number };
export type Route = { day: string; quiet: boolean; stops: Stop[]; at: number };

const KEY = "nihongo-speak:route";
const EVENT = "nihongo-speak:route";
export const NEXT = "nihongo-speak:route-next";
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
  const ep = todaysEpisode(p);
  const epHref = ep ? `/ep/${ep.id}` : NEW_EP;
  // min: what each stop really takes, so the total on the start card is honest.
  const listen: Stop = { key: "listen", ja: "聴く", meta: ep ? (ep.title_ja ?? ep.title_zh) : "新しい回", href: epHref, min: 7 };
  // The episode's 洗脑歌, as a break in the middle.
  const song: Stop = { key: "song", ja: "一休み", meta: "洗脑歌", href: `${epHref}/song`, min: 2 };
  if (quiet) return [listen, song, { key: "flow", ja: "流す", meta: "心の中で", href: "/moyu", min: 10 }];

  const cards = todaysCards(p).length;
  const review: Stop[] = cards > 0 ? [{ key: "review", ja: "復習", meta: `${cards}文`, href: "/review", min: Math.ceil(cards / 2) }] : [];
  const day = Number(dayKey().replace(/-/g, ""));
  // The people who remember earlier calls come first.
  const pool = calls.filter((c) => c.person);
  const call = (pool.length ? pool : calls)[day % (pool.length || calls.length)];
  const phone: Stop = { key: "call", ja: "電話", meta: call.who, href: `/call/${call.id}`, min: 4 };
  // The episode's 練習 also brings back older items that are due and the weak points, so there is no
  // second practice round on a day with an episode.
  const episode: Stop[] = [listen, { key: "game", ja: "練習", meta: "今の話", href: `${epHref}/game`, min: 5 }, song];
  // 話す is 三回話す (today's story, three times) once a day, told while the story is fresh; on a
  // second route the same day it is 瞬間 instead.
  const speak: Stop = retellToday(p)
    ? { key: "quick", ja: "話す", meta: `瞬間 ${QUICK_N}問`, href: "/quick", min: 3 }
    : { key: "retell", ja: "話す", meta: "三回", href: "/retell", min: 10 };
  // 電話 last: the call brings up today's story, so it comes after it has been told.
  if (ep) return [...episode, speak, ...review, phone];
  // No episode yet: open with something that doesn't need it while it is written.
  const skills = dueSkillCount(p) + weakItems(p, 3).length;
  const lead: Stop[] = skills > 0 ? [{ key: "skills", ja: "練習", meta: `前の ${Math.min(skills, 12)}問`, href: "/practice", min: 5 }] : review;
  return [...lead, ...episode, speak, ...(lead === review ? [] : review), phone];
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

const QUIET_KEY = "nihongo-speak:quiet";
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
  const w = weakList(p)[0];
  const ex = w?.examples[0];
  const t = teacherPlan();
  const why = t?.order[0] === w?.tag && t?.why_zh ? t.why_zh : w?.zh;
  return w && ex ? { said: ex.said, better: ex.better, why, miss: w.miss } : null;
}
