"use client";

import Link from "next/link";
import {
  XP,
  dayKey,
  level,
  nextStep,
  quests,
  streak,
  todayXp,
  totalXp,
  useProgress,
  type Progress,
  type Step,
} from "@/lib/client/progress";
import { formatDuration, totals } from "@/lib/client/metrics";
import { addDays } from "@/lib/progress-model";
import Nav from "./Nav";

const STEP_LABEL: Record<Step, string> = { listen: "精听", shadow: "跟读", talk: "AI 对话" };
const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

function Ring({ value, goal }: { value: number; goal: number }) {
  const r = 41;
  const c = 2 * Math.PI * r;
  const ratio = Math.min(1, value / goal);
  return (
    <div className="ring">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle className="track" cx="48" cy="48" r={r} fill="none" strokeWidth="9" />
        <circle
          className="fill"
          cx="48"
          cy="48"
          r={r}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
        />
      </svg>
      <div className="ring-label">
        <div>
          <strong>{ratio >= 1 ? "✓" : value}</strong>
          <br />
          <span>{ratio >= 1 ? `${value} XP` : `/ ${goal} XP`}</span>
        </div>
      </div>
    </div>
  );
}

function Week({ p }: { p: Progress }) {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i);
    return { key: dayKey(d), label: i === 6 ? "今天" : WEEKDAY[d.getDay()], today: i === 6 };
  });
  return (
    <div className="week">
      {days.map((d) => {
        const xp = p.days[d.key] ?? 0;
        const frozen = p.frozen.includes(d.key);
        return (
          <div key={d.key}>
            <i className={`${xp >= p.goal ? "full" : xp > 0 || frozen ? "some" : ""} ${d.today ? "today" : ""}`}>
              {frozen ? "🛡️" : xp >= p.goal ? "✓" : ""}
            </i>
            {d.label}
          </div>
        );
      })}
    </div>
  );
}

function headline(xp: number, goal: number, days: number) {
  if (xp >= goal) return "今天的目标完成了！";
  if (xp > 0) return `再练 ${goal - xp} XP 就完成`;
  if (days > 0) return `练一下，连续变成 ${days + 1} 天`;
  return "今天从 5 分钟开始";
}

export default function Today() {
  const p = useProgress();
  const xp = todayXp(p);
  const days = streak(p);
  const next = nextStep(p);
  const qs = quests(p);
  const lv = level(totalXp(p));
  const today = dayKey();
  const t = totals(p, today, today);
  const week = totals(p, addDays(today, -7), addDays(today, -1));
  const now = new Date();

  const questLink = {
    scene: next ? `/s/${next.scenario.id}?step=${next.step}` : "/scenes",
    diary: "/diary",
    review: "/review",
  };
  const questIcon = { scene: next?.scenario.icon ?? "🎬", diary: "🎙️", review: "🃏" };
  const questDetail = (k: "scene" | "diary" | "review", detail: string) =>
    k === "scene" && next ? `${next.scenario.titleZh} · ${STEP_LABEL[next.step]} · ${detail}` : detail;

  return (
    <main>
      <div className="top">
        <div>
          <div className="small-text">
            {now.getMonth() + 1}月{now.getDate()}日 星期{WEEKDAY[now.getDay()]}
          </div>
          <h1 style={{ margin: 0 }}>今天</h1>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className={`chip ${xp > 0 ? "" : "cold"}`}>🔥 {days}</span>
          {p.freezes > 0 && <span className="chip" title="连续保护卡">🛡️ {p.freezes}</span>}
          <Link href="/stats" className="chip" style={{ textDecoration: "none" }}>
            Lv {lv.n}
          </Link>
        </div>
      </div>

      <div className="hero">
        <div className="hero-top">
          <Ring value={xp} goal={p.goal} />
          <div style={{ flex: 1 }}>
            <div className="hero-title">{headline(xp, p.goal, days)}</div>
            <div className="small-text" style={{ marginTop: 4 }}>
              {days > 0 ? `已连续 ${days} 天` : "开始新的连续记录"}
              {p.freezes > 0 ? ` · 有 ${p.freezes} 张保护卡` : " · 连续 7 天送一张保护卡"}
            </div>
          </div>
        </div>
        <Week p={p} />
      </div>

      <h2>今日任务</h2>
      <div className="quests">
        {qs.map((q) => (
          <Link key={q.key} href={questLink[q.key]} className={`quest ${q.done ? "done" : ""}`}>
            <div className="qicon">{questIcon[q.key]}</div>
            <div className="qbody">
              <div className="qtitle">{q.label}</div>
              <div className="small-text ellipsis">{questDetail(q.key, q.detail)}</div>
            </div>
            <div className="check">{q.done ? "✓" : ""}</div>
          </Link>
        ))}
      </div>
      <div className="bonus">
        {p.bonusDays.includes(today) ? "🎁 三项全部完成，已领取 +" : "🎁 三项都完成再奖励 +"}
        {XP.quests} XP
      </div>

      <h2>今天的成果</h2>
      <div className="card">
        {t.said === 0 && t.listenLines === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            还没开始。今天开口说的时长、句数和发音分数都会记在这里。
          </p>
        ) : (
          <div className="kpis">
            <div className="kpi">
              <b>{formatDuration(t.speakSec)}</b>
              <span>开口时长</span>
            </div>
            <div className="kpi">
              <b>{t.said}</b>
              <span>说了几句</span>
            </div>
            <div className="kpi">
              <b>{t.pron ?? "–"}</b>
              <span>
                发音均分
                {t.pron !== null && week.pron !== null && t.pron !== week.pron && (
                  <span className={`delta ${t.pron > week.pron ? "up" : "down"}`}>
                    {" "}
                    {t.pron > week.pron ? "↑" : "↓"}
                    {Math.abs(t.pron - week.pron)}
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      <Link href="/new" className="go">
        <div className="label">想练别的？</div>
        <div className="title">✨ 让 AI 写一个新场景</div>
        <div className="cta">输入一句话就能生成 →</div>
      </Link>
      <Nav on="today" />
    </main>
  );
}
