import type { Scenario } from "@/content/scenarios";
import type { Radio } from "@/lib/radio";

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
  moyuSec?: number; // seconds listened in 摸鱼模式
  stuck?: StuckLine[]; // sentences replayed in 摸鱼模式, to say out loud later
  learned?: Learned[]; // what was practised this day (练一练, review, 瞬间说, shadowing), for 今日
};

// One thing practised on a day, for the 今日 recap. miss: got it wrong at least once that day.
export type LearnedSrc = "radio" | "game" | "review" | "quick" | "scene" | "weak" | "diary" | "stuck";
export type Learned = { ja: string; kana?: string; zh: string; src: LearnedSrc; miss?: boolean; voice?: string };

export type StuckLine = { ja: string; reading?: string; zh: string; voice: string };

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

// One 趣味电台 episode, kept with its notes (transcript, key sentences, words, grammar) to look back on.
// asked: what the learner selected and asked AI about on the episode's page (newest last), for 练一练.
export type AskedItem = { text: string; meaning_zh: string };
export type RadioEpisode = Radio & { id: string; date: string; heard?: boolean; asked?: AskedItem[] };
export const EPISODES_KEPT = 50;

export type CustomScenario = Scenario & { createdAt: number };

// The latest quick-response attempt at one sentence, keyed by the sentence text.
export type QuickStat = {
  day: string; // YYYY-MM-DD of the last attempt
  ms: number | null; // reaction time, or null if the learner couldn't say it (or needed a hint)
  fast: number; // answers in a row that started within 3s
};

// A grammar point or expression the AI coach has been tracking across answers.
export type DrillItem = { ja: string; reading?: string; zh: string; where: string };
export type WeakPoint = {
  tag: string; // e.g. 「〜てもらえますか」（依頼）
  zh: string; // what the point is, in Chinese
  hit: number; // answers that used it correctly
  miss: number; // answers that got it wrong
  last: string; // YYYY-MM-DD
  lastMiss?: string;
  examples: { said: string; better: string }[]; // latest mistakes, newest first
  pattern?: string; // the form in one line, e.g. 「Vて ＋ もらえますか」
  explain?: string; // AI explanation for the targeted drill
  drill?: DrillItem[];
};

// One thing learned from 趣味电台 (a word, key sentence, grammar point or something asked about), practised
// in 练一练 on a spaced schedule. level 0–5 picks the exercises: recognising it first, then using it in
// new sentences, then saying it.
export type Skill = {
  ja: string;
  zh: string;
  kind: "word" | "phrase" | "grammar" | "asked";
  note?: string; // reading, or the example sentence for grammar
  ep: string; // episode it came from
  level: number;
  due: string; // YYYY-MM-DD
  seen: number; // sessions it was in
  miss: number; // sessions it was missed in
};

// What a recurring phone-call character (課長, a client, a friend) remembers from earlier calls:
// a line or two per call, newest last, so the next call can pick up where the last one left off.
export type PersonMemory = { date: string; ja: string };
export const MEMORIES_KEPT = 5;

// 三回話す: one day's telling, as characters per minute for each of the three times. The first time is
// always a new story, so how it moves across days shows real progress, not just repetition.
// `next` is the one point still not said right at the end of the day, shown before the next day's first telling.
export type RetellPoint = { tag: string; zh: string; focus_zh: string; you_said: string; better: string };
// mps: morae per second over the stretch actually spoken; pauses: silences of a second or more inside
// it, per telling. again: that day's one telling of an earlier day's story first, in the same units.
export type Retell = {
  date: string;
  topic: string;
  cpm: number[];
  mps?: number[];
  pauses?: number[];
  again?: { topic: string; mps?: number; pauses: number };
  next?: RetellPoint;
};
export const RETELLS_KEPT = 60;

