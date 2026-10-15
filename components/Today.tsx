"use client";

import Link from "next/link";
import { scenarios } from "@/content/scenarios";
import {
  GOALS,
  dayKey,
  dueCards,
  nextStep,
  setGoal,
  stepsDone,
  streak,
  todayXp,
  useProgress,
  type Progress,
  type Step,
} from "@/lib/client/progress";
import Nav from "./Nav";

const STEP_LABEL: Record<Step, string> = { listen: "① 精听", shadow: "② 跟读", talk: "③ 对话" };
const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

function Ring({ value, goal }: { value: number; goal: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const ratio = Math.min(1, value / goal);
  return (
    <div className="ring">
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle className="track" cx="46" cy="46" r={r} fill="none" strokeWidth="8" />
        <circle
          className={`fill ${ratio >= 1 ? "done" : ""}`}
          cx="46"
          cy="46"
          r={r}
          fill="none"
          strokeWidth="8"
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
    return { key: dayKey(d), label: WEEKDAY[d.getDay()], today: i === 6 };
  });
  return (
    <div className="week">
      {days.map((d) => {
        const xp = p.days[d.key] ?? 0;
        return (
          <div key={d.key}>
            <i className={`${xp >= p.goal ? "full" : xp > 0 ? "some" : ""} ${d.today ? "today" : ""}`} />
            {d.label}
          </div>
        );
      })}
    </div>
  );
}

function greeting(xp: number, goal: number, days: number) {
  if (xp >= goal) return "今天的目标完成了，多练的都是赚的。";
  if (xp > 0) return `还差 ${goal - xp} XP 就完成今天的目标。`;
  if (days > 0) return `今天练一下，连续记录就变成 ${days + 1} 天。`;
  return "从一个场景开始，几分钟就够。";
}

export default function Today() {
  const p = useProgress();
  const xp = todayXp(p);
  const days = streak(p);
  const next = nextStep(p);
  const due = dueCards(p).length;
  const groups = [
    { key: "work", label: "职场" },
    { key: "life", label: "生活" },
  ] as const;

  return (
    <main>
      <div className="card">
        <div className="hero">
          <Ring value={xp} goal={p.goal} />
          <div style={{ flex: 1 }}>
            <div className={`streak ${xp > 0 ? "" : "cold"}`}>🔥 {days} 天</div>
            <div className="muted">{greeting(xp, p.goal, days)}</div>
          </div>
        </div>
        <Week p={p} />
      </div>

      {due > 0 && (
        <Link href="/review" className="go" style={{ background: "var(--good)" }}>
          <div className="label">该复习了</div>
          <div className="title">{due} 句收藏的表达</div>
          <div className="cta">开始复习 →</div>
        </Link>
      )}

      {next ? (
        <Link href={`/s/${next.scenario.id}?step=${next.step}`} className="go">
          <div className="label">继续练习 · {STEP_LABEL[next.step]}</div>
          <div className="title">
            {next.scenario.icon} {next.scenario.titleZh}
          </div>
          <div className="cta">开始 →</div>
        </Link>
      ) : (
        <div className="card">所有场景都练完一轮了 🎉 挑一个再练，或者去复习收藏的句子。</div>
      )}

      {groups.map((g) => (
        <section key={g.key}>
          <h2>{g.label}</h2>
          {scenarios
            .filter((s) => s.category === g.key)
            .map((s) => {
              const done = stepsDone(p, s);
              const best = Object.values(p.scenarios[s.id]?.shadow ?? {});
              const avg = best.length ? Math.round(best.reduce((a, b) => a + b, 0) / best.length) : null;
              const allDone = done.listen && done.shadow && done.talk;
              return (
                <Link key={s.id} href={`/s/${s.id}`} className="card scard">
                  <div className="icon">{s.icon}</div>
                  <div className="body">
                    <div className="row spread">
                      <strong>{s.titleZh}</strong>
                      <span className="muted">{allDone ? "✓ 完成" : s.level}</span>
                    </div>
                    <div className="muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.title}
                    </div>
                    <div className="dots">
                      <i className={done.listen ? "on" : ""} />
                      <i className={done.shadow ? "on" : ""} />
                      <i className={done.talk ? "on" : ""} />
                      {avg !== null && <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>跟读均分 {avg}</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
        </section>
      ))}

      <div className="card">
        <div className="row spread">
          <span className="muted">每日目标</span>
          <div className="row">
            {GOALS.map((g) => (
              <button key={g} className={`small ${p.goal === g ? "on" : ""}`} onClick={() => setGoal(g)}>
                {g === 30 ? "轻松" : g === 50 ? "标准" : "认真"} {g}
              </button>
            ))}
          </div>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          整段听一遍 +10，跟读一句 +2（首次 80 分再 +5），对话一轮 +3，拿到点评 +10，复习一句 +2。
        </p>
      </div>
      <Nav on="today" />
    </main>
  );
}
