"use client";

import { useEffect, useState } from "react";
import { calls } from "@/content/calls";
import { makeRadio } from "./moyu";
import { dayKey, dueCards, dueSkillCount, weakItems, weakList, type Progress } from "./progress";

// 今日のルート: one fixed line of stops for today (listen → practise → a song to unwind → speak → call), so opening the app
// never asks what to do. Each page calls stepDone() when its part is over; the bar on top then moves
// on to the next stop by itself.

export type StopKey = "listen" | "game" | "song" | "skills" | "review" | "quick" | "call" | "flow";
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
function todaysEpisode(p: Progress) {
  const e = p.episodes[0];
  return e && (!e.heard || e.date === dayKey()) ? e : null;
}

// The stops for today, from what is due. A route made before the new episode is written starts
// with something else, so there is no waiting.
export function plan(p: Progress, quiet: boolean): Stop[] {
  const ep = todaysEpisode(p);
  const epHref = ep ? `/ep/${ep.id}` : NEW_EP;
  const listen: Stop = { key: "listen", ja: "聴く", meta: ep ? ep.title_zh : "新しい回", href: epHref, min: 6 };
  // The episode's 洗脑歌, as a break in the middle.
  const song: Stop = { key: "song", ja: "一休み", meta: "洗脑歌", href: `${epHref}/song`, min: 2 };
  if (quiet) return [listen, song, { key: "flow", ja: "流す", meta: "心の中で", href: "/moyu", min: 10 }];

  // 練習's daily set: what is due, plus questions made from the points missed when speaking.
  const skills = dueSkillCount(p) + weakItems(p, 3).length;
  const cards = dueCards(p).length;
  const day = Number(dayKey().replace(/-/g, ""));
  // The people who remember earlier calls come first.
  const pool = calls.filter((c) => c.person);
  const call = (pool.length ? pool : calls)[day % (pool.length || calls.length)];
  const episode: Stop[] = [listen, { key: "game", ja: "練習", meta: "今の話", href: `${epHref}/game`, min: 3 }, song];
  const rest: Stop[] = [
    ...(skills > 0 ? [{ key: "skills" as const, ja: "復習", meta: `${Math.min(skills, 12)}個`, href: "/practice", min: 3 }] : []),
    cards > 0
      ? { key: "review", ja: "話す", meta: `復習 ${cards}文`, href: "/review", min: 3 }
      : { key: "quick", ja: "話す", meta: `瞬間 ${QUICK_N}問`, href: "/quick", min: 3 },
    { key: "call", ja: "電話", meta: call.who, href: `/call/${call.id}`, min: 3 },
  ];
  return ep ? [...episode, ...rest] : [rest[0], ...episode, ...rest.slice(1)];
}

export const minutes = (stops: Stop[]) => stops.reduce((a, s) => a + s.min, 0);

let making: Promise<string> | null = null;

// Writes today's episode once, and points the route's listen and practise stops at it.
function makeEpisode(): Promise<string> {
  making ??= makeRadio()
    .then((ep) => {
      const r = read();
      if (r) write({ ...r, stops: r.stops.map((s) => (s.href.startsWith(NEW_EP) ? { ...s, href: s.href.replace(NEW_EP, `/ep/${ep.id}`), meta: s.key === "listen" ? ep.title_zh : s.meta } : s)) });
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

// The one thing to fix tomorrow: the shakiest point, with the last thing said wrong.
export function oneFix(p: Progress) {
  const w = weakList(p)[0];
  const ex = w?.examples[0];
  return w && ex ? { said: ex.said, better: ex.better, why: w.zh, miss: w.miss } : null;
}
