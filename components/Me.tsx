"use client";

import Link from "next/link";
import { dayKey, dueSkillCount, streak, teacherFix, teacherPlan, todaysCards, useProgress, weakList } from "@/lib/client/progress";
import { allTime, lastDays } from "@/lib/client/metrics";
import { useHydrated } from "@/lib/client/hydrated";
import { FixBlock, GoodBlock } from "./TeacherMemo";
import { SenseiFace, SenseiSays } from "./Sensei";

// 先生: 森先生's page. Her letter about the week, the record, and everything she looks after
// (sentences due, practice, the learner's weak points, saved phrases).
export default function Me() {
  const p = useProgress();
  const hydrated = useHydrated();
  const all = allTime(p);
  const today = dayKey();
  const days = lastDays(21);
  const top = Math.max(1, ...days.map((d) => p.days[d] ?? 0));
  const t = hydrated ? teacherPlan() : null;
  const good = t?.good;
  const fix = hydrated ? teacherFix(p) : null;
  const n = (x: number) => (hydrated && x > 0 ? <em>{x}</em> : null);

  return (
    <main className="page">
      <Link href="/" className="back">← 今日</Link>
      <div className="sensei-hero">
        <SenseiFace size={112} />
        <b>森先生</b>
        <small>いつも聞いていますよ</small>
      </div>

      {t?.letter_ja ? (
        <div className="sensei-letter">
          <p className="ja">{t.letter_ja}</p>
          {t.note_zh && <p className="zh">{t.note_zh}</p>}
          <div className="sig">森より</div>
        </div>
      ) : (
        <SenseiSays
          ja="毎晩、あなたの話したことを読んで、明日の練習を決めていますよ。"
          zh={t?.note_zh || "每天晚上我会看你说过的话，安排第二天的练习。"}
        />
      )}

      {(good || fix) && (
        <div className="teacher-note">
          {good && <GoodBlock g={good} />}
          {fix && <FixBlock f={fix} />}
          {fix && (
            <Link href={`/quick?drill=${encodeURIComponent(fix.tag)}`} className="today-go memo-go">
              練習する
            </Link>
          )}
        </div>
      )}

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

      <div className="label">先生と</div>
      <div className="pl-grid">
        <Link href="/review" className="pl"><b>復習</b><span>今天该复习的句子</span>{n(hydrated ? todaysCards(p).length : 0)}</Link>
        <Link href="/practice" className="pl"><b>練習</b><span>做过的题再练</span>{n(hydrated ? dueSkillCount(p) : 0)}</Link>
        <Link href="/weak" className="pl"><b>苦手</b><span>我常错的地方</span>{n(hydrated ? weakList(p).length : 0)}</Link>
        <Link href="/bag" className="pl"><b>フレーズ帳</b><span>收藏的句子</span></Link>
        <Link href="/today" className="pl"><b>今日</b><span>今天学过的</span></Link>
      </div>
    </main>
  );
}
