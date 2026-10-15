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
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
const KANJI_NUM = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

// 15 -> 十五, 31 -> 三十一: the masthead date is written the Japanese way.
function kanjiNum(n: number) {
  if (n <= 10) return KANJI_NUM[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens > 1 ? KANJI_NUM[tens] : ""}十${ones ? KANJI_NUM[ones] : ""}`;
}

function Week({ p }: { p: Progress }) {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i);
    return { key: dayKey(d), label: WEEKDAY_JA[d.getDay()], date: d.getDate(), today: i === 6 };
  });
  return (
    <div className="week">
      {days.map((d) => {
        const xp = p.days[d.key] ?? 0;
        const frozen = p.frozen.includes(d.key);
        const state = xp >= p.goal ? "full" : frozen ? "frozen" : xp > 0 ? "some" : "";
        return (
          <div key={d.key} className={`${state} ${d.today ? "today" : ""}`}>
            <span className="wd">{d.label}</span>
            <span className="cell">
              {state === "full" && <i className="stamp">済</i>}
              {state === "frozen" && <i className="stamp ink">守</i>}
              {state === "some" && <i className="dot" />}
            </span>
            <span className="dn">{d.date}</span>
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
  const ratio = Math.min(1, xp / p.goal);

  const questLink = {
    scene: next ? `/s/${next.scenario.id}?step=${next.step}` : "/scenes",
    diary: "/diary",
    review: "/review",
  };
  const questIcon = { scene: next?.scenario.icon ?? "🎬", diary: "🎙️", review: "🃏" };
  const questDetail = (k: "scene" | "diary" | "review", detail: string) =>
    k === "scene" && next ? `${next.scenario.titleZh} · ${STEP_LABEL[next.step]} · ${detail}` : detail;

  return (
    <main className="today">
      <section className="poster">
        <div className="poster-top">
          <div className="poster-date">
            {kanjiNum(now.getMonth() + 1)}月{kanjiNum(now.getDate())}日 · {WEEKDAY_JA[now.getDay()]}曜日
            <Link href="/stats">
              Lv {lv.n}
              {p.freezes > 0 && ` · 保护卡 ${p.freezes}`}
            </Link>
          </div>
          <Link href="/stats" className={`seal ${xp > 0 ? "" : "cold"}`} aria-label={`连续 ${days} 天`}>
            <b>{days}</b>
            <span>日連続</span>
          </Link>
        </div>
        <h1 className="poster-kanji">今日</h1>
        <div className="poster-xp">
          <strong>{xp}</strong>
          <span>/ {p.goal} XP</span>
        </div>
        <div className="poster-head">{headline(xp, p.goal, days)}</div>
        <div className="brush">
          <div style={{ width: `${ratio * 100}%` }} />
        </div>
        <Week p={p} />
      </section>

      <h2 className="big-h">
        課題<span>今日任务 · 向左滑</span>
      </h2>
      <ol className="deck">
        {qs.map((q, i) => (
          <li key={q.key}>
            <Link href={questLink[q.key]} className={`qcard q-${q.key} ${q.done ? "done" : ""}`}>
              <span className="qcard-num" aria-hidden>{KANJI_NUM[i + 1]}</span>
              <span className="qcard-icon">{questIcon[q.key]}</span>
              <div className="qcard-title">{q.label}</div>
              <div className="qcard-detail">{questDetail(q.key, q.detail)}</div>
              <div className="qcard-go">{q.done ? "再练一次" : "开始"} →</div>
              {q.done && <i className="stamp big">済</i>}
            </Link>
          </li>
        ))}
      </ol>
      <div className="bonus">
        {p.bonusDays.includes(today) ? "三项全部完成，已领取 +" : "三项都完成再奖励 +"}
        {XP.quests} XP
      </div>

      <section className="band">
        <h2 className="big-h">
          成果<span>今天的成果</span>
        </h2>
        {t.said === 0 && t.listenLines === 0 ? (
          <p className="band-empty">还没开始。今天开口说的时长、句数和发音分数都会记在这里。</p>
        ) : (
          <div className="band-nums">
            <div>
              <b>{formatDuration(t.speakSec)}</b>
              <span>开口时长</span>
            </div>
            <div>
              <b>{t.said}</b>
              <span>说了几句</span>
            </div>
            <div>
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
      </section>

      <Link href="/new" className="newbig">
        <span className="newbig-k" aria-hidden>新</span>
        <span className="newbig-l">想练别的？</span>
        <span className="newbig-t">让 AI 写一个新场景 →</span>
      </Link>
      <Nav on="today" />
    </main>
  );
}