export type Progress = {
  goal: number;
  days: Record<string, number>; // YYYY-MM-DD -> xp
  stats: Record<string, DayStats>;
  scenarios: Record<string, ScenarioProgress>;
  cards: Card[];
  removedCards: string[];
  custom: CustomScenario[];
  diary: DiaryEntry[];
  episodes: RadioEpisode[]; // newest first
  quick: Record<string, QuickStat>;
  weak: Record<string, WeakPoint>;
  skills: Record<string, Skill>; // keyed by the Japanese without spaces or punctuation
  people: Record<string, PersonMemory[]>;
  retells: Retell[]; // newest last // keyed by the character's id in content/calls.ts
  freezes: number; // streak protectors in hand
  frozen: string[]; // days covered by a protector
  freezeAwardDay?: string;
  bonusDays: string[]; // days the all-quests bonus was paid
  updatedAt: number;
  // Bumped when the learner clears everything; an older copy (another device, the server) is then dropped, not merged.
  epoch: number;
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
  episodes: [],
  quick: {},
  weak: {},
  skills: {},
  people: {},
  retells: [],
  freezes: 0,
  frozen: [],
  bonusDays: [],
  updatedAt: 0,
  epoch: 0,
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
  const weight = (s: DayStats) => (s.said ?? 0) + (s.listenLines ?? 0) + (s.moyuSec ?? 0) / 60;
  return weight(a) >= weight(b) ? a : b;
}

// Combine two copies of progress (this phone and the server) without losing practice.
export function merge(a: Progress, b: Progress): Progress {
  if (a.epoch !== b.epoch) return a.epoch > b.epoch ? a : b;
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

  const weak: Record<string, WeakPoint> = { ...a.weak };
  for (const [k, v] of Object.entries(b.weak ?? {})) {
    const o = weak[k];
    if (!o || v.hit + v.miss > o.hit + o.miss || (v.hit + v.miss === o.hit + o.miss && v.last > o.last)) {
      weak[k] = { ...v, pattern: v.pattern ?? o?.pattern, explain: v.explain ?? o?.explain, drill: v.drill ?? o?.drill };
    }
  }

  const skills: Record<string, Skill> = { ...(a.skills ?? {}) };
  for (const [k, v] of Object.entries(b.skills ?? {})) {
    const o = skills[k];
    if (!o || v.seen > o.seen || (v.seen === o.seen && v.due > o.due)) skills[k] = v;
  }

  const people: Record<string, PersonMemory[]> = { ...(a.people ?? {}) };
  for (const [k, v] of Object.entries(b.people ?? {})) {
    const all = [...(people[k] ?? []), ...v];
    people[k] = [...new Map(all.map((m) => [`${m.date} ${m.ja}`, m])).values()].sort((x, y) => (x.date < y.date ? -1 : 1)).slice(-MEMORIES_KEPT);
  }

  const retells = [...new Map([...(a.retells ?? []), ...(b.retells ?? [])].map((r) => [`${r.date} ${r.topic}`, r])).values()]
    .sort((x, y) => (x.date < y.date ? -1 : 1))
    .slice(-RETELLS_KEPT);

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
    episodes: byId(a.episodes ?? [], b.episodes ?? [])
      .map((e) => {
        const copies = [...(a.episodes ?? []), ...(b.episodes ?? [])].filter((o) => o.id === e.id);
        const asked = [...new Map(copies.flatMap((o) => o.asked ?? []).map((x) => [x.text, x])).values()];
        return { ...e, heard: e.heard || copies.some((o) => o.heard), ...(asked.length ? { asked } : {}) };
      })
      .sort((x, y) => (x.id < y.id ? 1 : -1))
      .slice(0, EPISODES_KEPT),
    quick,
    weak,
    skills,
    people,
    retells,
    freezes: newer.freezes,
    frozen: [...new Set([...a.frozen, ...b.frozen])],
    freezeAwardDay: newer.freezeAwardDay,
    bonusDays: [...new Set([...a.bonusDays, ...b.bonusDays])],
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    epoch: a.epoch,
  };
}
