"use client";

import { useSyncExternalStore } from "react";
import { scenarios, type Scenario } from "@/content/scenarios";
import {
  EMPTY,
  active,
  addDays,
  dayKey,
  level,
  merge,
  normalize,
  streak,
  totalXp,
  type Card,
  type CustomScenario,
  type DayStats,
  type DiaryEntry,
  type Progress,
  type ScenarioProgress,
  type XpKind,
} from "@/lib/progress-model";

export { dayKey, level, streak, totalXp };
export type { Card, CustomScenario, DiaryEntry, Progress };

// The phone's localStorage is the working copy; it is synced to the server
// (when storage is set up) so nothing is lost if Safari data is cleared.

const KEY = "nihongo-speak:progress:v1";
const INTERVALS = [1, 3, 7, 14, 30, 60];
export const GOALS = [30, 50, 80];
export const MAX_FREEZES = 2;

export const XP = {
  listen: 10,
  shadow: 2,
  shadowPass: 5,
  talkTurn: 3,
  feedback: 10,
  review: 2,
  diary: 15,
  quick: 2,
  quests: 10,
};

let state: Progress | null = null;
const listeners = new Set<() => void>();

function read(): Progress {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = normalize(raw ? JSON.parse(raw) : null);
  } catch {
    state = EMPTY;
  }
  return state!;
}

function save(next: Progress, sync = true) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((l) => l());
  if (sync) scheduleSync();
}

function write(next: Progress) {
  save({ ...next, updatedAt: Date.now() });
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

// ---- Server sync ----

export type SyncState = "off" | "syncing" | "ok" | "error";
let syncState: SyncState = "off";
const syncListeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function setSyncState(s: SyncState) {
  syncState = s;
  syncListeners.forEach((l) => l());
}

export function useSyncState() {
  return useSyncExternalStore(
    (l) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    () => syncState,
    () => "off" as SyncState,
  );
}

async function exchange(method: "GET" | "PUT") {
  const res = await fetch("/api/sync", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "PUT" ? JSON.stringify(read()) : undefined,
  });
  if (res.status === 503) return "off" as const;
  if (!res.ok) throw new Error(String(res.status));
  const server = normalize((await res.json()).progress);
  save(merge(read(), server), false);
  return "ok" as const;
}

function scheduleSync() {
  if (!booted || syncState === "off") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    setSyncState("syncing");
    exchange("PUT").then(setSyncState, () => setSyncState("error"));
  }, 2500);
}

let booted = false;

// Called once when the app opens: pull the server copy, then fix up the streak.
export function boot() {
  if (booted) return;
  booted = true;
  applyFreezes();
  setSyncState("syncing");
  exchange("PUT").then(
    (s) => {
      setSyncState(s);
      applyFreezes();
    },
    () => setSyncState("error"),
  );
}

// ---- Streak protection ----

// Missed days are covered by protectors, if there are enough to bridge the gap.
function applyFreezes() {
  const p = read();
  if (!p.freezes) return;
  const today = dayKey();
  const gap: string[] = [];
  let day = addDays(today, -1);
  while (!active(p, day) && gap.length <= p.freezes) {
    gap.push(day);
    day = addDays(day, -1);
    if (gap.length > 30) return;
  }
  if (gap.length === 0 || gap.length > p.freezes || !active(p, day)) return;
  write({ ...p, freezes: p.freezes - gap.length, frozen: [...p.frozen, ...gap] });
}

// ---- XP ----

export type XpEvent = {
  amount: number;
  total: number;
  goal: number;
  goalReached: boolean;
  streak: number;
  levelUp?: number;
  freezeEarned?: boolean;
  questsDone?: boolean;
};
const xpListeners = new Set<(e: XpEvent) => void>();

export function onXp(cb: (e: XpEvent) => void) {
  xpListeners.add(cb);
  return () => {
    xpListeners.delete(cb);
  };
}

function bumpStats(p: Progress, fn: (s: DayStats) => DayStats): Progress {
  const today = dayKey();
  return { ...p, stats: { ...p.stats, [today]: fn(p.stats[today] ?? {}) } };
}

