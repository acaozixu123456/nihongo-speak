"use client";

import Link from "next/link";
import { dayKey, streak, teacherPlan, useProgress } from "@/lib/client/progress";
import { allTime, lastDays } from "@/lib/client/metrics";
import { useHydrated } from "@/lib/client/hydrated";

// 记录: the streak and days; every feature itself is on 今日.
export default function Me() {
  const p = useProgress();
  const hydrated = useHydrated();
  const all = allTime(p);
  const today = dayKey();
  const days = lastDays(21);
  const top = Math.max(1, ...days.map((d) => p.days[d] ?? 0));
  const note = hydrated ? teacherPlan()?.note_zh : "";

  return (
    <main className="page">
      <Link href="/" className="back">← 今日</Link>
      <h1 className="display">記録</h1>

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

      {note && (
        <div className="teacher-note">
          <div className="label">先生のメモ</div>
          <p className="muted">{note}</p>
        </div>
      )}

      <Link href="/today" className="row-link">
        今天学过的 <span aria-hidden>›</span>
      </Link>
    </main>
  );
}
