"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NewsArticle } from "@/lib/news-model";
import { useHydrated } from "@/lib/client/hydrated";
import { fullOpen, saidCount, useNews, voiceOf } from "@/lib/client/news";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { markNews, useProgress } from "@/lib/client/progress";
import { verdict } from "@/lib/client/fx";
import { loadPause, startPause, stopPause } from "@/lib/client/bgm";
import { renewAudio } from "@/lib/client/audio";
import { flowOf, runClips } from "@/lib/client/fluency";
import { transcribeLong } from "@/lib/client/recorder";
import HoldButton from "./HoldButton";

// 全文模式: once every sentence of an article was said right one by one, the whole article from its Chinese,
// said in one go. Scored by meaning (not word for word); each sentence not quite right comes back in the
// learner's own words made right, plus a few expressions worth using next time.

type Item = { n: number; verdict: "good" | "close" | "off"; said: string; better: string; fix_zh: string };
type Result = { said: string; score: number; good_zh: string; items: Item[]; tips: { ja: string; zh: string }[] };

// The paragraphs of the article, as sentence indexes.
const paras = (a: NewsArticle) =>
  a.sentences.reduce<number[][]>((out, s, i) => (s.p || !out.length ? out.push([i]) : out[out.length - 1].push(i), out), []);

export function NewsFullPage({ id }: { id: string }) {
  const items = useNews();
  const hydrated = useHydrated();
  const p = useProgress();
  const a = items.find((x) => x.id === id);
  if (!hydrated) return <main className="page" />;
  if (!a)
    return (
      <main className="page">
        <Link href="/" className="back">‹ 听</Link>
        <p className="muted">{items.length ? "这条新闻已经不在了（只保留 14 天）" : "正在读取…"}</p>
      </main>
    );
  if (!fullOpen(p, a))
    return (
      <main className="page say-page">
        <Link href={`/news/${a.id}`} className="back">‹ 記事</Link>
        <h1 className="say-big">全文模式</h1>
        <div className="say-bigzh">每句都 ✓ 之后解锁（现在 {saidCount(p, a)} / {a.sentences.length}）</div>
        <div className="sticky-cta">
          <Link href={`/news/${a.id}/say?i=${Math.max(0, a.sentences.findIndex((_, i) => p.news?.[a.id]?.said?.[i] !== 1))}`} className="pil-go on">
            一句一句说
          </Link>
        </div>
      </main>
    );
  return <Full a={a} />;
}

