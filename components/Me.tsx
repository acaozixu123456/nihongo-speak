"use client";

import Link from "next/link";
import { addDays } from "@/lib/progress-model";
import { dayKey, dueSkillCount, teacherFix, teacherPlan, todaysCards, useProgress, weakList } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { FixBlock, GoodBlock } from "./TeacherMemo";
import { SenseiFace, SenseiSays } from "./Sensei";

// 先生 tab: 森先生, the one thing she wants fixed, and everything she looks after (sentences due,
// practice, weak points, saved phrases). Her letter and the record are one row down, in メモと記録.
export default function Me() {
  const p = useProgress();
  const hydrated = useHydrated();
  const t = hydrated ? teacherPlan() : null;
  const good = t?.good;
  const fix = hydrated ? teacherFix(p) : null;
  const n = (x: number) => (hydrated && x > 0 ? <em>{x}</em> : null);
  // 分かった？ of the last 7 days: how much of the news was understood the first time, without the text.
  const week = addDays(dayKey(), -6);
  const got = hydrated ? Object.values(p.news ?? {}).filter((m) => m.heard && m.heard >= week && m.got !== undefined) : [];
  const most = got.filter((m) => m.got === 2).length;

  return (
    <main className="page">
      <div className="sensei-who">
        <SenseiFace size={76} nod={!!good} />
        <div>
          <b>森先生</b>
          <small>いつも聞いていますよ</small>
        </div>
      </div>

      {good || fix ? (
        <div className="teacher-note">
          {fix && <FixBlock f={fix} />}
          {fix && (
            <Link href={`/quick?drill=${encodeURIComponent(fix.tag)}`} className="today-go memo-go">
              1分 直す
            </Link>
          )}
          {good && <GoodBlock g={good} />}
        </div>
      ) : (
        hydrated && <SenseiSays ja="毎晩、あなたの話したことを読んで、明日の練習を決めていますよ。" zh="每天晚上我会看你说过的话，安排第二天的练习。" />
      )}

      <div className="pl-grid me-list">
        <Link href="/review" className="pl"><b>復習</b><span>今天该复习的句子</span>{n(hydrated ? todaysCards(p).length : 0)}</Link>
        <Link href="/practice" className="pl"><b>練習</b><span>做过的题再练</span>{n(hydrated ? dueSkillCount(p) : 0)}</Link>
        <Link href="/weak" className="pl"><b>苦手</b><span>我常错的地方</span>{n(hydrated ? weakList(p).length : 0)}</Link>
        <Link href="/bag" className="pl"><b>フレーズ帳</b><span>收藏的句子</span></Link>
        <Link href="/stats" className="pl"><b>メモと記録</b><span>她的信・记录</span></Link>
        {got.length > 0 && (
          <Link href="/listen" className="pl">
            <b>ニュース</b>
            <span>这周第一遍听懂大部分 {most}/{got.length} 篇</span>
          </Link>
        )}
      </div>
    </main>
  );
}
