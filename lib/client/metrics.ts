import { addDays, dayKey, type DiaryEntry, type Progress } from "@/lib/progress-model";

// Numbers for "how much did I actually practise, and am I getting better".

export type Totals = { speakSec: number; said: number; pron: number | null; listenLines: number; xp: number; days: number };

export function totals(p: Progress, from: string, to: string): Totals {
  let speakSec = 0;
  let said = 0;
  let pronSum = 0;
  let pronN = 0;
  let listenLines = 0;
  let xp = 0;
  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const s = p.stats[d];
    if (s) {
      speakSec += s.speakSec ?? 0;
      said += s.said ?? 0;
      pronSum += s.pronSum ?? 0;
      pronN += s.pronN ?? 0;
      listenLines += s.listenLines ?? 0;
    }
    xp += p.days[d] ?? 0;
    if ((p.days[d] ?? 0) > 0) days++;
  }
  return { speakSec, said, pron: pronN ? Math.round(pronSum / pronN) : null, listenLines, xp, days };
}

export const allTime = (p: Progress) => {
  const keys = Object.keys(p.days).sort();
  return totals(p, keys[0] ?? dayKey(), dayKey());
};

export function lastDays(n: number, end = dayKey()) {
  return Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));
}

// Week buckets ending today, oldest first.
export function weeks(p: Progress, n: number) {
  const today = dayKey();
  return Array.from({ length: n }, (_, i) => {
    const to = addDays(today, -7 * (n - 1 - i));
    const from = addDays(to, -6);
    return { from, to, ...totals(p, from, to) };
  });
}

export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m === 0) return `${s} 秒`;
  if (m < 60) return `${m} 分 ${s} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

// Diary: how fast and how accurately the learner speaks unprompted.
export function diaryMetrics(d: DiaryEntry) {
  const chars = d.text.replace(/[\s、。！？!?,.]/g, "").length;
  return {
    perMin: d.sec > 5 ? Math.round((chars / d.sec) * 60) : null,
    errorsPer100: chars ? Math.round((d.corrections.length / chars) * 1000) / 10 : 0,
    chars,
  };
}
