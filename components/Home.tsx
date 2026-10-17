"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { unlock } from "@/lib/client/player";
import { useProgress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { finished, minutes, oneFix, plan, quietPref, setQuiet, startRoute, useRoute } from "@/lib/client/route";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

// 今日: the only thing on the first screen is today's route and one button. Everything to pick
// by hand (past episodes, scenes, calls, diary…) lives behind 我.
export default function Home() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const r = useRoute();
  const [quiet, setQ] = useState(false);
  useEffect(() => setQ(r?.quiet ?? quietPref()), [r]);

  const d = new Date();
  const date = hydrated ? `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY_JA[d.getDay()]}）` : "";
  const top = (
    <div className="top">
      <span>{date}</span>
      <Link href="/me" className="top-me" aria-label="我的记录">
        我
      </Link>
    </div>
  );
  if (!hydrated) return <main className="page">{top}</main>;

  if (finished(r)) {
    const fix = oneFix(p);
    return (
      <main className="page">
        {top}
        <div className="done-stamp">済</div>
        <div className="today">
          {fix && (
            <>
              <span className="kicker">明日はこれだけ</span>
              <div className="one-fix">
                <div className="ja">
                  <del>{fix.said}</del> → <ins>{fix.better}</ins>
                </div>
                <small>{fix.why}</small>
              </div>
            </>
          )}
          <Link href="/today" className="today-go">
            ♪ 今日の歌
          </Link>
        </div>
        <p className="see-you">また明日</p>
      </main>
    );
  }

  const stops = r && r.at > 0 ? r.stops : plan(p, quiet);
  const at = r && r.at > 0 ? r.at : 0;

  return (
    <main className="page">
      {top}
      <h1 className="display">今日</h1>
      <button
        className="today today-btn"
        onClick={() => {
          unlock();
          router.push(startRoute(p, quiet));
        }}
      >
        <span className="kicker">約 {minutes(stops.slice(at))} 分{quiet ? " · 聴くだけ" : ""}</span>
        <span className="route">
          {stops.map((s, i) => (
            <span key={i} className={`stop ${i < at ? "done" : i === at ? "now" : ""}`}>
              <i />
              <b>{s.ja}</b>
              <small>{s.meta}</small>
            </span>
          ))}
        </span>
        <span className="today-go">{at > 0 ? "続ける" : quiet ? "流す" : "始める"}</span>
      </button>
      <label className="quiet">
        <input
          type="checkbox"
          checked={quiet}
          onChange={(e) => {
            setQ(e.target.checked);
            setQuiet(p, e.target.checked);
          }}
        />
        <span className="sw" aria-hidden />
        今は声を出せない
      </label>
    </main>
  );
}
