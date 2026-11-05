"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { unlock } from "@/lib/client/player";
import { rehearsalToReport, useProgress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { current, heardToday, plan, quietPref, startRoute, useRoute } from "@/lib/client/route";
import { retellBlocker, retellList } from "@/lib/client/retell-history";
import { RetellRow } from "./RetellRows";
import { nextOnPath, readSeeds } from "@/lib/client/drill";
import { dueHito, readHito } from "@/lib/client/hitokoto";

// 話す: 型ドリル first (what the learner uses most: the next 型 on its list, one tap to start), then 私の一言
// (sentences from their own day, with the ones due today), then today's 三回話す; everything else (stories
// to tell again, calls, scenes, 瞬間, 予行演習) folded under 更多.
export default function SpeakTab() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const r = useRoute();
  const quiet = hydrated ? (r?.quiet ?? quietPref()) : false;
  const stops = hydrated ? (r ? r.stops : plan(p, quiet)) : [];
  const first = stops.find((s) => s.key === "retell");
  const onRoute = !!first && current(r) === first;
  const todayEp = hydrated ? heardToday(p) : null;
  const list = hydrated ? retellList(p, todayEp) : null;
  const fix = hydrated ? retellBlocker(p) : null;
  const report = hydrated && !!rehearsalToReport(p);
  const go = () => {
    unlock();
    router.push(startRoute(p, quiet));
  };

  const [more, setMore] = useState(false);
  const t = list?.today;
  const kata = hydrated ? nextOnPath(readSeeds()) : null;
  const mine = hydrated ? readHito() : [];
  const due = hydrated ? dueHito(mine).length : 0;

  return (
    <main className="page">
      <h1 className="tab-h1">说</h1>
      {hydrated && (
        <section className="lt-hero sp-hero sp-kata">
          <div className="lt-body">
            <div className="lt-tag">型ドリル</div>
            {kata ? (
              <>
                <div className="lt-title">{kata.seed}</div>
                <div className="lt-zh">{kata.zh}</div>
                <Link href={`/drill?s=${encodeURIComponent(kata.seed)}`} className="lt-go" onClick={unlock}>
                  ▶ 始める
                </Link>
              </>
            ) : (
              <Link href="/drill" className="lt-go">▶ 始める</Link>
            )}
            <Link href="/drill" className="sp-due">一覧</Link>
          </div>
        </section>
      )}
      {hydrated && (
        <div className="pl-grid sp-mine">
          <Link href={due ? "/mine?go=1" : "/mine"} className="pl">
            <b>私の一言</b>
            {mine.length > 0 && <span>{mine[0].ja}</span>}
            {due > 0 ? <em className="new">{due}</em> : <em>＋</em>}
          </Link>
        </div>
      )}
      {hydrated && t && (
        <section className="lt-hero sp-hero">
          <div className="lt-body">
            <div className="lt-tag">讲三遍{t.toldToday ? " · 今天讲过了" : ""}</div>
            <div className="lt-title">{t.ja}</div>
            {(t.times > 0 || t.score !== null) && <div className="lt-zh">{[`${t.times} 次`, t.score !== null ? `${t.score} 分` : ""].filter(Boolean).join(" · ")}</div>}
            {fix && (
              <div className="sp-fix">
                <span>今天注意</span>
                <b>{fix.better}</b>
              </div>
            )}
            {onRoute ? (
              <button className="lt-go" onClick={go}>
                开始讲
              </button>
            ) : (
              <Link href={t.href} className={`lt-go${t.toldToday || quiet ? " soft" : ""}`}>
                {t.toldToday ? "再来一次" : "开始讲"}
              </Link>
            )}
          </div>
        </section>
      )}
      <button className={`lt-more${more ? " open" : ""}`} onClick={() => setMore(!more)}>
        更多{report && !more && <i className="lt-dot" />}
        <span>›</span>
      </button>
      {more && (
        <div className="pl-grid">
          {list?.picks.map((r) => <RetellRow key={r.key} r={r} />)}
          <Link href="/retell/list" className="pl">
            <b>讲过的全部</b>
            {list?.times ? <span>{list.times} 次</span> : null}
          </Link>
          <Link href="/call" className="pl">
            <b>打电话</b>
          </Link>
          <Link href="/scenes" className="pl">
            <b>场景对话</b>
          </Link>
          <Link href="/quick" className="pl">
            <b>马上说</b>
          </Link>
          <Link href="/drill" className="pl">
            <b>型ドリル</b>
          </Link>
          <Link href="/rehearse" className="pl">
            <b>预演</b>
            {report ? <em className="new">1</em> : null}
          </Link>
        </div>
      )}
    </main>
  );
}
