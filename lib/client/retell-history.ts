import type { Progress, Retell } from "./progress";

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
