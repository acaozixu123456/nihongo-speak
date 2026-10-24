import type { Scenario } from "@/content/scenarios";
import type { Radio } from "@/lib/radio";
import { zhIsTranslation } from "@/lib/variant";

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
// news: the NHK article (id) the episode talks about, for one made after this morning's news.
export type RadioEpisode = Radio & { id: string; date: string; heard?: boolean; asked?: AskedItem[]; news?: string };
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
// skips: days in a row the point didn't come up at all; it is dropped from the reminder after a few.
export type RetellPoint = { tag: string; zh: string; focus_zh: string; you_said: string; better: string; skips?: number };
// mps: morae per second over the stretch actually spoken; pauses: silences of a second or more inside
// it, per telling; perMin: the same per minute (tellings differ in length); stalls: per minute, only
// those in the middle of a sentence, the measure that depends least on the story told (Huensch 2023).
// texts: what was said, word for word; natural: the last telling said naturally, checked the next
// day. again: that day's one telling of an earlier day's story first, in the same units.
// miss: the sentences (indexes) marked ？ as not caught by ear; they come back, in another voice, before the
// next articles, and are cleared once heard again.
// voice: the voice picked for the article (NEWS_VOICES), when not the anchor's.
// said: 一文ずつ三回話す, by sentence: 1 said whole the third time, 0 not.
export type NewsMark = { heard?: string; got?: number; told?: string; miss?: number[]; voice?: string; said?: Record<number, 0 | 1> };
export const NEWS_MARKS_KEPT = 120;

export type Retell = {
  date: string;
  topic: string;
  cpm: number[];
  mps?: number[];
  pauses?: number[];
  perMin?: number[];
  stalls?: number[];
  texts?: string[];
  natural?: string[];
  // Expressions praised that day (said well, word for word), never praised again.
  good?: string[];
  again?: { topic: string; mps?: number; pauses: number; stalls?: number; uptake?: string[] };
  next?: RetellPoint;
  // Times this story was told three times that day (one record per day and story).
  runs?: number;
};
export const RETELLS_KEPT = 60;

// 予行演習: a real conversation coming up (asking the boss for a day off, the ward office), played out
// three times with the other side reacting differently each time, then reported on once it really
// happened. `missed` are the lines the learner couldn't get out in real life, rewritten in Japanese.
export type RehearsalTalk = { aiRole: string; aiVoice: string; userRole: string; goalZh: string; setup: string; opening: { ja: string; zh: string } };
export type Rehearsal = {
  id: string;
  date: string;
  askZh: string;
  titleZh: string;
  who: string;
  person?: string;
  talk: RehearsalTalk;
  twists: string[]; // one per round: how the other side behaves this time
  lines: { ja: string; kana: string; zh: string }[];
  rounds: number; // rounds finished
  debrief?: { date: string; noteZh: string; missed: { ja: string; kana: string; zh: string }[] };
};
export const REHEARSALS_KEPT = 30;

// What a practice's end said (三回話す, a call, a scene), kept for the 先生 page instead of being shown
// on the practice page: what went well, the one line to say better, and the natural versions.
export type PracticeNote = {
  at: number;
  day: string;
  area: "retell" | "call" | "scene";
  title: string;
  good?: string; // zh
  fix?: { said: string; better: string; zh: string };
  lines?: { you?: string; ja: string; zh: string }[];
};
export const NOTES_KEPT = 30;

