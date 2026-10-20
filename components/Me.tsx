"use client";

import Link from "next/link";
import { useState } from "react";
import { addDays } from "@/lib/progress-model";
import { allTime, lastDays } from "@/lib/client/metrics";
import { dayKey, dueSkillCount, streak, teacherFix, teacherPlan, todaysCards, useProgress, weakList } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { FixBlock, GoodBlock } from "./TeacherMemo";
import { SenseiFace, SenseiSays, speak } from "./Sensei";

// 先生: the only place 森先生 appears. Top to bottom: her letter from last night, the one thing to fix
// (with its 1-minute drill), what got better, what she has lined up to practise, and the record.
export default function Me() {
  const p = useProgress();
  const hydrated = useHydrated();
  const [zh, setZh] = useState(false);
  const t = hydrated ? teacherPlan() : null;
  const good = t?.good;
  const fix = hydrated ? teacherFix(p) : null;
  const n = (x: number) => (hydrated && x > 0 ? <em>{x}</em> : null);
  const day = t?.day ? `${Number(t.day.slice(5, 7))}月${Number(t.day.slice(8))}日` : "";
  // 分かった？ of the last 7 days: how much of the news was understood the first time, without the text.
  const week = addDays(dayKey(), -6);
  const got = hydrated ? Object.values(p.news ?? {}).filter((m) => m.heard && m.heard >= week && m.got !== undefined) : [];
  const most = got.filter((m) => m.got === 2).length;
  const today = dayKey();
  const days21 = lastDays(21);
  const top = Math.max(1, ...days21.map((d) => p.days[d] ?? 0));

  return (
    <main className="page">
      <header className="sp-head">
        <SenseiFace size={64} nod={!!good} />
        <div>
          <h1>森先生</h1>
          <small>{day ? `${day}の手紙` : "毎晩、あなたの話を読んでいます"}</small>
        </div>
      </header>

      {t?.letter_ja ? (
        <section className="sp-letter">
          <div className="sp-letter-ja">
            <span>{t.letter_ja}</span>
            <button className="bag-play" aria-label="聞く" onClick={() => speak(t.letter_ja!)}>
              ▶
            </button>
          </div>
          {t.note_zh &&
            (zh ? (
              <p className="sp-letter-zh">{t.note_zh}</p>
            ) : (
              <button className="sp-zh" onClick={() => setZh(true)}>
                中文 ›
              </button>
            ))}
          <div className="sig">森より</div>
        </section>
      ) : (
        hydrated && <SenseiSays ja="毎晩、あなたの話したことを読んで、明日の練習を決めていますよ。" zh="每天晚上我会看你说过的话，安排第二天的练习。" />
      )}

      {fix && (
        <section className="sp-blk">
          <FixBlock f={fix} />
          <Link href={`/quick?drill=${encodeURIComponent(fix.tag)}`} className="pil-go on">
            1分 直す
          </Link>
        </section>
      )}
      {good && (
        <section className="sp-blk">
          <GoodBlock g={good} />
        </section>
      )}

      <h2 className="pl-head">
        やること<small>她安排的练习</small>
      </h2>
      <div className="pl-grid">
        <Link href="/review" className="pl"><b>復習</b><span>今天该复习的句子</span>{n(hydrated ? todaysCards(p).length : 0)}</Link>
        <Link href="/practice" className="pl"><b>練習</b><span>做过的题再练</span>{n(hydrated ? dueSkillCount(p) : 0)}</Link>
        <Link href="/weak" className="pl"><b>苦手</b><span>我常错的地方</span>{n(hydrated ? weakList(p).length : 0)}</Link>
        <Link href="/bag" className="pl"><b>フレーズ帳</b><span>收藏的句子</span></Link>
      </div>

      <h2 className="pl-head">
        記録<small>开口记录</small>
      </h2>
      <Link href="/stats" className="me-card sp-rec">
        <div className="me-nums">
          <span>
            <b className="accent">{hydrated ? streak(p) : "–"}</b>
            <small>日連続</small>
          </span>
          <span>
            <b>{hydrated ? allTime(p).said : "–"}</b>
            <small>話した文</small>
          </span>
          <span className="chev">›</span>
        </div>
        <div className="me-days" aria-hidden>
          {days21.map((d) => {
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
        {got.length > 0 && (
          <div className="sp-rec-news">
            ニュース 1回目で分かった <b>{most}/{got.length}</b> 本<small>（この7日）</small>
          </div>
        )}
      </Link>
    </main>
  );
}
