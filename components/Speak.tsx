"use client";

import Link from "next/link";
import { dayKey, dueCards, streak, useProgress, weakList } from "@/lib/client/progress";
import { totals } from "@/lib/client/metrics";
import { useHydrated } from "@/lib/client/hydrated";
import Nav, { Top } from "./Nav";

// Answering this many 瞬间说 prompts counts as today's drill.
const QUICK_GOAL = 5;
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

type Stage = { key: string; label: string; title: string; big: string; zh: string; href: string; done: boolean };

// 说: today's speaking practice (review what's due, drill the shakiest point, then quick-fire), one at
// a time, with the other ways to open your mouth as plain one-word rows below.
export default function Speak() {
  const p = useProgress();
  const hydrated = useHydrated();
  const today = dayKey();
  const t = totals(p, today, today);
  const due = dueCards(p).length;
  const top = weakList(p)[0];
  const days = streak(p);

  const stages: Stage[] = [
    { key: "review", label: "复习", title: "復習", big: `${due}`, zh: "把记过的话，再说一遍", href: "/review", done: due === 0 },
    {
      key: "weak",
      label: "弱点",
      title: "弱点",
      big: top?.tag ?? "",
      zh: top ? `错了 ${top.miss} 次，练一组` : "",
      href: top ? `/quick?drill=${encodeURIComponent(top.tag)}` : "/quick",
      // Practising the shakiest point today counts, even if it isn't fixed yet.
      done: !top || top.last === today,
    },
    {
      key: "quick",
      label: "瞬间说",
      title: "瞬間",
      big: `${Math.max(0, QUICK_GOAL - t.quickSpoke)}`,
      zh: "看中文，3 秒开口",
      href: "/quick",
      done: t.quickSpoke >= QUICK_GOAL,
    },
  ];
  const now = stages.find((s) => !s.done);
  const doneCount = stages.filter((s) => s.done).length;
  const unit = now?.key === "review" ? "句" : now?.key === "quick" ? "问" : "";

  // The phone's clock, not the server's: before 9:00 in Japan the server is still on yesterday.
  const d = new Date();
  const date = hydrated ? `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY_JA[d.getDay()]}）${days > 0 ? ` · 连续 ${days} 天` : ""}` : "";

  const rows = [
    { href: "/call", label: "電話" },
    { href: "/scenes", label: "場面" },
    { href: "/diary", label: "日記" },
  ];

  return (
    <main className="page">
      <Top note={date} />
      <h1 className="display">
        話す
      </h1>

      <Link href={now?.href ?? "/quick"} className="today">
        <span className="kicker">今天 {doneCount}/3</span>
        {now ? (
          <>
            <span className="today-title">
              <span className="ja-serif">{now.title}</span>
              {now.big && (
                <span className={`today-big ${now.big.length > 4 ? "long" : ""}`}>
                  {now.big}
                  {unit && <small>{unit}</small>}
                </span>
              )}
            </span>
            <span className="today-zh">{now.zh}</span>
          </>
        ) : (
          <>
            <span className="today-title">
              <span className="ja-serif">お疲れさま</span>
            </span>
            <span className="today-zh">今天的做完了</span>
          </>
        )}
        <span className="steps3" aria-hidden>
          {stages.map((s) => (
            <i key={s.key} className={s.done ? "on" : s === now ? "now" : ""} />
          ))}
        </span>
        <span className="today-go">{now ? `开始${now.label}` : "再来一组"}</span>
      </Link>

      <h2 className="sec">其他练习</h2>
      <div className="rows">
        {rows.map((r) => (
          <Link key={r.label} href={r.href} className="entry">
            <span className="entry-text ja-serif">{r.label}</span>
            <span className="chev" aria-hidden>›</span>
          </Link>
        ))}
      </div>
      <Nav on="speak" />
    </main>
  );
}
