"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { unlock } from "@/lib/client/player";
import { dayKey, ensureTitleJa, useProgress } from "@/lib/client/progress";
import { listenSet, newsDay, newsMinutes, newsToTell, preloadNews, useNews } from "@/lib/client/news";
import { newsRadio } from "@/lib/client/moyu";
import { useHydrated } from "@/lib/client/hydrated";
import { NewsImage } from "./News";
import { current, quietPref, startRoute, todaysEpisode, useRoute } from "@/lib/client/route";

const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;

// 聴く: the NHK news not heard yet on top (all of it back to back, or one by one), then the radio and the
// rest, then the news of the days before.
export default function ListenTab() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const r = useRoute();
  const items = useNews();
  // The set is fixed once shown, so marking one heard doesn't move it off the list.
  const set = useMemo(() => (hydrated ? listenSet(p, items) : { day: "", items: [], fresh: false }), [hydrated, items]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = set.items;
  const older = hydrated ? items.filter((a) => !today.includes(a)).slice(0, 8) : [];
  const ep = hydrated ? todaysEpisode(p) : null;
  // The article to tell tonight, marked from the start: Haru and Ken talk it over on the radio too.
  const target = hydrated ? newsToTell(p, today, items) : null;
  const newsEp = target ? p.episodes.find((e) => e.news === target.id) : undefined;
  useEffect(() => {
    if (ep) ensureTitleJa(ep);
  }, [ep]);
  useEffect(() => {
    if (today.length) preloadNews(today);
  }, [today]);
  // Its radio is made in the background, so the row plays on a tap.
  useEffect(() => {
    if (target && !newsEp && set.fresh) newsRadio(target).catch(() => {});
  }, [target, newsEp, set.fresh]);
  const onRoute = current(r)?.key === "listen";
  const go = () => {
    unlock();
    router.push(startRoute(p, r?.quiet ?? quietPref()));
  };
  const mark = (id: string) => p.news?.[id];

  return (
    <main className="page">
      <h1 className="tab-h1">
        聴く<small>听</small>
      </h1>
      <section className="now-card">
        <div className="kicker">{set.day ? newsDay(set.day) : "ニュース"}</div>
        <div className="pil-what">
          <div className="pil-t">{today.length ? `${set.fresh ? "新しい" : "全部聞いた · "}${today.length}本 · ${newsMinutes(today)}分` : "まだありません"}</div>
          <div className="pil-m">2回ずつ · 1回目は文字なし</div>
        </div>
        {hydrated &&
          today.length > 0 &&
          (onRoute ? (
            <button className="pil-go on" onClick={go}>
              ▶ 全部聞く
            </button>
          ) : (
            <Link href="/news" className="pil-go">
              ▶ 全部聞く
            </Link>
          ))}
      </section>
      {today.length > 0 && (
        <div className="pl-grid">
          {today.map((a) => (
            <Link key={a.id} href={`/news/${a.id}`} className="pl two nw-row">
              <NewsImage a={a} className="nw-thumb" />
              <div className="pl-text">
                <b>{a.title_ja}</b>
                <span>{a.title_zh}</span>
              </div>
              {target?.id === a.id && mark(a.id)?.told !== dayKey() ? (
                <span className="nw-row-st go">話す</span>
              ) : mark(a.id)?.heard ? (
                <span className="ep-ok">✓</span>
              ) : null}
            </Link>
          ))}
        </div>
      )}
      <div className="tab-label">ほかに</div>
      <div className="pl-grid">
        {target ? (
          <Link href={newsEp ? `/ep/${newsEp.id}` : `/ep/new?news=${target.id}`} className="pl">
            <b>ラジオ</b>
            <span>ハルとケンが今朝のニュースを話す</span>
          </Link>
        ) : (
          <Link href={ep ? `/ep/${ep.id}` : "/episodes"} className="pl">
            <b>ラジオ</b>
            <span>{ep ? (ep.title_ja ?? ep.title_zh) : "ゆるっと日本ラジオ"}</span>
          </Link>
        )}
        {(newsEp ?? ep) && (
          <Link href={`/ep/${(newsEp ?? ep)!.id}/song`} className="pl">
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
      {older.length > 0 && (
        <>
          <div className="tab-label">前の日</div>
          <div className="pl-grid">
            {older.map((a) => (
              <Link key={a.id} href={`/news/${a.id}`} className="pl ep-line">
                {mark(a.id)?.heard && <span className="ep-ok">✓</span>}
                <b>{a.title_ja}</b>
                <span className="ep-d">{md(a.day)}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
