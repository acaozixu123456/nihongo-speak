"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { unlock } from "@/lib/client/player";
import { ensureTitleJa, useProgress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { current, quietPref, startRoute, todaysEpisode, useRoute } from "@/lib/client/route";

const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;

// 聴く: today's episode on top, then everything else to listen to, then the episodes before.
export default function ListenTab() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const r = useRoute();
  const ep = hydrated ? todaysEpisode(p) : null;
  const before = hydrated ? p.episodes.filter((e) => e.id !== ep?.id).slice(0, 5) : [];
  useEffect(() => {
    before.forEach(ensureTitleJa);
    if (ep) ensureTitleJa(ep);
  }, [before, ep]);
  const onRoute = current(r)?.key === "listen" || (!r && !ep);
  const go = () => {
    unlock();
    router.push(startRoute(p, r?.quiet ?? quietPref()));
  };

  return (
    <main className="page">
      <h1 className="tab-h1">
        聴く<small>听</small>
      </h1>
      <section className="now-card">
        <div className="kicker">今日の回</div>
        <div className="pil-what">
          <div className="pil-t">{ep ? (ep.title_ja ?? ep.title_zh) : "今日の回を作ります"}</div>
          <div className="pil-m">ゆるっと日本ラジオ</div>
        </div>
        {hydrated &&
          (onRoute ? (
            <button className="pil-go on" onClick={go}>
              ▶ 聴く
            </button>
          ) : (
            <Link href={ep ? `/ep/${ep.id}` : "/episodes"} className="pil-go">
              ▶ 聴く
            </Link>
          ))}
      </section>
      <div className="pl-grid">
        {ep && (
          <Link href={`/ep/${ep.id}/song`} className="pl">
            <b>洗脳歌</b>
            <span>把这期唱成歌</span>
          </Link>
        )}
        <Link href="/moyu" className="pl">
          <b>流す</b>
          <span>不能出声时只听</span>
        </Link>
        <Link href="/episodes" className="pl">
          <b>ラジオ一覧</b>
          <span>全部的回・点播</span>
        </Link>
      </div>
      {before.length > 0 && (
        <>
          <div className="tab-label">前の回</div>
          <div className="pl-grid">
            {before.map((e) => (
              <Link key={e.id} href={`/ep/${e.id}`} className="pl ep-line">
                {e.heard && <span className="ep-ok">✓</span>}
                <b>{e.title_ja ?? e.title_zh}</b>
                <span className="ep-d">{md(e.date)}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
