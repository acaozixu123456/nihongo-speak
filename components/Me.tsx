"use client";

import Link from "next/link";
import { dayKey, dueCards, streak, useProgress, weakList } from "@/lib/client/progress";
import { allTime, lastDays } from "@/lib/client/metrics";
import { useHydrated } from "@/lib/client/hydrated";
import { calls } from "@/content/calls";
import { scenarios } from "@/content/scenarios";

// "我": the record up top, then every place to pick by hand, as tiles rather than a list.
export default function Me() {
  const p = useProgress();
  const hydrated = useHydrated();
  const all = allTime(p);
  const due = dueCards(p).length;
  const weak = weakList(p).length;
  const latest = p.episodes[0];
  const today = dayKey();
  const days = lastDays(21);
  const top = Math.max(1, ...days.map((d) => p.days[d] ?? 0));

  return (
    <main className="page">
      <Link href="/" className="back">← 今日</Link>
      <h1 className="display">我</h1>

      <Link href="/stats" className="me-card">
        <div className="me-nums">
          <span>
            <b className="accent">{hydrated ? streak(p) : "–"}</b>
            <small>日連続</small>
          </span>
          <span>
            <b>{hydrated ? all.said : "–"}</b>
            <small>話した文</small>
          </span>
          <span className="chev" aria-hidden>›</span>
        </div>
        <div className="me-days" aria-hidden>
          {days.map((d) => {
            const xp = hydrated ? (p.days[d] ?? 0) : 0;
            return (
              <i
                key={d}
                className={d === today ? "now" : undefined}
                style={xp ? { opacity: 0.35 + 0.65 * Math.min(1, xp / top), background: "var(--accent)" } : undefined}
              />
            );
          })}
        </div>
      </Link>

      <div className="tiles">
        <Link href="/episodes" className="tile wide">
          <span className="tile-mark" aria-hidden>聴</span>
          <span className="tile-name ja-serif">ラジオ</span>
          <span className="tile-sub">{hydrated && latest ? latest.title_zh : " "}</span>
          {hydrated && p.episodes.length > 0 && <span className="tile-n">{p.episodes.length}</span>}
        </Link>
        <Link href="/scenes" className="tile">
          <span className="tile-mark" aria-hidden>場</span>
          <span className="tile-name ja-serif">場面</span>
          <span className="tile-n">{scenarios.length}</span>
        </Link>
        <Link href="/call" className="tile">
          <span className="tile-mark" aria-hidden>話</span>
          <span className="tile-name ja-serif">電話</span>
          <span className="tile-n">{calls.length}</span>
        </Link>
        <Link href="/weak" className="tile">
          <span className="tile-mark" aria-hidden>苦</span>
          <span className="tile-name ja-serif">苦手</span>
          {hydrated && weak > 0 && <span className="tile-n">{weak}</span>}
        </Link>
        <Link href="/bag" className={`tile${hydrated && due > 0 ? " hot" : ""}`}>
          <span className="tile-mark" aria-hidden>帳</span>
          <span className="tile-name ja-serif">フレーズ帳</span>
          {hydrated && p.cards.length > 0 && (
            <span className="tile-n">{due > 0 ? `${due} / ${p.cards.length}` : p.cards.length}</span>
          )}
        </Link>
      </div>
    </main>
  );
}
