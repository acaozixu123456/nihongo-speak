import { dayKey, teacherFix, type Progress, type Retell, type TeacherFix } from "./progress";

// 三回話す history: every story told, how many times, and one score per telling day.

// The score: how smoothly the third telling went. 100, less 15 for each stall in the middle of a
// sentence per minute (counted from the recording, no AI). Null for days written before stalls were.
export function retellScore(r: Retell): number | null {
  const s = r.stalls?.[2];
  return typeof s === "number" ? Math.max(0, Math.min(100, Math.round(100 - 15 * s))) : null;
}

// Life topics: stored by their Chinese prompt, shown by a Japanese name.
export const LIFE_TOPICS = [
  { zh: "今天上班（或今天一天）做了什么", ja: "今日の仕事" },
  { zh: "这个周末做了什么，或打算做什么", ja: "週末のこと" },
  { zh: "最近吃过的好吃的东西", ja: "最近おいしかった物" },
  { zh: "最近让你吃惊或开心的一件事", ja: "最近びっくりしたこと" },
];

export type TopicLog = {
  times: number; // three-time tellings, plus the one-off retellings of an earlier day's story
  scores: { date: string; score: number }[]; // oldest first
  last?: string; // date last told
};

// Per story (keyed as stored: the episode's title_zh or the life topic's prompt).
export function topicLogs(p: Progress): Map<string, TopicLog> {
  const out = new Map<string, TopicLog>();
  const get = (k: string) => {
    let t = out.get(k);
    if (!t) out.set(k, (t = { times: 0, scores: [] }));
    return t;
  };
  for (const r of p.retells ?? []) {
    const t = get(r.topic);
    t.times += r.runs ?? 1;
    t.last = r.date;
    const s = retellScore(r);
    if (s !== null) t.scores.push({ date: r.date, score: s });
    if (r.again) {
      const a = get(r.again.topic);
      a.times += 1;
      if (!a.last || a.last < r.date) a.last = r.date;
    }
  }
  return out;
}

// The latest score and the change from the one before it.
export function latest(t?: TopicLog): { score: number; up: number | null } | null {
  const s = t?.scores;
  if (!s?.length) return null;
  const now = s[s.length - 1].score;
  return { score: now, up: s.length > 1 ? now - s[s.length - 2].score : null };
}

// Every score, oldest first, for the trend.
export const allScores = (p: Progress) =>
  (p.retells ?? []).flatMap((r) => {
    const s = retellScore(r);
    return s === null ? [] : [{ date: r.date, topic: r.topic, score: s }];
  });

export const totalTimes = (p: Progress) => (p.retells ?? []).reduce((n, r) => n + (r.runs ?? 1) + (r.again ? 1 : 0), 0);

// ---- The list of stories to tell, with 森先生's picks ----

export type TopicRow = {
  key: string; // as stored in the history
  ja: string;
  zh: string;
  date?: string; // episode date
  href: string;
  times: number;
  score: number | null;
  up: number | null;
  toldToday: boolean;
  // again: she suggests telling it again; grad: told 3+ times at 70 or more.
  mark?: "again" | "grad";
};

export const GRAD_SCORE = 70;
const MAX_PICKS = 2;

function row(key: string, ja: string, zh: string, href: string, logs: Map<string, TopicLog>, date?: string): TopicRow {
  const log = logs.get(key);
  const l = latest(log);
  const r: TopicRow = { key, ja, zh, date, href, times: log?.times ?? 0, score: l?.score ?? null, up: l?.up ?? null, toldToday: log?.last === dayKey() };
  if (r.times >= 3 && r.score !== null && r.score >= GRAD_SCORE) r.mark = "grad";
  return r;
}

// Every heard episode (newest first) and the life topics; today's story first of all; up to two told
// before that she would have told again: the lowest scores under 70 first, then ones told only once.
export function retellList(p: Progress, todayEp?: { id: string } | null) {
  const logs = topicLogs(p);
  const eps = p.episodes
    .filter((e) => e.heard)
    .map((e) => row(e.title_zh, e.title_ja ?? e.title_zh, e.title_ja ? e.title_zh : "", `/retell?ep=${e.id}`, logs, e.date));
  const life = LIFE_TOPICS.map((t, i) => row(t.zh, t.ja, t.zh, `/retell?life=${i}`, logs));
  const all = [...eps, ...life];
  const first = (todayEp && eps.find((r) => r.href === `/retell?ep=${todayEp.id}`)) || eps.find((r) => !r.times) || life.find((r) => !r.times) || life[0];
  const told = all.filter((r) => r !== first && r.times > 0 && !r.toldToday && r.mark !== "grad");
  const low = told.filter((r) => r.score !== null && r.score < GRAD_SCORE).sort((a, b) => a.score! - b.score!);
  const once = told.filter((r) => r.times === 1 && !low.includes(r));
  const picks = [...low, ...once].slice(0, MAX_PICKS);
  for (const r of picks) r.mark = "again";
  return { today: first, picks, eps, life, times: totalTimes(p), stories: all.filter((r) => r.times).length };
}

// What stops the learner most, as 森先生 shows it before telling: the point the last 三回話す left unfixed
// (today's first telling is checked for it), else her nightly pick from every practice.
export function retellBlocker(p: Progress): TeacherFix | null {
  const n = (p.retells ?? []).at(-1)?.next;
  if (n?.better) return { tag: n.tag, said: n.you_said, better: n.better, mark: "", zh: n.focus_zh };
  return teacherFix(p);
}
