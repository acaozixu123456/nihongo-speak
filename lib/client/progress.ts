"use client";

import { useSyncExternalStore } from "react";
import { scenarios, type Scenario } from "@/content/scenarios";

// Everything is kept in this phone's localStorage: the app has one user.

export type Card = {
  id: string;
  ja: string;
  reading?: string;
  zh: string;
  voice: string;
  scenarioId: string;
  due: string; // YYYY-MM-DD
  step: number; // index into INTERVALS
};

type ScenarioProgress = {
  listened?: boolean;
  shadow?: Record<number, number>; // line index -> best score
  talked?: number; // conversations finished with feedback
};

export type Progress = {
  goal: number;
  days: Record<string, number>; // YYYY-MM-DD -> xp
  scenarios: Record<string, ScenarioProgress>;
  cards: Card[];
};

const KEY = "nihongo-speak:progress:v1";
const INTERVALS = [1, 3, 7, 14, 30, 60];
export const GOALS = [30, 50, 80];

export const XP = {
  listen: 10,
  shadow: 2,
  shadowPass: 5,
  talkTurn: 3,
  feedback: 10,
  review: 2,
};

const EMPTY: Progress = { goal: 50, days: {}, scenarios: {}, cards: [] };

let state: Progress | null = null;
const listeners = new Set<() => void>();

function read(): Progress {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    state = EMPTY;
  }
  return state!;
}

function write(next: Progress) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((l) => l());
}

export function useProgress(): Progress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}

export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}

export function streak(p: Progress) {
  const today = dayKey();
  let day = p.days[today] ? today : addDays(today, -1);
  let n = 0;
  while (p.days[day]) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export const todayXp = (p: Progress) => p.days[dayKey()] ?? 0;

// XP events drive the floating "+N" and the goal celebration.
export type XpEvent = { amount: number; total: number; goal: number; goalReached: boolean; streak: number };
const xpListeners = new Set<(e: XpEvent) => void>();

export function onXp(cb: (e: XpEvent) => void) {
  xpListeners.add(cb);
  return () => {
    xpListeners.delete(cb);
  };
}

function gainXp(p: Progress, amount: number): Progress {
  const today = dayKey();
  const before = p.days[today] ?? 0;
  const next = { ...p, days: { ...p.days, [today]: before + amount } };
  const event: XpEvent = {
    amount,
    total: before + amount,
    goal: p.goal,
    goalReached: before < p.goal && before + amount >= p.goal,
    streak: streak(next),
  };
  queueMicrotask(() => xpListeners.forEach((l) => l(event)));
  return next;
}

function updateScenario(p: Progress, id: string, fn: (s: ScenarioProgress) => ScenarioProgress): Progress {
  return { ...p, scenarios: { ...p.scenarios, [id]: fn(p.scenarios[id] ?? {}) } };
}

export function setGoal(goal: number) {
  write({ ...read(), goal });
}

export function markListened(id: string) {
  write(gainXp(updateScenario(read(), id, (s) => ({ ...s, listened: true })), XP.listen));
}

export function recordShadow(id: string, line: number, score: number) {
  const p = read();
  const prevBest = p.scenarios[id]?.shadow?.[line] ?? 0;
  const amount = XP.shadow + (score >= 80 && prevBest < 80 ? XP.shadowPass : 0);
  write(
    gainXp(
      updateScenario(p, id, (s) => ({ ...s, shadow: { ...s.shadow, [line]: Math.max(prevBest, score) } })),
      amount,
    ),
  );
}

export function recordTalkTurn() {
  write(gainXp(read(), XP.talkTurn));
}

export function recordFeedback(id: string) {
  write(gainXp(updateScenario(read(), id, (s) => ({ ...s, talked: (s.talked ?? 0) + 1 })), XP.feedback));
}

const cardId = (ja: string) => ja.replace(/\s/g, "");

export function hasCard(p: Progress, ja: string) {
  return p.cards.some((c) => c.id === cardId(ja));
}

export function toggleCard(card: Omit<Card, "id" | "due" | "step">) {
  const p = read();
  const id = cardId(card.ja);
  if (p.cards.some((c) => c.id === id)) {
    write({ ...p, cards: p.cards.filter((c) => c.id !== id) });
  } else {
    // New cards are due right away so they show up in today's review.
    write({ ...p, cards: [...p.cards, { ...card, id, due: dayKey(), step: 0 }] });
  }
}

export function dueCards(p: Progress) {
  const today = dayKey();
  return p.cards.filter((c) => c.due <= today);
}

export function reviewCard(id: string, remembered: boolean) {
  const p = read();
  const cards = p.cards.map((c) => {
    if (c.id !== id) return c;
    const step = remembered ? Math.min(c.step + 1, INTERVALS.length - 1) : 0;
    return { ...c, step, due: addDays(dayKey(), remembered ? INTERVALS[c.step] : 1) };
  });
  write(gainXp({ ...p, cards }, XP.review));
}

// Steps of a scenario: listen once, shadow at least 5 lines, finish one conversation.
export type Step = "listen" | "shadow" | "talk";

export function shadowTarget(s: Scenario) {
  return Math.min(5, s.lines.length);
}

export function stepsDone(p: Progress, s: Scenario): Record<Step, boolean> {
  const sp = p.scenarios[s.id] ?? {};
  return {
    listen: !!sp.listened,
    shadow: Object.keys(sp.shadow ?? {}).length >= shadowTarget(s),
    talk: (sp.talked ?? 0) > 0,
  };
}

export function nextStep(p: Progress): { scenario: Scenario; step: Step } | null {
  for (const s of scenarios) {
    const done = stepsDone(p, s);
    const step = (["listen", "shadow", "talk"] as Step[]).find((k) => !done[k]);
    if (step) return { scenario: s, step };
  }
  return null;
}