function gainXp(p: Progress, amount: number, kind: XpKind): Progress {
  const today = dayKey();
  const before = p.days[today] ?? 0;
  const levelBefore = level(totalXp(p)).n;
  let next = bumpStats({ ...p, days: { ...p.days, [today]: before + amount } }, (s) => ({
    ...s,
    xp: { ...s.xp, [kind]: (s.xp?.[kind] ?? 0) + amount },
  }));

  // Every 7 days in a row earns a streak protector.
  const days = streak(next);
  let freezeEarned = false;
  if (days > 0 && days % 7 === 0 && next.freezeAwardDay !== today && next.freezes < MAX_FREEZES) {
    next = { ...next, freezes: next.freezes + 1, freezeAwardDay: today };
    freezeEarned = true;
  }

  let questsDone = false;
  let total = before + amount;
  if (kind !== "bonus" && !next.bonusDays.includes(today) && quests(next).every((q) => q.done)) {
    questsDone = true;
    total += XP.quests;
    next = bumpStats(
      { ...next, days: { ...next.days, [today]: total }, bonusDays: [...next.bonusDays, today] },
      (s) => ({ ...s, xp: { ...s.xp, bonus: (s.xp?.bonus ?? 0) + XP.quests } }),
    );
  }

  const levelAfter = level(totalXp(next)).n;
  const event: XpEvent = {
    amount: total - before,
    total,
    goal: p.goal,
    goalReached: before < p.goal && total >= p.goal,
    streak: days,
    levelUp: levelAfter > levelBefore ? levelAfter : undefined,
    freezeEarned,
    questsDone,
  };
  queueMicrotask(() => xpListeners.forEach((l) => l(event)));
  return next;
}

export const todayXp = (p: Progress) => p.days[dayKey()] ?? 0;
export const todayStats = (p: Progress): DayStats => p.stats[dayKey()] ?? {};

function updateScenario(p: Progress, id: string, fn: (s: ScenarioProgress) => ScenarioProgress): Progress {
  return { ...p, scenarios: { ...p.scenarios, [id]: fn(p.scenarios[id] ?? {}) } };
}

export function setGoal(goal: number) {
  write({ ...read(), goal });
}

// Seconds of 16kHz 16-bit mono WAV.
export const wavSeconds = (wav: Blob) => Math.max(0, (wav.size - 44) / 32000);

// Every time the learner speaks: how long, and the pronunciation score if there was one.
export function recordSpeech(sec: number, pron?: number) {
  write(
    bumpStats(read(), (s) => ({
      ...s,
      speakSec: (s.speakSec ?? 0) + sec,
      said: (s.said ?? 0) + 1,
      pronSum: (s.pronSum ?? 0) + (pron ?? 0),
      pronN: (s.pronN ?? 0) + (pron === undefined ? 0 : 1),
    })),
  );
}

// ---- Quick-response drill ----

export const QUICK_LIMIT_MS = 3000;

export type QuickItem = {
  key: string;
  ja: string;
  reading?: string;
  zh: string;
  voice: string;
  scenarioId: string;
  where: string; // the situation the line comes from, e.g. "☀️ 早会汇报进度 · 佐藤"
};

// Short lines only: the drill is about getting a sentence out in a few seconds.
const QUICK_MAX_CHARS = 32;

// Saved cards first, then lines from scenarios the learner has worked on, then the rest.
export function quickPool(p: Progress): QuickItem[] {
  const all = allScenarios(p);
  const byId = new Map(all.map((s) => [s.id, s]));
  const fromCards: QuickItem[] = p.cards.map((c) => {
    const s = byId.get(c.scenarioId);
    return { key: c.id, ja: c.ja, reading: c.reading, zh: c.zh, voice: c.voice, scenarioId: c.scenarioId, where: s ? `${s.icon} ${s.titleZh} · 收藏` : "收藏" };
  });
  const touched = (s: Scenario) => {
    const sp = p.scenarios[s.id];
    return !!sp && (sp.listened || Object.keys(sp.shadow ?? {}).length > 0 || (sp.talked ?? 0) > 0);
  };
  const fromLines = (list: Scenario[]): QuickItem[] =>
    list.flatMap((s) =>
      s.lines
        .filter((l) => l.ja.length <= QUICK_MAX_CHARS)
        .map((l) => ({
          key: `${s.id}:${l.ja}`,
          ja: l.ja,
          reading: l.kana,
          zh: l.zh,
          voice: l.voice,
          scenarioId: s.id,
          where: `${s.icon} ${s.titleZh} · ${l.speaker}`,
        })),
    );
  const seen = new Set<string>();
  return [...fromCards, ...fromLines(all.filter(touched)), ...fromLines(all.filter((s) => !touched(s)))].filter((i) => {
    if (seen.has(i.ja)) return false;
    seen.add(i.ja);
    return true;
  });
}

// Pick n prompts, mostly from the front of the pool (cards and practised scenarios).
export function quickRound(p: Progress, n = 10): QuickItem[] {
  const pool = quickPool(p);
  const front = pool.slice(0, Math.max(n * 2, 20));
  const shuffle = <T,>(x: T[]) => x.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  return shuffle(front).slice(0, n);
}

// One prompt answered (or skipped): reaction time in ms, or null if the learner didn't speak.
export function recordQuick(ms: number | null) {
  const spoke = ms !== null;
  let next = bumpStats(read(), (s) => ({
    ...s,
    quickN: (s.quickN ?? 0) + 1,
    quickSpoke: (s.quickSpoke ?? 0) + (spoke ? 1 : 0),
    quickMsSum: (s.quickMsSum ?? 0) + (ms ?? 0),
    quickFast: (s.quickFast ?? 0) + (spoke && ms <= QUICK_LIMIT_MS ? 1 : 0),
  }));
  if (spoke) next = gainXp(next, XP.quick, "quick");
  write(next);
}

