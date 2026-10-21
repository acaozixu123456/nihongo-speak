"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ensureTitleJa, useProgress } from "@/lib/client/progress";
import { listenSet, newsDay, newsToTell, preloadNews, useNews } from "@/lib/client/news";
import { newsRadio } from "@/lib/client/moyu";
import { useHydrated } from "@/lib/client/hydrated";
import type { NewsArticle } from "@/lib/news-model";
import { todaysEpisode } from "@/lib/client/route";

const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;

// 聴く: one article big (picture, title, one button), every other article in a row to swipe through below it,
// and the rest (radio, song, listening to all of them back to back) folded under 更多.
export default function ListenTab() {
  const p = useProgress();
  const hydrated = useHydrated();
  const items = useNews();
  // The set is fixed once shown, so marking one heard doesn't move it off the list.
  const set = useMemo(() => (hydrated ? listenSet(p, items) : { day: "", items: [], fresh: false }), [hydrated, items]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = set.items;
  const ep = hydrated ? todaysEpisode(p) : null;
  // The article to tell tonight, marked from the start: Haru and Ken talk it over on the radio too.
  const target = hydrated ? newsToTell(p, today, items) : null;
  const newsEp = target ? p.episodes.find((e) => e.news === target.id) : undefined;
  useEffect(() => {
    if (ep) ensureTitleJa(ep);
  }, [ep]);
  useEffect(() => {
    if (today.length) preloadNews(p, today);
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps
  // Its radio is made in the background, so the row plays on a tap.
  useEffect(() => {
    if (target && !newsEp && set.fresh) newsRadio(target).catch(() => {});
  }, [target, newsEp, set.fresh]);
  const mark = (id: string) => p.news?.[id];
  // One article up front (tonight's to tell, else the first not heard), the rest of the day small beside it.
  const pool = today.length ? today : items.slice(0, 4);
  const hero = (target && pool.includes(target) ? target : null) ?? pool.find((a) => !mark(a.id)?.heard) ?? pool[0];
  // Every other article kept, newest first, to swipe through below it.
  const rest = hydrated ? items.filter((a) => a !== hero) : [];
  const [more, setMore] = useState(false);

  return (
    <main className="page">
      <h1 className="tab-h1">
        听{set.day && <small>{newsDay(set.day)}</small>}
      </h1>
      {hero ? (
        <Link href={`/news/${hero.id}`} className="lt-hero">
          <Art a={hero} />
          <div className="lt-body">
            {mark(hero.id)?.heard && <div className="lt-tag done">✓ 听过</div>}
            <div className="lt-title">{hero.title_ja}</div>
            <div className="lt-zh">{hero.title_zh}</div>
            <div className="lt-go">▶ 听这篇</div>
          </div>
        </Link>
      ) : (
        hydrated && <p className="muted">还没有新闻（每天晚上 21:00 自动更新）</p>
      )}
      {rest.length > 0 && (
        <div className="lt-rest">
          {rest.map((a) => (
            <Link key={a.id} href={`/news/${a.id}`} className="lt-card">
              <Art a={a} />
              <b>{a.title_ja}</b>
              <span className="lt-d">{md(a.day)}</span>
              {mark(a.id)?.heard && <i className="lt-ok">✓</i>}
            </Link>
          ))}
        </div>
      )}
      <button className={`lt-more${more ? " open" : ""}`} onClick={() => setMore(!more)}>
        更多<span>›</span>
      </button>
      {more && (
        <div className="pl-grid">
          {target ? (
            <Link href={newsEp ? `/ep/${newsEp.id}` : `/ep/new?news=${target.id}`} className="pl">
              <b>电台</b>
              <span>ハルとケンが今朝のニュースを話す</span>
            </Link>
          ) : (
            <Link href={ep ? `/ep/${ep.id}` : "/episodes"} className="pl">
              <b>电台</b>
              <span>{ep ? (ep.title_ja ?? ep.title_zh) : "ゆるっと日本ラジオ"}</span>
            </Link>
          )}
          {(newsEp ?? ep) && (
            <Link href={`/ep/${(newsEp ?? ep)!.id}/song`} className="pl">
              <b>洗脑歌</b>
            </Link>
          )}
          <Link href="/news" className="pl">
            <b>连着听</b>
            <span>每篇两遍 · 第一遍不看字</span>
          </Link>
          <Link href="/moyu" className="pl">
            <b>只听</b>
          </Link>
          <Link href="/episodes" className="pl">
            <b>全部电台</b>
          </Link>
        </div>
      )}
    </main>
  );
}

// The article's picture, or for one without, the same shape in a soft colour with its first key word.
function Art({ a }: { a: NewsArticle }) {
  const [failed, setFailed] = useState(false);
  if (a.image && !failed)
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="lt-art" src={`/api/news/img/${a.id}`} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return (
    <div className="lt-art lt-ph">
      <span>{a.keys[0]?.ja ?? a.title_ja.slice(0, 4)}</span>
    </div>
  );
}
