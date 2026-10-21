"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { newsPace, newsVoice, type NewsArticle, type Seg } from "@/lib/news-model";
import { useHydrated } from "@/lib/client/hydrated";
import { LOOPS, RATES, useJoined } from "@/lib/client/joined";
import { articleClips, listenSet, newsDay, newsToTell, useNews } from "@/lib/client/news";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { dayKey, markNews, useProgress } from "@/lib/client/progress";
import { stepDone, useOnRoute } from "@/lib/client/route";
import { Star } from "./FeedbackCard";
import Note from "./Note";

// NHKやさしいことばニュース in our own voice: one article to read along (/news/[id]), or the ones not heard
// yet back to back for the train (/news), each article first without the text, then with it.

// NHK's text with its readings. fill: how many characters of it have been said (they turn vermilion,
// nothing else about them changes).
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
            <span key={i} className={`rb${done ? " rb-on" : ""}`} data-r={s.r}>
              {s.t}
            </span>
          );
        if (done || fill <= from) return <span key={i} className={done ? "rb-on" : undefined}>{s.t}</span>;
        const cut = Math.round(fill - from);
        return (
          <span key={i}>
            <span className="rb-on">{s.t.slice(0, cut)}</span>
            {s.t.slice(cut)}
          </span>
        );
      })}
    </>
  );
}