export function markListened(s: Scenario) {
  const p = bumpStats(read(), (st) => ({ ...st, listenLines: (st.listenLines ?? 0) + s.lines.length }));
  write(gainXp(updateScenario(p, s.id, (sp) => ({ ...sp, listened: true })), XP.listen, "scene"));
}

export function recordShadow(id: string, line: number, score: number) {
  const p = read();
  const prevBest = p.scenarios[id]?.shadow?.[line] ?? 0;
  const amount = XP.shadow + (score >= 80 && prevBest < 80 ? XP.shadowPass : 0);
  write(
    gainXp(
      updateScenario(p, id, (s) => ({ ...s, shadow: { ...s.shadow, [line]: Math.max(prevBest, score) } })),
      amount,
      "scene",
    ),
  );
}

export function recordTalkTurn() {
  write(gainXp(read(), XP.talkTurn, "scene"));
}

export function recordFeedback(id: string) {
  write(gainXp(updateScenario(read(), id, (s) => ({ ...s, talked: (s.talked ?? 0) + 1 })), XP.feedback, "scene"));
}

// ---- Saved expressions ----

const cardId = (ja: string) => ja.replace(/\s/g, "");

export function hasCard(p: Progress, ja: string) {
  return p.cards.some((c) => c.id === cardId(ja));
}

export function toggleCard(card: Omit<Card, "id" | "due" | "step">) {
  const p = read();
  const id = cardId(card.ja);
  if (p.cards.some((c) => c.id === id)) {
    write({ ...p, cards: p.cards.filter((c) => c.id !== id), removedCards: [...p.removedCards, id] });
  } else {
    // New cards are due right away so they show up in today's review.
    write({
      ...p,
      cards: [...p.cards, { ...card, id, due: dayKey(), step: 0 }],
      removedCards: p.removedCards.filter((r) => r !== id),
    });
  }
}

export function dueCards(p: Progress) {
  const today = dayKey();
  return p.cards.filter((c) => c.due <= today);
}

// A card that survived the 7-day interval counts as mastered.
export const mastered = (p: Progress) => p.cards.filter((c) => c.step >= 3).length;

export function reviewCard(id: string, remembered: boolean) {
  const p = read();
  const cards = p.cards.map((c) => {
    if (c.id !== id) return c;
    const step = remembered ? Math.min(c.step + 1, INTERVALS.length - 1) : 0;
    return { ...c, step, due: addDays(dayKey(), remembered ? INTERVALS[c.step] : 1) };
  });
  write(gainXp({ ...p, cards }, XP.review, "review"));
}

// ---- Diary ----

export function addDiary(entry: DiaryEntry) {
  write(gainXp({ ...read(), diary: [entry, ...read().diary] }, XP.diary, "diary"));
}

export const diaryToday = (p: Progress) => p.diary.some((d) => d.date === dayKey());

// ---- Custom scenarios ----

export function addCustom(s: CustomScenario) {
  write({ ...read(), custom: [s, ...read().custom] });
}

export function removeCustom(id: string) {
  const p = read();
  write({ ...p, custom: p.custom.filter((s) => s.id !== id) });
}

export const allScenarios = (p: Progress): Scenario[] => [...p.custom, ...scenarios];

export function findScenario(p: Progress, id: string) {
  return allScenarios(p).find((s) => s.id === id);
}

// ---- Scenario steps ----

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
  for (const s of allScenarios(p)) {
    const done = stepsDone(p, s);
    const step = (["listen", "shadow", "talk"] as Step[]).find((k) => !done[k]);
    if (step) return { scenario: s, step };
  }
  return null;
}

// ---- Today's three quests ----

export const SCENE_QUEST_XP = 15;

export type Quest = { key: "scene" | "diary" | "review"; done: boolean; label: string; detail: string };

export function quests(p: Progress): Quest[] {
  const s = todayStats(p);
  const sceneXp = s.xp?.scene ?? 0;
  const reviewed = (s.xp?.review ?? 0) > 0;
  const due = dueCards(p).length;
  return [
    {
      key: "scene",
      done: sceneXp >= SCENE_QUEST_XP,
      label: "场景练习",
      detail: sceneXp >= SCENE_QUEST_XP ? "完成" : `${sceneXp} / ${SCENE_QUEST_XP} XP`,
    },
    { key: "diary", done: diaryToday(p), label: "一分钟口语日记", detail: diaryToday(p) ? "完成" : "说说今天" },
    {
      key: "review",
      // With nothing due, there is nothing to review and the quest is free.
      done: due === 0,
      label: "复习收藏",
      detail: due > 0 ? `${due} 句待复习` : reviewed ? "完成" : "今天没有到期的",
    },
  ];
}
