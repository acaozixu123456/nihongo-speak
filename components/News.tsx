"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { NEWS_VOICES, VOICE_LABEL, kanaOf, newsPace, type CaptionMode, type NewsArticle, type Seg } from "@/lib/news-model";
import { useHydrated } from "@/lib/client/hydrated";
import { LOOPS, RATES, useJoined } from "@/lib/client/joined";
import { articleClips, sixRounds, talkGap, backClips, backSet, clearBack, listenSet, missOf, newsDay, newsToTell, toggleMiss, useNews, voiceOf } from "@/lib/client/news";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { dayKey, markNews, useProgress } from "@/lib/client/progress";
import { stepDone, useOnRoute } from "@/lib/client/route";
import { Star } from "./FeedbackCard";
import Note from "./Note";
import { CaptionSwitch, PicQuiz, SceneStage, WordPic } from "./NewsPics";

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

// The sentence in kana only, the part said so far in vermilion.
function Kana({ segs, fill = 0 }: { segs: Seg[]; fill?: number }) {
  const k = kanaOf(segs);
  const cut = Math.round((fill / Math.max(1, lenOf(segs))) * k.length);
  return (
    <>
      <span className="rb-on">{k.slice(0, cut)}</span>
      {k.slice(cut)}
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

const LOOP_LABEL = { off: "なし", one: "1文", all: "記事", voices: "声替え", six: "6声", talk: "6声+話" } as const;

// The article's voice: picked here, kept with the article (Progress.news[id].voice).
type VoicePick = { voice: string; set: (v: string) => void };

// One setting as an iOS-style segmented control.
function Seg<T extends string | number>({ label, value, options, show, onPick }: { label: string; value: T; options: readonly T[]; show: (o: T) => string; onPick: (o: T) => void }) {
  return (
    <div className="nw-set">
      <div className="nw-set-h">{label}</div>
      <div className="nw-seg">
        {options.map((o) => (
          <button key={String(o)} className={value === o ? "on" : ""} onClick={() => onPick(o)}>
            {show(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

type TextPick = { hide: boolean; set: (hide: boolean) => void };

// 速さ, 声, and on the article page ループ and 文字, in one sheet from the bottom.
function PlaySheet({ j, loop, voice, text, onClose }: { j: ReturnType<typeof useJoined>; loop: boolean; voice?: VoicePick; text?: TextPick; onClose: () => void }) {
  // Out of the dock: its backdrop-filter would hold a fixed sheet inside it.
  return createPortal(
    <div className="nw-sheet-bg" onClick={onClose}>
      <div className="nw-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="nw-grab" />
        <Seg label="速さ" value={j.rate} options={RATES} show={(r) => r.toFixed(1)} onPick={j.setRate} />
        {voice && <Seg label="声" value={voice.voice} options={NEWS_VOICES} show={(v) => VOICE_LABEL[NEWS_VOICES.indexOf(v)]} onPick={voice.set} />}
        {loop && <Seg label="ループ" value={j.loop} options={LOOPS} show={(l) => LOOP_LABEL[l]} onPick={j.setLoop} />}
        {text && <Seg label="文字" value={text.hide ? "hide" : "show"} options={["show", "hide"] as const} show={(t) => (t === "show" ? "表示" : "隠す")} onPick={(t) => text.set(t === "hide")} />}
      </div>
    </div>,
    document.body,
  );
}

const Icon = {
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
    </>
  ),
  prev: (
    <>
      <rect x="5" y="6" width="2.2" height="12" rx="1" fill="currentColor" />
      <path d="M19 6.9v10.2a.9.9 0 0 1-1.38.76L9.6 12.76a.9.9 0 0 1 0-1.52l8.02-5.1A.9.9 0 0 1 19 6.9z" fill="currentColor" />
    </>
  ),
  next: (
    <>
      <rect x="16.8" y="6" width="2.2" height="12" rx="1" fill="currentColor" />
      <path d="M5 6.9v10.2a.9.9 0 0 0 1.38.76l8.02-5.1a.9.9 0 0 0 0-1.52L6.38 6.14A.9.9 0 0 0 5 6.9z" fill="currentColor" />
    </>
  ),
  more: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </g>
  ),
};
const Svg = ({ d }: { d: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
    {d}
  </svg>
);

// The dock, like a podcast player's: speed, back a sentence, play, on, and everything else behind ⚙.
// next: what ⏭ does (default: the next sentence).
function Controls({ j, next, loop = false, voice, text }: { j: ReturnType<typeof useJoined>; next?: { go: () => void; label: string }; loop?: boolean; voice?: VoicePick; text?: TextPick }) {
  const playing = j.phase === "playing";
  const [sheet, setSheet] = useState(false);
  const looping = loop && j.loop !== "off";
  return (
    <div className="nw-ctl">
      <button className="nw-ic nw-rate" onClick={() => setSheet(true)} aria-label="速さ">
        {j.rate.toFixed(1)}×
      </button>
      <button className="nw-ic" onClick={j.again} disabled={j.idx < 0} aria-label="前の文">
        <Svg d={Icon.prev} />
      </button>
      <button className="nw-play" onClick={j.toggle} disabled={j.phase === "loading"} aria-label={playing ? "一時停止" : "再生"}>
        {j.phase === "loading" ? <span className="nw-spin" /> : <Svg d={playing ? Icon.pause : Icon.play} />}
      </button>
      <button className="nw-ic" onClick={next?.go ?? j.skip} disabled={j.idx < 0} aria-label={next?.label ?? "次の文"}>
        <Svg d={Icon.next} />
      </button>
      <button className={`nw-ic${looping ? " on" : ""}`} onClick={() => setSheet(true)} aria-label="設定">
        <Svg d={Icon.more} />
        {looping && <i className="nw-dot" />}
      </button>
      {sheet && <PlaySheet j={j} loop={loop} voice={voice} text={text} onClose={() => setSheet(false)} />}
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
  const all = useNews();
  // 字幕: the first time no text, only each sentence's picture; once heard, in kana. The learner switches.
  const [cap, setCap] = useState<CaptionMode>(() => (p.news?.[a.id]?.heard ? "kana" : "none"));
  const pics = cap === "none";
  const voice = voiceOf(p, a);
  // ループ 6声: each sentence in all six voices, one round per sentence (lib/client/news.ts sixRounds);
  // 6声+話: with a beep and time to say it after each voice.
  const [mode, setMode] = useState<"" | "six" | "talk">("");
  const six = mode !== "";
  const rounds = useMemo(() => (mode ? sixRounds(a, voice, mode === "talk", pics) : [articleClips(a, voice, "read", pics)]), [a, voice, mode, pics]);
  // ループ 声を変えて: at the end, the next voice (women, then men), and the article again in it.
  const cycling = useRef(false);
  const j = useJoined(rounds, {
    album: "NHKやさしいことばニュース",
    loopable: true,
    onDone: () => {
      markNews(a.id, { heard: dayKey() });
      if (j.loop !== "voices") return;
      cycling.current = true;
      markNews(a.id, { voice: NEWS_VOICES[(NEWS_VOICES.indexOf(voice) + 1) % NEWS_VOICES.length] });
    },
  });
  // Clip 0 is the title; sentence i is clip i + 1 (in 6声, round i + 1, its clips the six voices).
  const at = j.phase === "idle" ? -2 : six ? j.round - 1 : j.idx - 1;
  const goTo = (i: number) => (six ? j.start(i + 1) : j.phase === "idle" || j.phase === "done" ? j.start().then(() => j.seek(i + 1)) : j.seek(i + 1));
  // Switched between 6声, 6声+話 and the rest while playing: on from the same sentence.
  useEffect(() => {
    const m = j.loop === "six" || j.loop === "talk" ? j.loop : "";
    if (mode === m) return;
    const from = at;
    setMode(m);
    if (j.phase !== "idle" && j.phase !== "done") setTimeout(() => (m ? j.start(Math.max(0, from + 1)) : j.start().then(() => j.seek(Math.max(0, from + 1)))), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j.loop]);
  useHeardAtHalf(a, at + 1);
  const miss = missOf(p, a);
  // 6声+話: while the learner says it (after the beep), the picture fades, so it is said from the sound alone.
  const saying = mode === "talk" && at >= 0 && j.idx >= 0 && j.pos.at > j.pos.span - talkGap(a.sentences[at]?.say ?? "") / 1000 - 0.35;
  // Another voice picked while playing: on from the same sentence in it.
  const said = useRef(voice);
  useEffect(() => {
    if (said.current === voice) return;
    said.current = voice;
    if (cycling.current) {
      cycling.current = false;
      j.start();
    } else if (j.phase !== "idle" && j.phase !== "done") (six ? j.start(Math.max(0, at + 1)) : j.start().then(() => j.seek(Math.max(0, at + 1))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);

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
        <CaptionSwitch mode={cap} set={setCap} />
      </div>
      <SceneStage a={a} at={at} off={saying} big={pics} />
      <h1 className={`nw-title${at === -1 ? " now" : ""}`} data-ask-topic={a.title_ja}>
        {cap === "zh" ? a.title_zh : cap === "kana" ? <Kana segs={a.title} fill={at === -1 ? j.frac * lenOf(a.title) : 0} /> : <Ruby segs={a.title} fill={at === -1 ? j.frac * lenOf(a.title) : 0} />}
      </h1>
      <div className="nw-date">{md(a.day)} · NHKやさしいことばニュース</div>
      {pics && (
        <div className="sc-under">
          <div className="nw-sdots big" aria-label={`${Math.max(0, at + 1)} / ${a.sentences.length}`}>
            {a.sentences.map((_, i) => (
              <button key={i} className={`${i < at ? "on" : i === at ? "now" : ""}${miss.includes(i) ? " miss" : ""}`} onClick={() => goTo(i)} aria-label={`${i + 1}`} />
            ))}
          </div>
          {at >= 0 && six && j.idx >= 0 && (
            <div className="nw-six">
              {VOICE_LABEL.map((l, k) => (
                <i key={l} className={k === j.idx ? "on" : k < j.idx ? "past" : undefined}>{l}</i>
              ))}
            </div>
          )}
          {at >= 0 ? (
            <button className={`nw-qi${miss.includes(at) ? " on" : ""}`} onClick={() => toggleMiss(p, a, at)}>
              ？ 聞き取れなかった
            </button>
          ) : (
            <div className="nw-hidden">耳だけで聞いてみよう</div>
          )}
        </div>
      )}
      <div className={`nw-body${pics ? " gone" : ""}`}>
        {paras(a).map((para) => (
          <div key={para[0]} className="nw-para">
            {para.map((i) => {
              const s = a.sentences[i];
              return (
                <div key={i} ref={(el) => void (lines.current[i] = el)} className={`nw-s${i === at ? " now" : ""}${miss.includes(i) ? " miss" : ""}`}>
                  <p data-line={s.ja} className={cap === "zh" ? "zh-only" : undefined} onClick={() => goTo(i)}>
                    {cap === "zh" ? s.zh : cap === "kana" ? <Kana segs={s.segs} fill={i === at ? j.frac * lenOf(s.segs) : 0} /> : <Ruby segs={s.segs} fill={i === at ? j.frac * lenOf(s.segs) : 0} />}
                  </p>
                  {i === at && six && j.idx >= 0 && (
                    <div className="nw-six">
                      {VOICE_LABEL.map((l, k) => (
                        <i key={l} className={k === j.idx ? "on" : k < j.idx ? "past" : undefined}>{l}</i>
                      ))}
                    </div>
                  )}
                  {i === at && (
                    <button className={`nw-qi${miss.includes(i) ? " on" : ""}`} onClick={() => toggleMiss(p, a, i)}>
                      ？ 聞き取れなかった
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <a className="nw-src" href={a.url} target="_blank" rel="noreferrer">出典：NHK NEWS WEB EASY ›</a>

      {a.words.length > 0 && (
        <>
          <div className="tab-label" id="words">単語</div>
          <div className="rowlist">
            {a.words.map((w) => (
              <div key={w.ja} className="rowlist-row nw-word" data-line={w.ja}>
                <WordPic src={w.image_url} />
                <button
                  className="nw-word-say"
                  onClick={() => {
                    unlock();
                    play(ttsUrl(w.ja, voice)).catch(() => {});
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
                <Star p={p} ja={w.ja} reading={w.kana} zh={w.zh} voice={voice} scenarioId={`news:${a.id}`} img={w.image_url} />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="nw-end" ref={end}>
        <PicQuiz a={a} others={all} voice={voice} />
        <Note text="听完了，用自己的话讲三遍。" />
        <Link href={`/retell?news=${a.id}`} className="pil-go on">讲三遍</Link>
      </div>

      <div className="nw-dock">
        <div className="nw-bar">
          <i style={{ width: `${j.idx < 0 ? 0 : Math.round(((six ? j.round + (j.idx + j.frac) / 6 : j.idx + j.frac) / (a.sentences.length + 1)) * 100)}%` }} />
        </div>
        <Controls
          j={j}
          loop
          voice={{ voice, set: (v) => markNews(a.id, { voice: v }) }}
        />
        {j.error && <p className="error">{j.error}</p>}
      </div>
      <audio {...j.audioProps} />
    </main>
  );
}

// ---- The articles not heard yet, back to back ----

const paceLabel = (pace: number) => (pace < 1 ? " · ゆっくり" : pace > 1.2 ? " · 速め" : pace > 1 ? " · 少し速め" : "");

const CAP_KEY = "nihongo-speak:caption2";

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
  // Sentences marked ？ on earlier days come first, in two rounds (off): in another voice without the text, then
  // with it. Then two rounds per article: off + 2i without the text, off + 2i + 1 with it.
  const [back] = useState(() => backSet(p, today));
  const off = back.length ? 2 : 0;
  const voices = today.map((a) => voiceOf(p, a)).join();
  const rounds = useMemo(
    () => [
      ...(back.length ? [backClips(p, back, "ear"), backClips(p, back, "text")] : []),
      ...today.flatMap((a) => [articleClips(a, voiceOf(p, a), "ear", true), articleClips(a, voiceOf(p, a), "text")]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today, back, voices],
  );
  const [showZh, setShowZh] = useState(false);
  // 2回目's 字幕 (kana unless the learner picked another), kept on the phone.
  const [cap, setCapState] = useState<CaptionMode>("kana");
  useEffect(() => {
    try {
      const c = localStorage.getItem(CAP_KEY) as CaptionMode | null;
      if (c && c !== "none" && ["kana", "kanji", "zh"].includes(c)) setCapState(c);
    } catch {}
  }, []);
  const setCap = (c: CaptionMode) => {
    setCapState(c);
    try {
      localStorage.setItem(CAP_KEY, c);
    } catch {}
  };
  const j = useJoined(rounds, {
    album: newsDay(set.day),
    // The pass without the text goes at the article's own pace (slower or faster), the pass with it at 1.
    paceOf: (r) => (r >= off && r % 2 === 0 && today[Math.floor((r - off) / 2)] ? newsPace(today[Math.floor((r - off) / 2)]) : 1),
    onRoundEnd: (r) => {
      if (r < off) {
        if (r === off - 1) clearBack(p, back);
        return;
      }
      if (r % 2 === 0) markNews(today[Math.floor((r - off) / 2)].id, { heard: dayKey() });
    },
    onDone: () => stepDone(),
  });
  useEffect(() => setShowZh(false), [j.idx]);
  const inBack = j.round < off && j.phase !== "idle";
  const n = Math.floor(Math.max(0, j.round - off) / 2);
  const a = today[n];
  // off is even, so this holds for the rounds of ？ sentences too.
  const second = j.round % 2 === 1;
  const sentence = j.idx < 0 ? -2 : j.idx - 1;
  useHeardAtHalf(j.phase === "idle" || second || inBack ? undefined : a, sentence + 1);
  // Another voice picked for this article while playing: this pass again from the same sentence, in it.
  const said = useRef(voices);
  useEffect(() => {
    if (said.current === voices) return;
    said.current = voices;
    if (j.phase !== "idle" && j.phase !== "done") j.start(j.round).then(() => j.seek(Math.max(0, j.idx)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices]);
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
  const backNow = inBack && j.idx >= 0 ? back[j.idx] : null;
  const s = backNow ? backNow.a.sentences[backNow.i] : !idle && !inBack && sentence >= 0 ? a.sentences[sentence] : null;
  return (
    <main className="page nw-page">
      <div className="nw-top">
        <Link href="/" className="back">‹ 听</Link>
        <span className="muted">{newsDay(set.day)} {idle ? today.length : inBack ? "" : `${n + 1} / ${today.length}`}</span>
      </div>
      <div className="kicker">{idle ? "2回ずつ · 1回目は文字なし" : inBack ? (second ? "聞き直す · 文字あり" : "聞き直す · 別の声で") : second ? "2回目 · 文字あり" : `1回目 · 文字なし${paceLabel(newsPace(a))}`}</div>
      <h1 className="nw-title">{idle ? "新闻" : inBack ? "前に聞き取れなかった文" : <Ruby segs={a.title} />}</h1>
      <div className="nw-dots">
        {today.map((x, i) => (
          <span key={x.id} className={(!inBack && (i < n || (i === n && !idle))) || (idle && p.news?.[x.id]?.heard === dayKey()) ? "on" : ""} />
        ))}
      </div>
      <div className="nw-stage">
        {idle ? (
          <div className="nw-list">
            {back.length > 0 && <div className="nw-back">？ 聞き直す {back.length}文</div>}
            {today.map((x) => (
              <div key={x.id}>{x.title_ja}</div>
            ))}
          </div>
        ) : second && s ? (
          <div onClick={() => cap !== "zh" && cap !== "none" && setShowZh(!showZh)}>
            <div className="cap-row" onClick={(e) => e.stopPropagation()}>
              <CaptionSwitch mode={cap} set={setCap} />
            </div>
            {cap === "none" ? (
              <div className="nw-hidden">耳だけで聞いてみよう</div>
            ) : (
              <p className={`nw-now${cap === "zh" ? " zh-only" : ""}`} data-line={s.ja}>
                {cap === "zh" ? s.zh : cap === "kana" ? <Kana segs={s.segs} fill={j.frac * lenOf(s.segs)} /> : <Ruby segs={s.segs} fill={j.frac * lenOf(s.segs)} />}
              </p>
            )}
            {cap === "zh" || cap === "none" ? null : showZh ? <div className="nw-zh">{s.zh}</div> : <small className="muted nw-tap">点一下看中文</small>}
            {!inBack && (
              <button
                className={`nw-chip nw-q${missOf(p, a).includes(sentence) ? " on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMiss(p, a, sentence);
                }}
              >
                ？ 聞き取れなかった
              </button>
            )}
          </div>
        ) : second ? (
          <div className="nw-hidden">{a.title_ja}</div>
        ) : inBack ? (
          <>
            <div className="nw-hidden">耳だけで聞いてみよう</div>
            <div className="nw-sdots" aria-label={`${Math.max(0, j.idx + 1)} / ${back.length}`}>
              {back.map((_, i) => (
                <span key={i} className={i < j.idx ? "on" : i === j.idx ? "now" : ""} />
              ))}
            </div>
          </>
        ) : (
          <>
            <SceneStage a={a} at={sentence} big />
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
          <button className="pil-go on" onClick={() => j.start(from > 0 ? off + from * 2 : 0)}>
            {from > 0 ? `▶ 続きから（${from + 1}本目）` : "▶ 全部听"}
          </button>
        ) : (
          <Controls
            j={j}
            voice={inBack || !a ? undefined : { voice: voiceOf(p, a), set: (v) => markNews(a.id, { voice: v }) }}
            // 1回目: on to the pass with the text; 2回目: the next article.
            next={{ go: () => j.seek(999), label: second ? "次へ" : "文字ありへ" }}
          />
        )}
        {j.error && <p className="error">{j.error}</p>}
      </div>
      <audio {...j.audioProps} />
    </main>
  );
}
