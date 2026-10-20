"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { NewsArticle, Seg } from "@/lib/news-model";
import { useHydrated } from "@/lib/client/hydrated";
import { RATES, useJoined } from "@/lib/client/joined";
import { articleClips, morning, useNews } from "@/lib/client/news";
import { dayKey, markNews, useProgress } from "@/lib/client/progress";
import { stepDone, useOnRoute } from "@/lib/client/route";

// NHKやさしいことばニュース in our own voice: one article to read along (/news/[id]), or the whole
// morning back to back for the train (/news), each article first without the text, then with it.

// NHK's text with its readings. fill: how many characters of it have been said (they turn vermilion).
export function Ruby({ segs, fill = 0 }: { segs: Seg[]; fill?: number }) {
  let at = 0;
  return (
    <>
      {segs.map((s, i) => {
        const from = at;
        at += s.t.length;
        const done = fill >= at;
        // The reading sits above without widening the word (a real <ruby> pushes the line apart), and
        // isn't part of the text, so selecting a sentence to ask about it gets the sentence only.
        if (s.r)
          return (
            <span key={i} className={`rb${done ? " said" : ""}`} data-r={s.r}>
              {s.t}
            </span>
          );
        if (done || fill <= from) return <span key={i} className={done ? "said" : undefined}>{s.t}</span>;
        const cut = Math.round(fill - from);
        return (
          <span key={i}>
            <span className="said">{s.t.slice(0, cut)}</span>
            {s.t.slice(cut)}
          </span>
        );
      })}
    </>
  );
}

