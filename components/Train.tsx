"use client";

import Link from "next/link";
import { XP, dayKey, dueCards, nextStep, quests, SCENE_QUEST_XP, streak, useProgress, weakList } from "@/lib/client/progress";
import { totals } from "@/lib/client/metrics";
import Nav from "./Nav";
import { WeakList } from "./WeakList";

// Answering this many 瞬间说 prompts counts as today's drill.
const QUICK_GOAL = 5;

type Stage = { key: string; icon: string; label: string; detail: string; href: string; done: boolean };

// Today's training in one place: review what's due, drill the shakiest grammar point, then quick-fire speaking.
// Also holds the daily quests and the weak-point list that used to have their own pages.
export default function Train() {
  const p = useProgress();
  const today = dayKey();
  const t = totals(p, today, today);
  const due = dueCards(p).length;
  const top = weakList(p)[0];
  const qs = quests(p);
  const next = nextStep(p);

  const stages: Stage[] = [
    {
      key: "review",
      icon: "⛩️",
      label: "复习",
      detail: due ? `${due} 句到期，复习过的会换个新句子考你` : "今天没有到期的句子",
      href: "/review",
      done: due === 0,
    },
    {
      key: "weak",
      icon: "📕",
      label: "弱点强化",
      detail: top ? `「${top.tag}」错了 ${top.miss} 次${top.last === today ? " · 今天练过了" : ""}` : "暂时没有薄弱点",
      href: top ? `/quick?drill=${encodeURIComponent(top.tag)}` : "/quick",
      // Practising the shakiest point today counts, even if it isn't fixed yet.
      done: !top || top.last === today,
    },
    {
      key: "quick",
      icon: "🥋",
      label: "瞬间说",
      detail: t.quickSpoke
        ? `今天答了 ${t.quickSpoke} 题，平均 ${((t.quickMs ?? 0) / 1000).toFixed(1)} 秒开口`
        : `看中文，3 秒内开口，答 ${QUICK_GOAL} 题`,
      href: "/quick",
      done: t.quickSpoke >= QUICK_GOAL,
    },
  ];
  const now = stages.find((s) => !s.done);
  const doneCount = stages.filter((s) => s.done).length;

  const extra = {
    scene: {
      icon: next?.scenario.icon ?? "🏢",
      href: next ? `/s/${next.scenario.id}?step=${next.step}` : "/scenes",
      reward: `+${SCENE_QUEST_XP}`,
      detail: next ? `${next.scenario.titleZh}` : "所有场景都通关了",
    },
    diary: { icon: "🏠", href: "/diary", reward: `+${XP.diary}`, detail: "说说今天" },
    review: { icon: "⛩️", href: "/review", reward: "+2/句", detail: "" },
  };

  return (
    <main>
      <header className="page-mast">
        <span className="icon" aria-hidden>🥋</span>
        <div>
          <h1>今日の修行</h1>
          <p className="muted">
            {doneCount}/{stages.length} · 连续 {streak(p)} 天 · 保护卡 {p.freezes}
          </p>
        </div>
      </header>

      <div className="win">
        {stages.map((s, i) => (
          <Link key={s.key} href={s.href} className={`quest ${s.done ? "done" : ""} ${s === now ? "now" : ""}`}>
            <span className="qi">{s.icon}</span>
            <span className="qb">
              {i + 1}. {s.label}
              <span className="small-text" style={{ display: "block" }}>{s.detail}</span>
            </span>
            <span className="qr">{s.done ? "CLEAR" : s === now ? "▶" : ""}</span>
          </Link>
        ))}
        <Link href={now?.href ?? "/quick"} className="btn primary next-cta" style={{ display: "block", textAlign: "center" }}>
          {now ? `${doneCount ? "继续" : "开始"}：${now.label} →` : "今天练完了！再来一组瞬间说 →"}
        </Link>
      </div>

      <h2>今日任务</h2>
      <div className="win">
        {qs
          .filter((q) => q.key !== "review")
          .map((q) => (
            <Link key={q.key} href={extra[q.key].href} className={`quest ${q.done ? "done" : ""}`}>
              <span className="qi">{extra[q.key].icon}</span>
              <span className="qb">
                {q.label}
                <span className="small-text" style={{ display: "block" }}>
                  {q.done ? "完成" : q.key === "scene" ? `${extra.scene.detail} · ${q.detail}` : extra[q.key].detail}
                </span>
              </span>
              <span className="qr">{q.done ? "CLEAR" : `${extra[q.key].reward} EXP`}</span>
            </Link>
          ))}
        <div className="bonus">
          {p.bonusDays.includes(today) ? "🎁 三项全清，奖励已领取" : `🎁 场景、日记、复习三项全清再奖励 +${XP.quests} EXP`}
        </div>
      </div>

      <h2 id="weak">弱点の書</h2>
      <WeakList />
      <Nav on="train" />
    </main>
  );
}
