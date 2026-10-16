"use client";

import Link from "next/link";
import { dayKey, diaryToday, dueCards, nextStep, streak, useProgress, weakList, type Step } from "@/lib/client/progress";
import { totals } from "@/lib/client/metrics";
import { useHydrated } from "@/lib/client/hydrated";
import Nav from "./Nav";

// Answering this many 瞬间说 prompts counts as today's drill.
const QUICK_GOAL = 5;
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
const STEP_LABEL: Record<Step, string> = { listen: "听", shadow: "跟读", talk: "对话" };

type Stage = { key: string; label: string; title: string; big: string; zh: string; href: string; done: boolean };

// Home is today's training: review what's due, drill the shakiest point, then quick-fire speaking.
// One thing at a time fills the top; everything else is a quiet row below.
export default function Today() {
  const p = useProgress();
  const hydrated = useHydrated();
  const today = dayKey();
  const t = totals(p, today, today);
  const due = dueCards(p).length;
  const top = weakList(p)[0];
  const next = nextStep(p);
  const days = streak(p);

  const stages: Stage[] = [
    {
      key: "review",
      label: "复习",
      title: "復習",
      big: `${due} 文`,
      zh: "把记过的话，再说一遍",
      href: "/review",
      done: due === 0,
    },
    {
      key: "weak",
      label: "弱点强化",
      title: "弱点",
      big: top?.tag ?? "",
      zh: top ? `这个点错了 ${top.miss} 次，专门练一组` : "",
      href: top ? `/quick?drill=${encodeURIComponent(top.tag)}` : "/quick",
      // Practising the shakiest point today counts, even if it isn't fixed yet.
      done: !top || top.last === today,
    },
    {
      key: "quick",
      label: "瞬间说",
      title: "瞬間",
      big: `${Math.max(0, QUICK_GOAL - t.quickSpoke)} 問`,
      zh: "看中文，3 秒内开口",
      href: "/quick",
      done: t.quickSpoke >= QUICK_GOAL,
    },
  ];
  const now = stages.find((s) => !s.done);
  const doneCount = stages.filter((s) => s.done).length;
  const rest = stages.filter((s) => !s.done && s !== now).map((s) => s.label);

  // The phone's clock, not the server's: before 9:00 in Japan the server is still on yesterday.
  const d = new Date();
  const date = hydrated ? `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_JA[d.getDay()]}曜日` : "";

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-meta">
          <span>{date}</span>
          {hydrated && days > 0 && <span>连续 {days} 天</span>}
        </div>
        {now ? (
          <>
            <h1 className="hero-title">
              {now.title}
              <br />
              <span className={now.big.length > 6 ? "long" : ""}>{now.big}</span>
            </h1>
            <p className="hero-zh">{now.zh}</p>
          </>
        ) : (
          <>
            <h1 className="hero-title">
              お疲れ
              <br />
              さま
            </h1>
            <p className="hero-zh">今天的练习做完了。想多说几句，可以再来一组瞬间说。</p>
          </>
        )}
        <div className="hero-bar" aria-label={`今日练习 ${doneCount}/3`}>
          {stages.map((s) => (
            <i key={s.key} className={s.done ? "on" : ""} />
          ))}
        </div>
        <p className="hero-sub">
          今日练习 {doneCount}/3
          {now && rest.length > 0 && ` · 之后是${rest.join("、")}`}
          {t.said > 0 && ` · 今天说了 ${t.said} 句`}
        </p>
        <Link href={now?.href ?? "/quick"} className="hero-go">
          {now ? (doneCount ? `继续：${now.label}` : "开始") : "再来一组"}
        </Link>
      </section>

      <section className="home-more">
        <div className="label">随时练</div>
        <Link href={next ? `/s/${next.scenario.id}?step=${next.step}` : "/scenes"} className="row-link">
          <span className="glyph">場</span>
          <span className="row-text">
            场景对话
            <small>{next ? `${next.scenario.titleZh} · ${STEP_LABEL[next.step]}` : "所有场景都练过了，去做一个自己的"}</small>
          </span>
          <span className="chev" aria-hidden>›</span>
        </Link>
        <Link href="/call" className="row-link">
          <span className="glyph">電</span>
          <span className="row-text">
            打电话
            <small>只有声音的电话练习：预约、订餐、接客户电话</small>
          </span>
          <span className="chev" aria-hidden>›</span>
        </Link>
        <Link href="/moyu" className="row-link">
          <span className="glyph">聴</span>
          <span className="row-text">
            摸鱼模式
            <small>戴上耳机一直听，不用开口，通勤也能用</small>
          </span>
          <span className="chev" aria-hidden>›</span>
        </Link>
        <Link href="/diary" className="row-link">
          <span className="glyph">話</span>
          <span className="row-text">
            口语日记
            <small>{diaryToday(p) ? "今天说过了，可以再来一段" : "用一分钟说说今天"}</small>
          </span>
          <span className="chev" aria-hidden>›</span>
        </Link>
      </section>
      <Nav on="today" />
    </main>
  );
}
