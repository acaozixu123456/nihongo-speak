"use client";

import Link from "next/link";
import { diaryToday, dueCards, streak, useProgress, weakList } from "@/lib/client/progress";
import { allTime, formatDuration } from "@/lib/client/metrics";
import Nav from "./Nav";

// "我" opens from either page's top-right button, so going back returns to whichever it was.
function BackLink() {
  return (
    <a
      href="/"
      className="back"
      onClick={(e) => {
        if (history.length > 1) {
          e.preventDefault();
          history.back();
        }
      }}
    >
      ← 返回
    </a>
  );
}

// The learner's own corner: diary, weak points, saved expressions and growth.
export default function Me() {
  const p = useProgress();
  const all = allTime(p);
  const due = dueCards(p).length;
  const weak = weakList(p);

  const rows = [
    { href: "/diary", glyph: "話", label: "口语日记", detail: diaryToday(p) ? "今天说过了，可以再来一段" : "用一分钟说说今天，AI 帮你改成自然的日语" },
    { href: "/weak", glyph: "弱", label: "薄弱点", detail: weak.length ? `${weak.length} 个 · 最常错的是「${weak[0].tag}」` : "AI 发现你反复出错的地方会记在这里" },
    { href: "/bag", glyph: "蔵", label: "收藏的表达", detail: `${p.cards.length} 句${due ? ` · ${due} 句今天该复习` : ""}` },
    { href: "/stats", glyph: "伸", label: "成长记录", detail: "开口时长、反应速度、发音分数的变化" },
  ];

  return (
    <main>
      <BackLink />
      <header className="page-mast">
        <div>
          <h1>我</h1>
          <p className="muted">
            连续 {streak(p)} 天 · 一共开口 {formatDuration(all.speakSec)} · {all.said} 句
          </p>
        </div>
      </header>
      <div className="list">
        {rows.map((r) => (
          <Link key={r.href} href={r.href} className="row-link">
            <span className="glyph">{r.glyph}</span>
            <span className="row-text">
              {r.label}
              <small>{r.detail}</small>
            </span>
            <span className="chev" aria-hidden>›</span>
          </Link>
        ))}
      </div>
      <Nav on="me" />
    </main>
  );
}
