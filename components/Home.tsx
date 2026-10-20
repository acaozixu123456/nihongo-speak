"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { unlock } from "@/lib/client/player";
import { teacherFix, useProgress } from "@/lib/client/progress";
import { FixBlock, Marked } from "./TeacherMemo";
import { SenseiLine, speak } from "./Sensei";
import { useHydrated } from "@/lib/client/hydrated";
import { morning, newsToday, preloadNews, useNews } from "@/lib/client/news";
import { PILLARS, finished, oneFix, pillarOf, plan, quietPref, setQuiet, startRoute, todaysEpisode, useRoute, type Pillar, type Stop } from "@/lib/client/route";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
const PILLAR_JA: Record<Pillar, string> = { listen: "聴く", speak: "話す", teacher: "先生" };

// What the vermilion button says for the stop it opens.
export const GO: Record<Stop["key"], string> = {
  listen: "▶ 聴く",
  song: "♪ 一休み",
  flow: "流す",
  retell: "話す",
  quick: "瞬間",
  call: "電話する",
  fix: "1分 直す",
  game: "練習する",
  skills: "練習する",
  review: "復習する",
};

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? ["おはよう。", "早上好。"] : h < 18 ? ["こんにちは。", "你好。"] : ["こんばんは。", "晚上好。"];
}

// What 森先生 says about the stop that comes next.
const LEAD: Record<Pillar, [string, string]> = {
  listen: ["まずはラジオから聴きましょうね。", "先从电台听起吧。"],
  speak: ["次は、声に出してみましょう。", "接下来，开口说说看。"],
  teacher: ["ひとつだけ、一緒に直しましょうね。", "只有一处，我们一起改。"],
};

// 今日: only what today needs. 森先生's one line, the one thing to do now with the vermilion button,
// and how far the day has come. Everything else lives in the 聴く, 話す and 先生 tabs.
export default function Home() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const r = useRoute();
  const [quiet, setQ] = useState(false);
  useEffect(() => setQ(r?.quiet ?? quietPref()), [r]);
  // This morning's news, fetched and its voice kept on the phone before the train.
  const items = useNews();
  useEffect(() => {
    const today = morning(items);
    if (today.length) preloadNews(today);
  }, [items]);

  const d = new Date();
  const date = hydrated ? `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY_JA[d.getDay()]}）` : "";
  const top = (
    <div className="top">
      <span>{date}</span>
      {hydrated && (
        <label className="quiet top-quiet">
          <input
            type="checkbox"
            checked={quiet}
            onChange={(e) => {
              setQ(e.target.checked);
              setQuiet(p, e.target.checked);
            }}
          />
          <span className="sw" aria-hidden />
          声を出せない
        </label>
      )}
    </div>
  );
  if (!hydrated) return <main className="page">{top}</main>;

  const over = finished(r);
  const stops = r && r.at > 0 ? r.stops : plan(p, quiet);
  const at = over ? stops.length : r && r.at > 0 ? r.at : 0;
  const s = over ? null : stops[at];
  const now: Pillar | null = s ? pillarOf(s.key) : null;
  const go = () => {
    unlock();
    router.push(startRoute(p, quiet));
  };

  const dots = (
    <div className="day-dots">
      {PILLARS.map((x, i) => {
        const mine = stops.map((t, j) => ({ t, j })).filter(({ t }) => pillarOf(t.key) === x);
        const done = over || (mine.length > 0 && mine.every(({ j }) => j < at));
        const cls = x === now ? "n" : done ? "d" : "";
        return (
          <span key={x} className={cls}>
            {i > 0 && <b>›</b>}
            <i className={cls} />
            {PILLAR_JA[x]}
          </span>
        );
      })}
    </div>
  );

  if (!s) {
    const tomorrow = oneFix(p);
    return (
      <main className="page">
        {top}
        <SenseiLine ja="今日はここまで。よくがんばりましたね。" zh="今天就到这里，辛苦了。" nod mute />
        <div className="now-card">
          <div className="kicker">済</div>
          {tomorrow && (
            <div className="one-fix">
              <span className="kicker">明日はこれだけ</span>
              <div className="ja">
                <del>{tomorrow.said}</del> → <ins>{tomorrow.better}</ins>
              </div>
              <small>{tomorrow.why}</small>
            </div>
          )}
          <Link href="/today" className="pil-go">
            ♪ 今日の歌
          </Link>
        </div>
        {dots}
      </main>
    );
  }

  const [hi, hiZh] = greeting();
  const [lead, leadZh] = s.href === "/news" ? (["まずは今朝のニュースを聴きましょう。", "先听今早的新闻吧。"] as const) : LEAD[now!];
  const say = at === 0 ? [hi + lead, hiZh + leadZh] : [lead, leadZh];
  const tf = teacherFix(p);
  const fix = s.key === "fix" ? tf : null;
  const ep = todaysEpisode(p);
  const news = newsToday(p);
  let title = s.ja;
  let sub = s.meta;
  if (s.key === "listen" && s.href === "/news") {
    title = "今朝のニュース";
    sub = `${s.meta.replace("今朝のニュース ", "")} · 声を出さなくていい`;
  } else if (s.key === "listen") {
    title = s.meta === "新しい回" || !ep ? "今日の回を作ります" : (ep.title_ja ?? ep.title_zh);
    sub = "ゆるっと日本ラジオ";
  } else if (s.key === "retell" && news) {
    title = news.title_ja;
    sub = "今朝のニュースを、自分の言葉で三回";
  } else if (s.key === "retell") {
    title = "さっきの話を三回話す";
    sub = "听完的那期，用自己的话讲三遍";
  }

  return (
    <main className="page">
      {top}
      <SenseiLine ja={say[0]} zh={say[1]} mute />
      <section className="now-card next">
        <div className="kicker">いま・{PILLAR_JA[now!]}</div>
        {fix ? (
          <FixBlock f={fix} />
        ) : (
          <div className="pil-what">
            <div className="pil-t">{title}</div>
            {sub && <div className="pil-m">{sub}</div>}
          </div>
        )}
        <button className="pil-go on" onClick={go}>
          {GO[s.key]}
        </button>
      </section>
      {dots}
      {tf && !fix && (
        <button className="use-today" onClick={() => speak(tf.better)}>
          <span className="kicker">今日使ってみよう</span>
          <span className="use-ja">
            <span>
              <Marked text={tf.better} mark={tf.mark} as="em" />
            </span>
            <i aria-hidden>▶</i>
          </span>
          {tf.zh && <small>{tf.zh}</small>}
        </button>
      )}
    </main>
  );
}
