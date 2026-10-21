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

// 話す: one card, today's 三回話す (the story, the one thing to mind, one button); everything else (stories to
// tell again, calls, scenes, 瞬間, 予行演習) folded under 更多.
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

  return (
    <main className="page">
      <h1 className="tab-h1">说</h1>
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
          <Link href="/rehearse" className="pl">
            <b>预演</b>
            {report ? <em className="new">1</em> : null}
          </Link>
        </div>
      )}
    </main>
  );
}
