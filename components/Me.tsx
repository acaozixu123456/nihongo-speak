"use client";

import Link from "next/link";
import { diaryToday, dueCards, level, streak, totalXp, useProgress } from "@/lib/client/progress";
import { jobTitle } from "@/lib/client/game";
import Nav from "./Nav";

// The learner's own corner: today's speaking diary, growth over time, and saved expressions.
export default function Me() {
  const p = useProgress();
  const total = totalXp(p);
  const lv = level(total);
  const diary = diaryToday(p);
  const due = dueCards(p).length;

  const rows = [
    {
      href: "/diary",
      icon: "🎙️",
      label: "一分钟口语日记",
      detail: diary ? "今天已经说过了，可以再来一段" : "说说今天，AI 帮你改成自然的日语",
      tag: diary ? "CLEAR" : "今天",
    },
    {
      href: "/stats",
      icon: "🏆",
      label: "成长记录",
      detail: "开口时长、反应速度、发音分数的变化",
      tag: "",
    },
    {
      href: "/bag",
      icon: "🎒",
      label: "收藏的表达",
      detail: `${p.cards.length} 句${due ? ` · ${due} 句今天到期` : ""}`,
      tag: "",
    },
  ];

  return (
    <main>
      <header className="page-mast">
        <span className="icon" aria-hidden>🏠</span>
        <div>
          <h1>自宅</h1>
          <p className="muted">
            Lv.{lv.n} {jobTitle(lv.n)} · 连续 {streak(p)} 天 · 共 {total} EXP
          </p>
        </div>
      </header>
      <div className="win">
        {rows.map((r) => (
          <Link key={r.href} href={r.href} className={`quest ${r.tag === "CLEAR" ? "done" : ""}`}>
            <span className="qi">{r.icon}</span>
            <span className="qb">
              {r.label}
              <span className="small-text" style={{ display: "block" }}>{r.detail}</span>
            </span>
            <span className="qr">{r.tag}</span>
          </Link>
        ))}
      </div>
      <Nav on="me" />
    </main>
  );
}