export type Progress = {
  goal: number;
  days: Record<string, number>; // YYYY-MM-DD -> xp
  stats: Record<string, DayStats>;
  scenarios: Record<string, ScenarioProgress>;
  cards: Card[];
  removedCards: string[];
  // Ids of 重来一次 scenarios deleted on some copy, so merging with another copy doesn't bring them back.
  removedCustom?: string[];
  custom: CustomScenario[];
  diary: DiaryEntry[];
  episodes: RadioEpisode[]; // newest first
  quick: Record<string, QuickStat>;
  weak: Record<string, WeakPoint>;
  skills: Record<string, Skill>; // keyed by the Japanese without spaces or punctuation
  people: Record<string, PersonMemory[]>;
  retells: Retell[]; // newest last // keyed by the character's id in content/calls.ts
  // 三回話す keywords: how many tellings in a row (across days) each was used right and without a
  // stall; at 2 it gives its place to a new one. at: when last counted, so the newer copy wins.
  keyRuns?: Record<string, { n: number; at: number }>;
  // NHKやさしいことばニュース, by NHK's id: the day it was heard to the end, how much of it was understood
  // the first time without the text (0 あまり, 1 半分, 2 ほとんど), the day it was told in 三回話す.
  news?: Record<string, NewsMark>;
  rehearsals: Rehearsal[]; // newest last
  notes?: PracticeNote[]; // newest last
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
  rehearsals: [],
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
  const removedCustom = [...new Set([...(a.removedCustom ?? []), ...(b.removedCustom ?? [])])];
  const cards = new Map<string, Card>();
  for (const c of [...a.cards, ...b.cards]) {
    const prev = cards.get(c.id);
    // The copy reviewed more recently has the later due date; on a tie, the one whose Chinese was repaired.
    if (!prev || c.due > prev.due || (c.due === prev.due && zhIsTranslation(c.zh) && !zhIsTranslation(prev.zh))) cards.set(c.id, c);
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

  const byDay = new Map<string, Retell>();
  for (const r of [...(a.retells ?? []), ...(b.retells ?? [])]) {
    const k = `${r.date} ${r.topic}`;
    const was = byDay.get(k);
    const runs = Math.max(was?.runs ?? 1, r.runs ?? 1);
    byDay.set(k, runs > 1 ? { ...r, runs } : r);
  }
  const retells = [...byDay.values()]
    .sort((x, y) => (x.date < y.date ? -1 : 1))
    .slice(-RETELLS_KEPT);

  const keyRuns = { ...(a.keyRuns ?? {}) };
  for (const [k, v] of Object.entries(b.keyRuns ?? {})) if (!keyRuns[k] || v.at > keyRuns[k].at) keyRuns[k] = v;

  const news: Record<string, NewsMark> = { ...(a.news ?? {}) };
  for (const [k, v] of Object.entries(b.news ?? {})) {
    const o = news[k] ?? {};
    const later = (x?: string, y?: string) => (x && y ? (x > y ? x : y) : (x ?? y));
    news[k] = { heard: later(o.heard, v.heard), told: later(o.told, v.told), got: (newer === b ? v.got : o.got) ?? v.got ?? o.got, miss: (newer === b ? v.miss : o.miss) ?? v.miss ?? o.miss, voice: (newer === b ? v.voice : o.voice) ?? v.voice ?? o.voice, said: o.said || v.said ? (newer === b ? { ...o.said, ...v.said } : { ...v.said, ...o.said }) : undefined };
    for (const f of ["heard", "told", "got", "miss", "voice", "said"] as const) if (news[k][f] === undefined) delete news[k][f];
  }
  const newsKept = Object.fromEntries(Object.entries(news).sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, NEWS_MARKS_KEPT));

  // The copy that got further (more rounds, or a report) wins.
  const rehearsals = [...[...(a.rehearsals ?? []), ...(b.rehearsals ?? [])]
    .reduce((m, r) => {
      const o = m.get(r.id);
      if (!o || r.rounds > o.rounds || (r.debrief && !o.debrief)) m.set(r.id, r);
      return m;
    }, new Map<string, Rehearsal>())
    .values()]
    .sort((x, y) => (x.id < y.id ? -1 : 1))
    .slice(-REHEARSALS_KEPT);

  const notes = [...new Map([...(a.notes ?? []), ...(b.notes ?? [])].map((n) => [n.at, n])).values()]
    .sort((x, y) => x.at - y.at)
    .slice(-NOTES_KEPT);

  const byId = <T extends { id: string }>(x: T[], y: T[]) => [...new Map([...x, ...y].map((i) => [i.id, i])).values()];

  return {
    goal: newer.goal,
    days,
    stats,
    scenarios,
    cards: live,
    removedCards: removedCards.filter((id) => !live.some((c) => c.id === id)),
    custom: byId(a.custom, b.custom)
      .filter((s) => !removedCustom.includes(s.id))
      .sort((x, y) => y.createdAt - x.createdAt),
    removedCustom,
    diary: byId(a.diary, b.diary).sort((x, y) => (x.id < y.id ? 1 : -1)),
    episodes: byId(a.episodes ?? [], b.episodes ?? [])
      .map((e) => {
        const copies = [...(a.episodes ?? []), ...(b.episodes ?? [])].filter((o) => o.id === e.id);
        const asked = [...new Map(copies.flatMap((o) => o.asked ?? []).map((x) => [x.text, x])).values()];
        const title_ja = e.title_ja ?? copies.find((o) => o.title_ja)?.title_ja;
        // Readings checked later (lib/client/progress.ts ensureReadings) on any of the copies.
        const checked = e.readings ? e : copies.find((o) => o.readings);
        // やさしく written later (for an old episode, or one long-pressed line) on any of the copies.
        const same = copies.filter((o) => o.lines.length === e.lines.length);
        const lines = e.lines.map((l, i) => {
          const easy = same.map((o) => o.lines[i].easy).find((x) => x) ?? same.map((o) => o.lines[i].easy).find((x) => x !== undefined);
          return easy === undefined ? l : { ...l, easy };
        });
        return {
          ...e,
          lines,
          heard: e.heard || copies.some((o) => o.heard),
          ...(asked.length ? { asked } : {}),
          ...(title_ja ? { title_ja } : {}),
          ...(checked ? { story: checked.story, words: checked.words, readings: checked.readings } : {}),
        };
      })
      .sort((x, y) => (x.id < y.id ? 1 : -1))
      .slice(0, EPISODES_KEPT),
    quick,
    weak,
    skills,
    people,
    retells,
    keyRuns,
    news: newsKept,
    rehearsals,
    notes,
    freezes: newer.freezes,
    frozen: [...new Set([...a.frozen, ...b.frozen])],
    freezeAwardDay: newer.freezeAwardDay,
    bonusDays: [...new Set([...a.bonusDays, ...b.bonusDays])],
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    epoch: a.epoch,
  };
}