const md = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`;

function Controls({ j, extra }: { j: ReturnType<typeof useJoined>; extra?: React.ReactNode }) {
  const playing = j.phase === "playing";
  return (
    <div className="nw-ctl">
      <button className="nw-chip" onClick={() => j.setRate(RATES[(RATES.indexOf(j.rate) + 1) % RATES.length])}>
        {j.rate.toFixed(1)}×
      </button>
      {extra}
      <button className="nw-play" onClick={j.toggle} disabled={j.phase === "loading"} aria-label={playing ? "一時停止" : "再生"}>
        {j.phase === "loading" ? "…" : playing ? "❚❚" : "▶"}
      </button>
      <button className="nw-chip" onClick={j.again} disabled={j.idx < 0}>
        ↺ 1文
      </button>
    </div>
  );
}

// ---- One article ----

export function NewsArticlePage({ id }: { id: string }) {
  const items = useNews();
  const hydrated = useHydrated();
  const a = items.find((x) => x.id === id);
  if (!hydrated) return <main className="page" />;
  if (!a)
    return (
      <main className="page">
        <Link href="/listen" className="back">‹ 聴く</Link>
        <p className="muted">{items.length ? "这条新闻已经不在了（只保留 14 天）" : "正在读取…"}</p>
      </main>
    );
  return <Article a={a} />;
}

function Article({ a }: { a: NewsArticle }) {
  const [zh, setZh] = useState(false);
  const [hide, setHide] = useState(false);
  const rounds = useMemo(() => [articleClips(a)], [a]);
  const j = useJoined(rounds, { album: "NHKやさしいことばニュース", onDone: () => markNews(a.id, { heard: dayKey() }) });
  // Clip 0 is the title; sentence i is clip i + 1.
  const at = j.phase === "idle" ? -2 : j.idx - 1;
  const lenOf = (segs: Seg[]) => segs.reduce((n, s) => n + s.t.length, 0);

  return (
    <main className="page nw-page">
      <div className="nw-top">
        <Link href="/listen" className="back">‹ 聴く</Link>
        <button className={`nw-chip${zh ? " on" : ""}`} onClick={() => setZh(!zh)}>訳</button>
      </div>
      <h1 className={`nw-title${at === -1 ? " now" : ""}`} data-ask-topic={a.title_ja}>
        <Ruby segs={a.title} fill={at === -1 ? j.frac * lenOf(a.title) : 0} />
      </h1>
      {zh && <div className="nw-zh">{a.title_zh}</div>}
      <div className="nw-date">{md(a.day)} · NHKやさしいことばニュース</div>
      <div className={`nw-body${hide ? " hidden" : ""}`}>
        {a.sentences.map((s, i) => (
          <div key={i} className={`nw-s${s.p ? " para" : ""}${i === at ? " now" : ""}${i < at ? " past" : ""}`}>
            <p data-line={s.ja} onClick={() => (j.phase === "idle" || j.phase === "done" ? j.start().then(() => j.seek(i + 1)) : j.seek(i + 1))}>
              <Ruby segs={s.segs} fill={i === at ? j.frac * lenOf(s.segs) : i < at ? 999 : 0} />
            </p>
            {zh && s.zh && <div className="nw-zh">{s.zh}</div>}
          </div>
        ))}
        {hide && <div className="nw-hidden">耳だけで聞いてみよう</div>}
      </div>
      <a className="nw-src" href={a.url} target="_blank" rel="noreferrer">出典：NHK NEWS WEB EASY ›</a>

      {a.words.length > 0 && (
        <>
          <div className="tab-label" id="words">単語</div>
          <div className="rowlist">
            {a.words.map((w) => (
              <div key={w.ja} className="rowlist-row nw-word" data-line={w.ja}>
                <ruby>
                  {w.ja}
                  <rt>{w.kana !== w.ja ? w.kana : ""}</rt>
                </ruby>
                <span>{w.zh}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="nw-dock">
        <div className="nw-bar">
          <i style={{ width: `${j.idx < 0 ? 0 : Math.round(((j.idx + j.frac) / (a.sentences.length + 1)) * 100)}%` }} />
        </div>
        <Controls j={j} extra={<button className={`nw-chip${hide ? " on" : ""}`} onClick={() => setHide(!hide)}>{hide ? "文字なし" : "文字"}</button>} />
        {j.error && <p className="error">{j.error}</p>}
        <Link href={`/retell?news=${a.id}`} className="pil-go on nw-retell">三回話す</Link>
      </div>
      <audio {...j.audioProps} />
    </main>
  );
}

// ---- This morning's articles, back to back ----

const GOT = ["あまり", "半分", "ほとんど"];

export function NewsPlay() {
  const items = useNews();
  const hydrated = useHydrated();
  const today = useMemo(() => morning(items), [items]);
  if (!hydrated) return <main className="page" />;
  if (!today.length)
    return (
      <main className="page">
        <Link href="/listen" className="back">‹ 聴く</Link>
        <p className="muted">还没有新闻（每天早上 8:30 自动更新）</p>
      </main>
    );
  return <Play today={today} />;
}

function Play({ today }: { today: NewsArticle[] }) {
  const p = useProgress();
  const onRoute = useOnRoute();
  // Each article is one round: first without the text, then again with it.
  const rounds = useMemo(() => today.map((a) => [...articleClips(a, 1), ...articleClips(a, 2)]), [today]);
  const j = useJoined(rounds, {
    album: "今朝のニュース",
    onRoundEnd: (r) => markNews(today[r].id, { heard: dayKey() }),
    onDone: () => stepDone(),
  });
  const a = today[j.round];
  const half = a.sentences.length + 1;
  const second = j.idx >= half;
  const sentence = j.idx < 0 ? -2 : (j.idx % half) - 1;
  const got = p.news?.[a.id]?.got;

  if (j.phase === "done")
    return (
      <main className="page">
        <h1 className="tab-h1">今朝のニュース<small>{today.length}本 済</small></h1>
        <div className="pl-grid">
          {today.map((x) => (
            <Link key={x.id} href={`/news/${x.id}`} className="pl ep-line">
              <span className="ep-ok">✓</span>
              <b>{x.title_ja}</b>
            </Link>
          ))}
        </div>
        {!onRoute && (
          <Link href={`/retell?news=${today[0].id}`} className="pil-go on" style={{ marginTop: 18 }}>
            三回話す
          </Link>
        )}
        <audio {...j.audioProps} />
      </main>
    );

  return (
    <main className="page nw-page">
      <div className="nw-top">
        <Link href="/listen" className="back">‹ 聴く</Link>
        <span className="muted">今朝のニュース {j.round + 1} / {today.length}</span>
      </div>
      <div className="kicker">{j.phase === "idle" ? `${today.length}本` : second ? "2回目 · 文字あり" : "1回目 · 文字なし"}</div>
      <h1 className="nw-title">{j.phase === "idle" ? "今朝のニュース" : a.title_ja}</h1>
      <div className="nw-dots">
        {today.map((x, i) => (
          <span key={x.id} className={i < j.round || (i === j.round && j.phase !== "idle") ? "on" : ""} />
        ))}
      </div>
      <div className="nw-stage">
        {j.phase === "idle" ? (
          <div className="nw-list">
            {today.map((x) => (
              <div key={x.id}>{x.title_ja}</div>
            ))}
          </div>
        ) : second && sentence >= 0 ? (
          <p className="nw-now" data-line={a.sentences[sentence].ja}>
            <Ruby segs={a.sentences[sentence].segs} fill={j.frac * a.sentences[sentence].segs.reduce((n, s) => n + s.t.length, 0)} />
          </p>
        ) : (
          <div className="nw-hidden">{second ? a.title_ja : "耳だけで聞いてみよう"}</div>
        )}
      </div>
      {j.phase !== "idle" && second && (
        <div className="nw-got">
          <div>分かった？</div>
          <div className="nw-got-row">
            {GOT.map((g, i) => (
              <button key={g} className={`nw-chip big${got === i ? " on" : ""}`} onClick={() => markNews(a.id, { got: i })}>
                {g}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="nw-dock">
        {j.phase === "idle" ? (
          <button className="pil-go on" onClick={() => j.start()}>▶ 全部聞く</button>
        ) : (
          <Controls j={j} extra={<button className="nw-chip" onClick={() => j.seek(999)} disabled={j.idx < 0}>次 ›</button>} />
        )}
        {j.error && <p className="error">{j.error}</p>}
      </div>
      <audio {...j.audioProps} />
    </main>
  );
}