function Full({ a }: { a: NewsArticle }) {
  const p = useProgress();
  const voice = voiceOf(p, a);
  const best = p.news?.[a.id]?.full;
  const [phase, setPhase] = useState<"ready" | "rec" | "wait" | "done">("ready");
  const [res, setRes] = useState<Result | null>(null);
  const [prev, setPrev] = useState<number | undefined>(undefined);
  const [error, setError] = useState("");
  const turn = useRef(0);

  useEffect(() => {
    void loadPause();
    return () => void stopPause(0);
  }, []);

  const say = (t: string) => {
    unlock();
    play(ttsUrl(t, voice)).catch(() => {});
  };

  async function onRecorded(wav: Blob) {
    const mine = ++turn.current;
    setPhase("wait");
    setError("");
    void startPause();
    try {
      const flow = await flowOf(wav);
      if (!flow.runs.length) throw new Error("没听到声音，再说一次");
      // Azure's transcript goes along, for when Gemini is slow (see /api/say-full).
      const [clips, azure] = await Promise.all([runClips(wav, flow.runs), transcribeLong(wav).catch(() => "")]);
      const r = await fetch("/api/say-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: a.title_ja, sentences: a.sentences.map((s) => ({ ja: s.ja, zh: s.zh })), clips, azure }),
      });
      const data = (await r.json()) as Result & { error?: string };
      if (!r.ok) throw new Error(data.error ?? "出错了，再说一次");
      if (turn.current !== mine) return;
      void stopPause(1);
      setPrev(best);
      setRes(data);
      setPhase("done");
      verdict(data.score >= 80 ? "right" : data.score >= 60 ? "close" : "wrong");
      if (best === undefined || data.score > best) markNews(a.id, { full: data.score });
    } catch (e) {
      if (turn.current !== mine) return;
      void stopPause(0.5);
      setError(e instanceof Error ? e.message : "出错了，再说一次");
      setPhase("ready");
    }
  }

  function again() {
    turn.current++;
    void stopPause(0.3);
    setRes(null);
    setError("");
    setPhase("ready");
  }

  if (phase === "done" && res) {
    const off = res.items.filter((x) => x.verdict !== "good" && a.sentences[x.n - 1]);
    const good = a.sentences.length - off.length;
    return (
      <main className="page say-page">
        <div className="say-top">
          <Link href={`/news/${a.id}`} className="back">‹ 記事</Link>
          <span className="muted">全文模式</span>
        </div>
        <div className="full-score">
          <b className={res.score >= 80 ? "ok" : res.score >= 60 ? "mid" : "no"}>{res.score}</b>
          <span>/ 100</span>
          {prev !== undefined && res.score > prev && <em>+{res.score - prev} 新纪录</em>}
          {prev !== undefined && res.score <= prev && <small>上次最好 {prev}</small>}
        </div>
        <div className="say-bigzh">{a.sentences.length} 句里说对了 {good} 句</div>
        {res.good_zh && (
          <div className="say-blk g">
            <div className="say-bh"><i>✓</i>说得好</div>
            <div className="say-zh full-good">{res.good_zh}</div>
          </div>
        )}
        {off.map((x) => {
          const s = a.sentences[x.n - 1];
          return (
            <div key={x.n} className="say-blk n full-item">
              <div className="say-bh">{x.n}文目 · {s.zh}</div>
              <p className="say-res say-mine">{x.said || "（没说）"}</p>
              {x.better && (
                <div className="say-miss full-better">
                  <b>{x.better}</b>
                  <button className="say-play" onClick={() => say(x.better)} aria-label="听">▶</button>
                </div>
              )}
              {x.fix_zh && <div className="say-zh">{x.fix_zh}</div>}
            </div>
          );
        })}
        {res.tips.length > 0 && (
          <>
            <div className="full-h">用用看</div>
            <div className="pl-grid">
              {res.tips.map((t) => (
                <button key={t.ja} className="pl full-tip" onClick={() => say(t.ja)}>
                  <span>
                    <b>{t.ja}</b>
                    <small>{t.zh}</small>
                  </span>
                  <i>▶</i>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sticky-cta">
          <button className="pil-go on" onClick={again}>再来一次</button>
          <Link href={`/news/${a.id}`} className="say-sub">回到文章</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page say-page">
      <div className="say-top">
        <Link href={`/news/${a.id}`} className="back">‹ 記事</Link>
        <span className="muted">{best !== undefined ? `最好 ${best}` : ""}</span>
      </div>
      <div className="say-kind">全文模式</div>
      <h1 className="full-title">{a.title_zh}</h1>
      <div className="say-card full-zh">
        {paras(a).map((para) => (
          <p key={para[0]}>{para.map((i) => a.sentences[i].zh).join("")}</p>
        ))}
      </div>
      <div className="say-bigzh">看着中文，用英语把整篇说一遍</div>
      <div className="say-mic">
        {phase === "wait" ? (
          <div className="say-miclab">在听…</div>
        ) : (
          <>
            <HoldButton
              compact
              limit={150}
              label={
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-label="说">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              }
              onStart={() => {
                // iPhone only starts Web Audio inside a tap; the music while scoring starts long after it.
                renewAudio();
                setPhase("rec");
              }}
              onRecorded={onRecorded}
              onError={(e) => {
                if (e) setPhase("ready");
                setError(e);
              }}
            />
            <div className="say-miclab">{phase === "rec" ? "正在说" : "说"}<small>{phase === "rec" ? "说完点一下" : ""}</small></div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
