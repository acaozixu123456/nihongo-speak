"use client";

import { addDays, dayKey, type Progress } from "@/lib/progress-model";
import { lastDays } from "@/lib/client/metrics";
import Info from "./Info";

export const DAY_GOAL = 15 * 60; // seconds a day
const STOPS = [1, 3, 5, 10, 20, 50, 100, 200]; // hours
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

// Speed-round reaction time over days [from, to], in seconds, or null with none.
function reaction(p: Progress, from: string, to: string) {
  let sum = 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    sum += p.stats[d]?.drillMsSum ?? 0;
    n += p.stats[d]?.drillMsN ?? 0;
  }
  return n ? sum / n / 1000 : null;
}

export function drillTotals(p: Progress) {
  const today = dayKey();
  let total = 0;
  let first = "";
  for (const [d, s] of Object.entries(p.stats)) {
    total += s.drillSec ?? 0;
    if (s.drillMsN && (!first || d < first)) first = d;
  }
  const days = lastDays(7, today).map((d) => ({ d, sec: p.stats[d]?.drillSec ?? 0 }));
  const now = reaction(p, addDays(today, -6), today);
  // The first week with speed rounds, once it no longer overlaps this week.
  const start = first && addDays(first, 6) < addDays(today, -6) ? reaction(p, first, addDays(first, 6)) : null;
  return { today: p.stats[today]?.drillSec ?? 0, total, days, now, start };
}

const hours = (sec: number) => {
  const h = sec / 3600;
  // Down, so the number never shows a stop not reached yet.
  return h < 10 ? (Math.floor(h * 10) / 10).toFixed(1) : String(Math.floor(h));
};

// Time on the 型ドリル home: today against 15 minutes, all hours against the next stop, and how fast
// sentences come now against the first week.
export default function DrillTime({ p }: { p: Progress }) {
  const { today, total, days, now, start } = drillTotals(p);
  const frac = Math.min(1, today / DAY_GOAL);
  const met = today >= DAY_GOAL;
  const h = total / 3600;
  const stop = STOPS.find((x) => x > h) ?? STOPS[STOPS.length - 1];
  const prevStop = [...STOPS].reverse().find((x) => x <= h) ?? 0;
  const top = Math.max(DAY_GOAL, ...days.map((x) => x.sec));
  const R = 30;
  const C = 2 * Math.PI * R;
  const better = now !== null && start !== null && now < start - 0.05;

  return (
    <section className="dr-time" aria-label="練習時間">
      <div className={`dr-ring${met ? " met" : ""}`}>
        <svg viewBox="0 0 72 72" aria-hidden>
          <circle cx="36" cy="36" r={R} className="bg" />
          <circle cx="36" cy="36" r={R} className="fg" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
        </svg>
        <span>
          {met ? <b className="ok">✓</b> : <b>{Math.floor(today / 60)}</b>}
          <small>{met ? `${Math.floor(today / 60)}分` : "/15分"}</small>
        </span>
      </div>

      <div className="dr-time-main">
        <div className="dr-total">
          <small>累計</small>
          <b>{hours(total)}</b>
          <small>時間</small>
          <Info label="练习量和进步">
            只算真正在练的时间（停下 45 秒不算）。<br />
            研究：说出一个句型所需的时间，随练习量按幂函数缩短，头几个小时进步最快，之后慢慢继续变快（DeKeyser 1997，语法自动化）。<br />
            FSI：日语约 2200 小时到工作水平。每天 15 分钟，一年约 90 小时。<br />
            反应＝速度轮开口用时（按 12 字的句子换算）。
          </Info>
        </div>
        <div className="dr-stop" aria-label={`次 ${stop} 時間`}>
          <i style={{ width: `${Math.min(100, ((h - prevStop) / (stop - prevStop)) * 100)}%` }} />
          <em>{stop}h</em>
        </div>
        <div className="dr-week" aria-hidden>
          {days.map((x) => (
            <span key={x.d} className={x.d === dayKey() ? "now" : ""}>
              <i className={x.sec >= DAY_GOAL ? "met" : ""} style={{ height: `${Math.max(x.sec ? 8 : 0, (x.sec / top) * 100)}%` }} />
              <small>{WEEK[new Date(`${x.d}T00:00:00Z`).getUTCDay()]}</small>
            </span>
          ))}
        </div>
        {now !== null && (
          <div className={`dr-react${better ? " up" : ""}`}>
            <small>反応</small>
            {start !== null && (
              <>
                <s>{start.toFixed(1)}s</s>
                <i aria-hidden>→</i>
              </>
            )}
            <b>{now.toFixed(1)}s</b>
            {better && <em>↓{(start! - now).toFixed(1)}</em>}
          </div>
        )}
      </div>
    </section>
  );
}
