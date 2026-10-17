"use client";

import Link from "next/link";
import { dueCards, streak, useProgress, weakList } from "@/lib/client/progress";
import { allTime } from "@/lib/client/metrics";
import { useHydrated } from "@/lib/client/hydrated";

// "我": everything to pick by hand, for when today's route isn't what you want.
export default function Me() {
  const p = useProgress();
  const hydrated = useHydrated();
  const all = allTime(p);
  const due = dueCards(p).length;

  const rows = [
    { href: "/episodes", label: "往期", n: p.episodes.length },
    { href: "/scenes", label: "場面" },
    { href: "/call", label: "電話" },
    { href: "/diary", label: "日記" },
    { href: "/weak", label: "弱点", n: weakList(p).length },
    { href: "/bag", label: "収蔵", n: p.cards.length, hot: due > 0 },
  ];

  return (
    <main className="page">
      <Link href="/" className="back">← 今日</Link>
      <h1 className="display">我</h1>
      {hydrated && (
        <Link href="/stats" className="me-stats">
          <span>
            <b className="accent">{streak(p)}</b>
            <small>連続</small>
          </span>
          <span>
            <b>{all.said}</b>
            <small>話した文</small>
          </span>
        </Link>
      )}
      <div className="rows">
        {rows.map((r) => (
          <Link key={r.href} href={r.href} className="entry">
            <span className="entry-text ja-serif">{r.label}</span>
            {hydrated && !!r.n && <span className={r.hot ? "entry-count" : "entry-n"}>{r.n}</span>}
            <span className="chev" aria-hidden>›</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
