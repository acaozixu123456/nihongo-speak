"use client";

import Link from "next/link";
import { XP, dayKey, nextStep, quests, SCENE_QUEST_XP, streak, useProgress, weakList } from "@/lib/client/progress";
import { totals } from "@/lib/client/metrics";
import Nav from "./Nav";

// The quest log: today's three quests, then side quests for extra practice.
export default function Quests() {
  const p = useProgress();
  const qs = quests(p);
  const next = nextStep(p);
  const today = dayKey();
  const t = totals(p, today, today);
  const weak = weakList(p).length;
  const done = qs.filter((q) => q.done).length;
  const main = {
    scene: { icon: next?.scenario.icon ?? "🏢", href: next ? `/s/${next.scenario.id}?step=${next.step}` : "/b/custom", reward: `+${SCENE_QUEST_XP}` },
    diary: { icon: "🏠", href: "/diary", reward: `+${XP.diary}` },
    review: { icon: "⛩️", href: "/review", reward: "+2/句" },
  };
  return (
    <main>
      <header className="page-mast">
        <span className="icon" aria-hidden>📜</span>
        <div>
          <h1>任務</h1>
          <p className="muted">
            今日 {done}/{qs.length} · 连续 {streak(p)} 天 · 保护卡 {p.freezes}
          </p>
        </div>
      </header>

      <h2>今日任务</h2>
      <div className="win">
        {qs.map((q) => (
          <Link key={q.key} href={main[q.key].href} className={`quest ${q.done ? "done" : ""}`}>
            <span className="qi">{main[q.key].icon}</span>
            <span className="qb">
              {q.label}
              <span className="small-text" style={{ display: "block" }}>
                {q.key === "scene" && next ? `${next.scenario.titleZh} · ${q.detail}` : q.detail}
              </span>
            </span>
            <span className="qr">{q.done ? "CLEAR" : `${main[q.key].reward} EXP`}</span>
          </Link>
        ))}
        <div className="bonus">
          {p.bonusDays.includes(today) ? "🎁 三项全清，奖励已领取" : `🎁 三项全清再奖励 +${XP.quests} EXP`}
        </div>
      </div>

      <h2>修行</h2>
      <div className="win">
        <Link href="/quick" className="quest">
          <span className="qi">🥋</span>
          <span className="qb">
            道場 · 瞬间说
            <span className="small-text" style={{ display: "block" }}>
              {t.quickSpoke ? `今天答了 ${t.quickSpoke} 题，平均 ${((t.quickMs ?? 0) / 1000).toFixed(1)} 秒开口` : "看中文，3 秒内开口"}
            </span>
          </span>
          <span className="qr">+2/题</span>
        </Link>
        <Link href="/weak" className="quest">
          <span className="qi">📕</span>
          <span className="qb">
            弱点之书
            <span className="small-text" style={{ display: "block" }}>{weak ? `AI 记下了 ${weak} 个薄弱点` : "说错的语法点会记在这里"}</span>
          </span>
          <span className="qr">强化</span>
        </Link>
        <Link href="/new" className="quest">
          <span className="qi">🏪</span>
          <span className="qb">
            コンビニ · 进新货
            <span className="small-text" style={{ display: "block" }}>想练什么场合，让 AI 写成新场景</span>
          </span>
          <span className="qr">NEW</span>
        </Link>
      </div>
      <Nav on="quests" />
    </main>
  );
}
