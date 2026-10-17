"use client";

import { useSyncExternalStore } from "react";
import { scenarios, type Scenario } from "@/content/scenarios";
import type { Radio } from "@/lib/radio";
import {
  EMPTY,
  EPISODES_KEPT,
  MEMORIES_KEPT,
  active,
  addDays,
  dayKey,
  level,
  merge,
  normalize,
  streak,
  totalXp,
  type AskedItem,
  type Skill,
  type Card,
  type CustomScenario,
  type DayStats,
  type DiaryEntry,
  type DrillItem,
  type Learned,
  type PersonMemory,
  type Progress,
  type RadioEpisode,
  type ScenarioProgress,
  type StuckLine,
  type WeakPoint,
  type XpKind,
} from "@/lib/progress-model";

export { dayKey, level, streak, totalXp };
export type { AskedItem, Skill, Card, CustomScenario, DiaryEntry, DrillItem, Learned, PersonMemory, Progress, RadioEpisode, StuckLine, WeakPoint };

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

// Wipes all practice on this device and, through the next sync, on the server and every other device.
export function resetProgress() {
  write({ ...EMPTY, goal: read().goal, epoch: read().epoch + 1 });
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

// Notes what was practised today for the 今日 recap; a miss sticks for the rest of the day.
function learn(p: Progress, items: Learned[]): Progress {
  return bumpStats(p, (s) => {
    const list = [...(s.learned ?? [])];
    for (const it of items) {
      const i = list.findIndex((x) => x.ja === it.ja);
      if (i < 0) list.push(it);
      else list[i] = { ...list[i], miss: list[i].miss || it.miss };
    }
    return { ...s, learned: list.slice(-200) };
  });
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

// ---- 摸鱼模式 ----

export function recordMoyu(sec: number) {
  write(bumpStats(read(), (s) => ({ ...s, moyuSec: (s.moyuSec ?? 0) + sec })));
}

// A sentence the learner asked to hear again: kept for today, to be said out loud after work.
export function recordStuck(line: StuckLine) {
  write(
    bumpStats(read(), (s) =>
      s.stuck?.some((x) => x.ja === line.ja) ? s : { ...s, stuck: [...(s.stuck ?? []), line].slice(-30) },
    ),
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

const DIARY_VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";

// Short lines only: the drill is about getting a sentence out in a few seconds.
const QUICK_MAX_CHARS = 32;

// Saved cards first, then lines from scenarios the learner has worked on, then the rest.
export function quickPool(p: Progress): QuickItem[] {
  const all = allScenarios(p);
  const byId = new Map(all.map((s) => [s.id, s]));
  const fromCards: QuickItem[] = p.cards.map((c) => {
    const s = byId.get(c.scenarioId);
    return { key: c.id, ja: c.ja, reading: c.reading, zh: c.zh, voice: c.voice, scenarioId: c.scenarioId, where: s ? `${s.titleZh} · 收藏` : "收藏" };
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
          where: `${s.titleZh} · 你是${l.speaker}`,
        })),
    );
  // The learner's own diary, rewritten naturally: their own words are the ones they most need.
  const fromDiary: QuickItem[] = p.diary.slice(0, 10).flatMap((d) =>
    d.natural
      .filter((n) => n.ja.length <= QUICK_MAX_CHARS)
      .map((n) => ({
        key: `diary:${d.id}:${n.ja}`,
        ja: n.ja,
        reading: n.kana,
        zh: n.zh,
        voice: DIARY_VOICE,
        scenarioId: `diary:${d.id}`,
        where: `你的日记 · ${Number(d.date.slice(5, 7))}月${Number(d.date.slice(8))}日`,
      })),
  );
  const seen = new Set<string>();
  return [...fromCards, ...fromDiary, ...fromLines(all.filter(touched)), ...fromLines(all.filter((s) => !touched(s)))].filter((i) => {
    if (seen.has(i.ja)) return false;
    seen.add(i.ja);
    return true;
  });
}

const shuffle = <T,>(x: T[]) => x.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

// Pick n prompts. Sentences the learner missed or answered slowly come back first,
// then ones never tried, then fast ones not seen for a while; mastered ones
// (three fast answers in a row) only fill any space left.
export function quickRound(p: Progress, n = 10): QuickItem[] {
  const today = dayKey();
  const pool = quickPool(p);
  const stat = (i: QuickItem) => p.quick[i.ja];
  const weak = pool.filter((i) => {
    const s = stat(i);
    return s && s.fast === 0 && s.day < today;
  });
  const fresh = pool.filter((i) => !stat(i));
  const stale = pool
    .filter((i) => {
      const s = stat(i);
      return s && s.fast > 0 && s.fast < 3 && s.day <= addDays(today, -2);
    })
    .sort((x, y) => (stat(x)!.day < stat(y)!.day ? -1 : 1));
  const rest = pool.filter((i) => !weak.includes(i) && !fresh.includes(i) && !stale.includes(i));
  const picked = [
    ...shuffle(weak).slice(0, Math.ceil(n * 0.4)),
    ...fresh.slice(0, Math.max(n * 2, 20)),
    ...stale,
    ...shuffle(rest),
  ];
  // Keep the priority order when choosing, then mix so weak ones aren't all at the start.
  const chosen = [...new Map(picked.map((i) => [i.ja, i])).values()].slice(0, n);
  return shuffle(chosen);
}

// One prompt answered: reaction time in ms, or null if the learner couldn't say it.
// A hinted answer counts as spoken (for speaking time and XP) but not as recalled.
export function recordQuick(item: QuickItem, ms: number | null, hinted = false) {
  const spoke = ms !== null;
  const fast = spoke && !hinted && ms <= QUICK_LIMIT_MS;
  const p = read();
  const prev = p.quick[item.ja];
  let next = bumpStats(
    {
      ...p,
      quick: { ...p.quick, [item.ja]: { day: dayKey(), ms: spoke && !hinted ? ms : null, fast: fast ? (prev?.fast ?? 0) + 1 : 0 } },
    },
    (s) => ({
      ...s,
      quickN: (s.quickN ?? 0) + 1,
      quickSpoke: (s.quickSpoke ?? 0) + (spoke && !hinted ? 1 : 0),
      quickMsSum: (s.quickMsSum ?? 0) + (spoke && !hinted ? ms : 0),
      quickFast: (s.quickFast ?? 0) + (fast ? 1 : 0),
    }),
  );
  if (spoke) next = gainXp(next, XP.quick, "quick");
  write(learn(next, [{ ja: item.ja, kana: item.reading, zh: item.zh, src: "quick", miss: !fast, voice: item.voice }]));
}

// The AI judged today's answer as wrong in meaning: it was quick, but it doesn't count as recalled.
export function markQuickOff(ja: string) {
  const p = read();
  const prev = p.quick[ja];
  if (!prev || prev.day !== dayKey()) return;
  const wasFast = prev.fast > 0;
  write(
    bumpStats({ ...p, quick: { ...p.quick, [ja]: { ...prev, fast: 0 } } }, (s) => ({
      ...s,
      quickFast: Math.max(0, (s.quickFast ?? 0) - (wasFast ? 1 : 0)),
    })),
  );
}

// ---- Weak points the AI coach found ----

export type JudgedPoint = { tag: string; zh: string; ok: boolean };

// One judged answer: count each grammar point it tested as right or wrong.
export function recordPoints(points: JudgedPoint[], fixes: { you_said: string; better: string }[]) {
  if (!points.length) return;
  const p = read();
  const today = dayKey();
  const weak = { ...p.weak };
  for (const pt of points) {
    const o = weak[pt.tag] ?? { tag: pt.tag, zh: pt.zh, hit: 0, miss: 0, last: today, examples: [] };
    const ex = pt.ok ? o.examples : [...fixes.slice(0, 1).map((f) => ({ said: f.you_said, better: f.better })), ...o.examples]
          .filter((e, i, all) => all.findIndex((x) => x.said === e.said) === i)
          .slice(0, 4);
    weak[pt.tag] = {
      ...o,
      zh: o.zh || pt.zh,
      hit: o.hit + (pt.ok ? 1 : 0),
      miss: o.miss + (pt.ok ? 0 : 1),
      last: today,
      lastMiss: pt.ok ? o.lastMiss : today,
      examples: ex,
    };
  }
  write({ ...p, weak });
}

// How shaky a point still is: each correct use earns back half a mistake.
export const weakness = (w: WeakPoint) => w.miss - w.hit * 0.5;

// Points still worth drilling, shakiest first.
export function weakList(p: Progress) {
  return Object.values(p.weak)
    .filter((w) => w.miss > 0 && weakness(w) > 0)
    .sort((x, y) => weakness(y) - weakness(x) || (x.last < y.last ? 1 : -1));
}

// The shakiest points not practised today, as items for the daily 练一练 round: the pattern (or the
// tag) with the latest mistake as its example, pitched so the exercises make the learner use the form.
export const WEAK_EP = "weak:";
export function weakItems(p: Progress, n: number): SkillItem[] {
  const today = dayKey();
  return weakList(p)
    .filter((w) => w.last !== today)
    .slice(0, n)
    .map((w) => ({
      ja: w.pattern ?? w.tag,
      zh: w.zh,
      kind: "weak",
      note: w.examples[0] ? `言った：${w.examples[0].said} → 正しくは：${w.examples[0].better}`.slice(0, 180) : undefined,
      ep: `${WEAK_EP}${w.tag}`,
    }));
}

// Every question in the round on a weak point counts as one use of it, right or wrong.
export function recordWeakRound(results: { tag: string; ok: boolean }[]) {
  const p = read();
  const today = dayKey();
  const weak = { ...p.weak };
  const noted: Learned[] = [];
  for (const { tag, ok } of results) {
    const o = weak[tag];
    if (!o) continue;
    weak[tag] = { ...o, hit: o.hit + (ok ? 1 : 0), miss: o.miss + (ok ? 0 : 1), last: today, lastMiss: ok ? o.lastMiss : today };
    noted.push({ ja: o.pattern ?? o.tag, zh: o.zh, src: "weak", miss: !ok });
  }
  write(learn({ ...p, weak }, noted));
}

// Tags the coach has used before, so it names the same point the same way next time.
export const knownTags = (p: Progress) =>
  Object.values(p.weak)
    .sort((x, y) => (x.last < y.last ? 1 : -1))
    .slice(0, 40)
    .map((w) => w.tag);

export function saveDrill(tag: string, d: { pattern: string; explain: string; drill: DrillItem[] }) {
  const p = read();
  const o = p.weak[tag];
  if (!o) return;
  write({ ...p, weak: { ...p.weak, [tag]: { ...o, ...d } } });
}

// A targeted drill as quick-response prompts.
export function drillRound(w: WeakPoint): QuickItem[] {
  return shuffle(
    (w.drill ?? []).map((d) => ({
      key: `drill:${w.tag}:${d.ja}`,
      ja: d.ja,
      reading: d.reading,
      zh: d.zh,
      voice: DRILL_VOICE,
      scenarioId: "",
      where: `${d.where} · 强化 ${w.tag}`,
    })),
  );
}

const DRILL_VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-MayuNeural";

// How many sentences have been answered fast three times in a row.
export const quickMastered = (p: Progress) => Object.values(p.quick).filter((s) => s.fast >= 3).length;

export function markListened(s: Scenario) {
  const p = bumpStats(read(), (st) => ({ ...st, listenLines: (st.listenLines ?? 0) + s.lines.length }));
  write(gainXp(updateScenario(p, s.id, (sp) => ({ ...sp, listened: true })), XP.listen, "scene"));
}

export function recordShadow(id: string, line: number, score: number) {
  const p = read();
  const prevBest = p.scenarios[id]?.shadow?.[line] ?? 0;
  const amount = XP.shadow + (score >= 80 && prevBest < 80 ? XP.shadowPass : 0);
  const l = findScenario(p, id)?.lines[line];
  const noted = l ? learn(p, [{ ja: l.ja, kana: l.kana, zh: l.zh, src: "scene", miss: score < 80, voice: l.voice }]) : p;
  write(
    gainXp(
      updateScenario(noted, id, (s) => ({ ...s, shadow: { ...s.shadow, [line]: Math.max(prevBest, score) } })),
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

// ---- Phone-call characters ----

// What a character learned about the learner in this call, for the next one.
export function remember(person: string, ja: string) {
  const line = ja.trim();
  if (!line) return;
  const p = read();
  const notes = [...(p.people[person] ?? []), { date: dayKey(), ja: line }].slice(-MEMORIES_KEPT);
  write({ ...p, people: { ...p.people, [person]: notes } });
}

export const memories = (p: Progress, person: string) => p.people[person] ?? [];

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
  const c = p.cards.find((x) => x.id === id);
  const noted = c ? learn({ ...p, cards }, [{ ja: c.ja, kana: c.reading, zh: c.zh, src: "review", miss: !remembered, voice: c.voice }]) : { ...p, cards };
  write(gainXp(noted, XP.review, "review"));
}

// ---- Diary ----

export function addDiary(entry: DiaryEntry) {
  write(gainXp({ ...read(), diary: [entry, ...read().diary] }, XP.diary, "diary"));
}

export const diaryToday = (p: Progress) => p.diary.some((d) => d.date === dayKey());

// ---- 趣味电台 episodes ----

// The two hosts: Aoi and Keita map to bright Gemini voices and fall back to Azure's free ones.
export const RADIO_VOICE = { A: "ja-JP-AoiNeural", B: "ja-JP-KeitaNeural" } as const;

// Keep a new episode with its notes, and put its key sentences into review right away.
export function saveEpisode(radio: Radio): RadioEpisode {
  const p = read();
  const ep: RadioEpisode = { ...radio, id: `r${Date.now()}`, date: dayKey() };
  const skip = new Set([...p.cards.map((c) => c.id), ...p.removedCards]);
  const fresh = new Map<string, Card>();
  for (const ph of radio.phrases) {
    const id = cardId(ph.ja);
    if (!skip.has(id)) fresh.set(id, { id, ja: ph.ja, zh: ph.zh, voice: RADIO_VOICE.A, scenarioId: `radio:${ep.id}`, due: dayKey(), step: 0 });
  }
  write({ ...p, episodes: [ep, ...p.episodes].slice(0, EPISODES_KEPT), cards: [...p.cards, ...fresh.values()] });
  return ep;
}

export function markHeard(id: string) {
  const p = read();
  if (p.episodes.some((e) => e.id === id && !e.heard)) write({ ...p, episodes: p.episodes.map((e) => (e.id === id ? { ...e, heard: true } : e)) });
}

export function saveAsked(id: string, item: AskedItem) {
  const p = read();
  write({
    ...p,
    episodes: p.episodes.map((e) => (e.id === id ? { ...e, asked: [...(e.asked ?? []).filter((x) => x.text !== item.text), item].slice(-20) } : e)),
  });
}

export const findEpisode = (p: Progress, id: string) => p.episodes.find((e) => e.id === id);

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

// ---- 练一练: what was learned from 趣味电台, on a spaced schedule ----

const SKILL_DAYS = [1, 2, 4, 7, 15, 30]; // next practice after a clean session at each level
export const skillKey = (ja: string) => ja.replace(/[\s、。，,.!！?？「」『』・〜~…]/g, "");

export type SkillItem = Pick<Skill, "ja" | "zh" | "note" | "ep"> & { kind: Skill["kind"] | "weak" };

// Everything an episode teaches, plus what was asked about on its page.
export function episodeItems(ep: RadioEpisode): SkillItem[] {
  return [
    ...(ep.words ?? []).map((w) => ({ ja: w.ja, zh: w.zh, kind: "word" as const, note: w.kana, ep: ep.id })),
    ...ep.phrases.map((x) => ({ ja: x.ja, zh: x.zh, kind: "phrase" as const, ep: ep.id })),
    ...(ep.grammar ?? []).map((g) => ({ ja: g.pattern, zh: g.zh, kind: "grammar" as const, note: g.ja, ep: ep.id })),
    ...(ep.asked ?? []).map((x) => ({ ja: x.text, zh: x.meaning_zh, kind: "asked" as const, ep: ep.id })),
  ];
}

// Due items, most overdue and weakest first.
export function dueSkills(p: Progress, n: number, skip: Set<string> = new Set()): Skill[] {
  const today = dayKey();
  return Object.entries(p.skills)
    .filter(([k, s]) => s.due <= today && !skip.has(k))
    .sort(([, a], [, b]) => (a.due === b.due ? a.level - b.level : a.due < b.due ? -1 : 1))
    .slice(0, n)
    .map(([, s]) => s);
}

export const dueSkillCount = (p: Progress) => dueSkills(p, 999).length;

// After a round: an item answered right every time moves up a level and comes back later; a miss
// drops it a level and brings it back tomorrow.
// replay: the same set again, which is practice but no proof of memory, so it can only bring items back sooner.
export function recordSkills(results: { item: SkillItem; ok: boolean }[], replay = false) {
  const p = read();
  const skills = { ...p.skills };
  const byKey = new Map<string, { item: SkillItem; ok: boolean }>();
  for (const r of results) {
    const k = skillKey(r.item.ja);
    const prev = byKey.get(k);
    byKey.set(k, { item: r.item, ok: (prev?.ok ?? true) && r.ok });
  }
  for (const [k, { item, ok }] of byKey) {
    const o = skills[k];
    if (replay && ok) continue;
    const level = o ? (ok ? Math.min(o.level + 1, SKILL_DAYS.length - 1) : Math.max(o.level - 1, 0)) : ok ? 1 : 0;
    skills[k] = {
      ...item,
      kind: item.kind === "weak" ? "grammar" : item.kind,
      ...(o ? { ep: o.ep } : {}),
      level,
      due: addDays(dayKey(), ok ? SKILL_DAYS[o ? o.level : 0] : 1),
      seen: (o?.seen ?? 0) + 1,
      miss: (o?.miss ?? 0) + (ok ? 0 : 1),
    };
  }
  const noted = [...byKey.values()].map(({ item, ok }) => ({ ja: item.ja, kana: item.kind === "word" ? item.note : undefined, zh: item.zh, src: "game" as const, miss: !ok }));
  write(gainXp(learn({ ...p, skills }, noted), XP.review, "review"));
}
