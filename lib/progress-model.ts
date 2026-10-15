import type { Scenario } from "@/content/scenarios";

// The learner's progress. Shared by the browser (which keeps it in localStorage)
// and the server (which keeps a synced copy for backup and reminders).

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

export type ScenarioProgress = {
  listened?: boolean;
  shadow?: Record<number, number>; // line index -> best score
  talked?: number; // conversations finished with feedback
};

export type XpKind = "scene" | "diary" | "review" | "quick" | "bonus";

// What happened on one day, for the 成长 page.
export type DayStats = {
  speakSec?: number; // seconds of the learner's own recorded Japanese
  said?: number; // utterances recorded
  pronSum?: number; // sum of pronunciation scores, with pronN scored utterances
  pronN?: number;
  listenLines?: number; // dialogue lines played back in full-scenario listening
  // Quick-response drill: prompts shown, how many the learner answered, total ms
  // from prompt to starting to speak, and how many answers started within 3s.
  quickN?: number;
  quickSpoke?: number;
  quickMsSum?: number;
  quickFast?: number;
  xp?: Partial<Record<XpKind, number>>;
};

export type DiaryEntry = {
  id: string;
  date: string;
  prompt: string;
  text: string; // what the learner said (speech recognition)
  sec: number;
  comment: string;
  natural: { ja: string; kana: string; zh: string }[];
  corrections: { you_said: string; better: string; why_zh: string }[];
};

export type CustomScenario = Scenario & { createdAt: number };

// The latest quick-response attempt at one sentence, keyed by the sentence text.
export type QuickStat = {
  day: string; // YYYY-MM-DD of the last attempt
  ms: number | null; // reaction time, or null if the learner couldn't say it (or needed a hint)
  fast: number; // answers in a row that started within 3s
};

export type Progress = {
  goal: number;
  days: Record<string, number>; // YYYY-MM-DD -> xp
  stats: Record<string, DayStats>;
  scenarios: Record<string, ScenarioProgress>;
  cards: Card[];
  removedCards: string[];
  custom: CustomScenario[];
  diary: DiaryEntry[];
  quick: Record<string, QuickStat>;
  freezes: number; // streak protectors in hand
  frozen: string[]; // days covered by a protector
  freezeAwardDay?: string;
  bonusDays: string[]; // days the all-quests bonus was paid
  updatedAt: number;
};

export const EMPTY: Progress = {
  goal: 50,
  days: {},
  stats: {},
  scenarios: {},
  cards: [],
  removedCards: [],
  custom: [],
  diary: [],
  quick: {},
  freezes: 0,
  frozen: [],
  bonusDays: [],
  updatedAt: 0,
};

export function normalize(raw: Partial<Progress> | null | undefined): Progress {
  return { ...EMPTY, ...(raw ?? {}) };
}

export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}

export const active = (p: Progress, day: string) => (p.days[day] ?? 0) > 0 || p.frozen.includes(day);

export function streak(p: Progress, today = dayKey()) {
  let day = active(p, today) ? today : addDays(today, -1);
  let n = 0;
  while (active(p, day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export const totalXp = (p: Progress) => Object.values(p.days).reduce((a, b) => a + b, 0);

// Level n starts at 50·n·(n−1) XP: 0, 100, 300, 600, 1000…
export function level(xp: number) {
  let n = 1;
  while (50 * (n + 1) * n <= xp) n++;
  return { n, from: 50 * n * (n - 1), to: 50 * (n + 1) * n };
}

const max = (a = 0, b = 0) => Math.max(a, b);

function mergeStats(a: DayStats = {}, b: DayStats = {}): DayStats {
  // Two devices rarely practise on the same day; keep whichever recorded more.
  return (a.said ?? 0) + (a.listenLines ?? 0) >= (b.said ?? 0) + (b.listenLines ?? 0) ? a : b;
}

// Combine two copies of progress (this phone and the server) without losing practice.
export function merge(a: Progress, b: Progress): Progress {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const days: Record<string, number> = { ...a.days };
  for (const [k, v] of Object.entries(b.days)) days[k] = max(days[k], v);

  const stats: Record<string, DayStats> = { ...a.stats };
  for (const [k, v] of Object.entries(b.stats)) stats[k] = mergeStats(stats[k], v);

  const scenarios: Record<string, ScenarioProgress> = { ...a.scenarios };
  for (const [id, s] of Object.entries(b.scenarios)) {
    const o = scenarios[id] ?? {};
    const shadow: Record<number, number> = { ...o.shadow };
    for (const [line, score] of Object.entries(s.shadow ?? {})) shadow[+line] = max(shadow[+line], score);
    scenarios[id] = { listened: o.listened || s.listened, shadow, talked: max(o.talked, s.talked) };
  }

  const removedCards = [...new Set([...a.removedCards, ...b.removedCards])];
  const cards = new Map<string, Card>();
  for (const c of [...a.cards, ...b.cards]) {
    const prev = cards.get(c.id);
    // The copy reviewed more recently has the later due date.
    if (!prev || c.due > prev.due) cards.set(c.id, c);
  }
  // A card saved again after being removed lives in the newer copy's list.
  const live = [...cards.values()].filter((c) => !removedCards.includes(c.id) || newer.cards.some((n) => n.id === c.id));

  const quick: Record<string, QuickStat> = { ...a.quick };
  for (const [k, v] of Object.entries(b.quick ?? {})) if (!quick[k] || v.day > quick[k].day) quick[k] = v;

  const byId = <T extends { id: string }>(x: T[], y: T[]) => [...new Map([...x, ...y].map((i) => [i.id, i])).values()];

  return {
    goal: newer.goal,
    days,
    stats,
    scenarios,
    cards: live,
    removedCards: removedCards.filter((id) => !live.some((c) => c.id === id)),
    custom: byId(a.custom, b.custom).sort((x, y) => y.createdAt - x.createdAt),
    diary: byId(a.diary, b.diary).sort((x, y) => (x.id < y.id ? 1 : -1)),
    quick,
    freezes: newer.freezes,
    frozen: [...new Set([...a.frozen, ...b.frozen])],
    freezeAwardDay: newer.freezeAwardDay,
    bonusDays: [...new Set([...a.bonusDays, ...b.bonusDays])],
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}