const md = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`;
// NHK's picture for the story (lib/news.ts keeps it with the article).
export function NewsImage({ a, className }: { a: NewsArticle; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!a.image || failed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={`/api/news/img/${a.id}`} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

// The article's sentences grouped by NHK's paragraphs (indexes), one card each.
const paras = (a: NewsArticle) =>
  a.sentences.reduce<number[][]>((out, s, i) => (s.p || !out.length ? out.push([i]) : out[out.length - 1].push(i), out), []);
const lenOf = (segs: Seg[]) => segs.reduce((n, s) => n + s.t.length, 0);

const LOOP_LABEL = { off: "しない", one: "1文", all: "この記事" } as const;

// 速さ (and, on the article page, ループ) in a sheet from the bottom, like MOJi's.
function PlaySheet({ j, loop, onClose }: { j: ReturnType<typeof useJoined>; loop: boolean; onClose: () => void }) {
  // Out of the dock: its backdrop-filter would hold a fixed sheet inside it.
  return createPortal(
    <div className="nw-sheet-bg" onClick={onClose}>
      <div className="nw-sheet" onClick={(e) => e.stopPropagation()}>
        {loop && (
          <>
            <div className="nw-sheet-h">ループ</div>
            <div className="nw-sheet-row">
              {LOOPS.map((l) => (
                <button key={l} className={`nw-opt${j.loop === l ? " on" : ""}`} onClick={() => j.setLoop(l)}>
                  {LOOP_LABEL[l]}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="nw-sheet-h">速さ</div>
        <div className="nw-sheet-row five">
          {RATES.map((r) => (
            <button key={r} className={`nw-opt${j.rate === r ? " on" : ""}`} onClick={() => j.setRate(r)}>
              {r.toFixed(1)}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Controls({ j, extra, loop = false }: { j: ReturnType<typeof useJoined>; extra?: React.ReactNode; loop?: boolean }) {
  const playing = j.phase === "playing";
  const [sheet, setSheet] = useState(false);
  return (
    <div className="nw-ctl">
      <button className={`nw-chip${loop && j.loop !== "off" ? " loop" : ""}`} onClick={() => setSheet(true)}>
        {loop && j.loop !== "off" && <span className="nw-loop">↻ {LOOP_LABEL[j.loop]}</span>}
        {j.rate.toFixed(1)}×
      </button>
      {sheet && <PlaySheet j={j} loop={loop} onClose={() => setSheet(false)} />}
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

// An article counts as heard once half of it has been played (getting off the train mid-way still counts).
function useHeardAtHalf(a: NewsArticle | undefined, sentence: number) {
  const marked = useRef("");
  useEffect(() => {
    if (!a || marked.current === a.id || sentence < Math.ceil(a.sentences.length / 2)) return;
    marked.current = a.id;
    markNews(a.id, { heard: dayKey() });
  }, [a, sentence]);
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
        <Link href="/" className="back">‹ 听</Link>
        <p className="muted">{items.length ? "这条新闻已经不在了（只保留 14 天）" : "正在读取…"}</p>
      </main>
    );
  return <Article a={a} />;
}

function Article({ a }: { a: NewsArticle }) {
  const p = useProgress();
  const [zh, setZh] = useState(false);
  const [hide, setHide] = useState(false);
  const rounds = useMemo(() => [articleClips(a, "read")], [a]);
  const j = useJoined(rounds, { album: "NHKやさしいことばニュース", loopable: true, onDone: () => markNews(a.id, { heard: dayKey() }) });
  // Clip 0 is the title; sentence i is clip i + 1.
  const at = j.phase === "idle" ? -2 : j.idx - 1;
  useHeardAtHalf(a, at + 1);

  // The sentence being said stays in the top third of the screen, unless the learner scrolled a moment ago.
  const lines = useRef<(HTMLDivElement | null)[]>([]);
  const touched = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mark = () => (touched.current = Date.now());
    window.addEventListener("touchmove", mark, { passive: true });
    window.addEventListener("wheel", mark, { passive: true });
    return () => {
      window.removeEventListener("touchmove", mark);
      window.removeEventListener("wheel", mark);
    };
  }, []);
  useEffect(() => {
    if (j.phase !== "playing" || Date.now() - touched.current < 3000) return;
    const el = at >= 0 ? lines.current[at] : null;
    if (el) window.scrollTo({ top: Math.max(0, window.scrollY + el.getBoundingClientRect().top - window.innerHeight * 0.3), behavior: "smooth" });
  }, [at, j.phase]);
  useEffect(() => {
    if (j.phase === "done") end.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [j.phase]);

  return (
    <main className="page nw-page">
      <div className="nw-top">
        <Link href="/" className="back">‹ 听</Link>
        <button className={`nw-chip${zh ? " on" : ""}`} onClick={() => setZh(!zh)}>訳</button>
      </div>
      <NewsImage a={a} className="nw-img" />
      <h1 className={`nw-title${at === -1 ? " now" : ""}`} data-ask-topic={a.title_ja}>
        <Ruby segs={a.title} fill={at === -1 ? j.frac * lenOf(a.title) : 0} />
      </h1>
      {zh && <div className="nw-zh">{a.title_zh}</div>}
      <div className="nw-date">{md(a.day)} · NHKやさしいことばニュース</div>
      <div className={`nw-body${hide ? " hidden" : ""}`}>
        {paras(a).map((para) => (
          <div key={para[0]} className="nw-para">
            {para.map((i) => {
              const s = a.sentences[i];
              return (
                <div key={i} ref={(el) => void (lines.current[i] = el)} className={`nw-s${i === at ? " now" : ""}`}>
                  <p data-line={s.ja} onClick={() => (j.phase === "idle" || j.phase === "done" ? j.start().then(() => j.seek(i + 1)) : j.seek(i + 1))}>
                    <Ruby segs={s.segs} fill={i === at ? j.frac * lenOf(s.segs) : 0} />
                  </p>
                  {zh && s.zh && <div className="nw-zh">{s.zh}</div>}
                </div>
              );
            })}
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
                <button
                  className="nw-word-say"
                  onClick={() => {
                    unlock();
                    play(ttsUrl(w.ja, newsVoice(a))).catch(() => {});
                  }}
                  aria-label="読み方を聞く"
                >
                  <ruby>
                    {w.ja}
                    <rt>{w.kana !== w.ja ? w.kana : ""}</rt>
                  </ruby>
                  <i>🔈</i>
                </button>
                <span>{w.zh}</span>
                <Star p={p} ja={w.ja} reading={w.kana} zh={w.zh} voice={newsVoice(a)} scenarioId={`news:${a.id}`} />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="nw-end" ref={end}>
        <Note text="听完了，用自己的话讲三遍。" />
        <Link href={`/retell?news=${a.id}`} className="pil-go on">讲三遍</Link>
      </div>

      <div className="nw-dock">
        <div className="nw-bar">
          <i style={{ width: `${j.idx < 0 ? 0 : Math.round(((j.idx + j.frac) / (a.sentences.length + 1)) * 100)}%` }} />
        </div>
        <Controls j={j} loop extra={<button className={`nw-chip${hide ? " on" : ""}`} onClick={() => setHide(!hide)}>{hide ? "表示" : "隠す"}</button>} />
        {j.error && <p className="error">{j.error}</p>}
      </div>
      <audio {...j.audioProps} />
    </main>
  );
}

// ---- The articles not heard yet, back to back ----

const GOT = ["あまり", "半分", "ほとんど"];
const paceLabel = (pace: number) => (pace < 1 ? " · ゆっくり" : pace > 1.2 ? " · 速め" : pace > 1 ? " · 少し速め" : "");
// How long 分かった？ waits between the two passes before the second starts on its own.
const ASK_MS = 5000;

export function NewsPlay() {
  const p = useProgress();
  const items = useNews();
  const hydrated = useHydrated();
  // Fixed once there are articles, so marking one heard doesn't take it out from under the player.
  const [set, setSet] = useState<ReturnType<typeof listenSet> | null>(null);
  useEffect(() => {
    if (hydrated && !set?.items.length && items.length) setSet(listenSet(p, items));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, items]);
  if (!hydrated) return <main className="page" />;
  if (!set?.items.length)
    return (
      <main className="page">
        <Link href="/" className="back">‹ 听</Link>
        <p className="muted">还没有新闻（每天晚上 21:00 自动更新）</p>
      </main>
    );
  return <Play set={set} />;
}

function Play({ set }: { set: ReturnType<typeof listenSet> }) {
  const today = set.items;
  const p = useProgress();
  const onRoute = useOnRoute();
  // Two rounds per article: 2i without the text, 2i + 1 with it.
  const rounds = useMemo(() => today.flatMap((a) => [articleClips(a, "ear"), articleClips(a, "text")]), [today]);
  const [asking, setAsking] = useState<{ id: string; done: () => void } | null>(null);
  const skipAsk = useRef(false);
  const [showZh, setShowZh] = useState(false);
  const j = useJoined(rounds, {
    album: newsDay(set.day),
    // The pass without the text goes at the article's own pace (slower or faster), the pass with it at 1.
    paceOf: (r) => (r % 2 === 0 && today[Math.floor(r / 2)] ? newsPace(today[Math.floor(r / 2)]) : 1),
    onRoundEnd: (r) => {
      const a = today[Math.floor(r / 2)];
      if (r % 2 === 1) return;
      markNews(a.id, { heard: dayKey() });
      // 分かった？ right after the pass without the text, before the text is seen. Not with the screen off
      // (the train, phone in a pocket): the next pass just carries on.
      const skip = skipAsk.current;
      skipAsk.current = false;
      if (skip || document.visibilityState !== "visible") return;
      return new Promise<void>((done) => {
        const t = setTimeout(() => finish(), ASK_MS);
        const finish = () => {
          clearTimeout(t);
          setAsking(null);
          done();
        };
        setAsking({ id: a.id, done: finish });
      });
    },
    onDone: () => stepDone(),
  });
  useEffect(() => setShowZh(false), [j.idx]);
  const n = Math.floor(j.round / 2);
  const a = today[n];
  const second = j.round % 2 === 1;
  const sentence = j.idx < 0 ? -2 : j.idx - 1;
  useHeardAtHalf(j.phase === "idle" || second ? undefined : a, sentence + 1);
  // Carry on from the first article not heard yet today.
  const from = Math.max(0, today.findIndex((x) => p.news?.[x.id]?.heard !== dayKey()));
  const tell = newsToTell(p, today);

  if (j.phase === "done")
    return (
      <main className="page">
        <h1 className="tab-h1">{newsDay(set.day)}<small>{today.length}本 済</small></h1>
        <div className="pl-grid">
          {today.map((x) => (
            <Link key={x.id} href={`/news/${x.id}`} className="pl ep-line">
              <span className="ep-ok">✓</span>
              <b>{x.title_ja}</b>
            </Link>
          ))}
        </div>
        {!onRoute && tell && (
          <Link href={`/retell?news=${tell.id}`} className="pil-go on" style={{ marginTop: 18 }}>
            讲三遍
          </Link>
        )}
        <audio {...j.audioProps} />
      </main>
    );

  const idle = j.phase === "idle";
  const s = !idle && sentence >= 0 ? a.sentences[sentence] : null;
  return (
    <main className="page nw-page">
      <div className="nw-top">
        <Link href="/" className="back">‹ 听</Link>
        <span className="muted">{newsDay(set.day)} {idle ? today.length : `${n + 1} / ${today.length}`}</span>
      </div>
      <div className="kicker">{idle ? "2回ずつ · 1回目は文字なし" : asking ? "1回目 おわり" : second ? "2回目 · 文字あり" : `1回目 · 文字なし${paceLabel(newsPace(a))}`}</div>
      <h1 className="nw-title">{idle ? "新闻" : <Ruby segs={a.title} />}</h1>
      <div className="nw-dots">
        {today.map((x, i) => (
          <span key={x.id} className={i < n || (i === n && !idle) || (idle && p.news?.[x.id]?.heard === dayKey()) ? "on" : ""} />
        ))}
      </div>
      <div className="nw-stage">
        {idle ? (
          <div className="nw-list">
            {today.map((x) => (
              <div key={x.id}>{x.title_ja}</div>
            ))}
          </div>
        ) : asking ? (
          <div className="nw-got">
            <div>分かった？</div>
            <div className="nw-got-row">
              {GOT.map((g, i) => (
                <button
                  key={g}
                  className="nw-chip big"
                  onClick={() => {
                    markNews(asking.id, { got: i });
                    asking.done();
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
            <div className="nw-wait" style={{ animationDuration: `${ASK_MS}ms` }} />
            <small className="muted">このあと文字ありでもう一度</small>
          </div>
        ) : second && s ? (
          <div onClick={() => setShowZh(!showZh)}>
            <p className="nw-now" data-line={s.ja}>
              <Ruby segs={s.segs} fill={j.frac * lenOf(s.segs)} />
            </p>
            {showZh ? <div className="nw-zh">{s.zh}</div> : <small className="muted nw-tap">点一下看中文</small>}
          </div>
        ) : second ? (
          <div className="nw-hidden">{a.title_ja}</div>
        ) : (
          <>
            <NewsImage a={a} className="nw-img" />
            <div className="nw-hidden">耳だけで聞いてみよう</div>
            <div className="nw-sdots" aria-label={`${Math.max(0, sentence + 1)} / ${a.sentences.length}`}>
              {a.sentences.map((_, i) => (
                <span key={i} className={i < sentence ? "on" : i === sentence ? "now" : ""} />
              ))}
            </div>
          </>
        )}
      </div>
      <div className="nw-dock">
        {idle ? (
          <button className="pil-go on" onClick={() => j.start(from * 2)}>
            {from > 0 ? `▶ 続きから（${from + 1}本目）` : "▶ 全部听"}
          </button>
        ) : (
          <Controls
            j={j}
            extra={
              <button
                className="nw-chip"
                onClick={() => {
                  // 1回目: on to the pass with the text (no question: it wasn't listened to); 2回目: the next article.
                  if (!second) skipAsk.current = true;
                  j.seek(999);
                }}
                disabled={j.idx < 0 || !!asking}
              >
                {second ? "次の記事 ›" : "文字あり ›"}
              </button>
            }
          />
        )}
        {j.error && <p className="error">{j.error}</p>}
      </div>
      <audio {...j.audioProps} />
    </main>
  );
}
