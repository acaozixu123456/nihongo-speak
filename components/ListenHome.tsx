"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { makeRadio } from "@/lib/client/moyu";
import { dueSkillCount, todayStats, useProgress, type RadioEpisode } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import Nav, { Top } from "./Nav";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

export const shortDate = (day: string) => {
  const [, m, d] = day.split("-").map(Number);
  return `${m}月${d}日`;
};

// 听: one card to press (the unheard episode, else 練習 that's due, else the last episode again), then 一直听 and the back catalogue as quiet rows.
export default function ListenHome() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 点播: the learner's own topic for the next episode, typed in a row that opens on tap.
  const [wishing, setWishing] = useState(false);
  const [wish, setWish] = useState("");
  const eps = hydrated ? p.episodes : [];
  const latest = eps[0];
  const due = hydrated ? dueSkillCount(p) : 0;
  const minutes = Math.floor((todayStats(p).moyuSec ?? 0) / 60);

  const d = new Date();
  const date = hydrated ? `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY_JA[d.getDay()]}）${minutes ? ` · 今天听了 ${minutes} 分钟` : ""}` : "";

  async function fresh(topic?: string) {
    setBusy(true);
    setError("");
    try {
      const ep = await makeRadio(topic);
      router.push(`/ep/${ep.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setBusy(false);
    }
  }

  const unheard = latest && !latest.heard ? latest : null;
  const past = unheard || (latest && !due) ? eps.slice(1) : eps;

  return (
    <main className="page">
      <Top note={date} />
      <h1 className="display">
        聴く
      </h1>

      {unheard ? (
        <EpisodeCard ep={unheard} kicker="趣味电台 · 新的一期" go="▶ 收听" />
      ) : due > 0 ? (
        <Link href="/practice" className="today">
          <span className="kicker">練習</span>
          <span className="today-title">
            <span className="ja-serif">{due} 個</span>
          </span>
          <span className="today-go">始める</span>
        </Link>
      ) : latest ? (
        <EpisodeCard ep={latest} kicker="趣味电台 · もう一度" go="▶ もう一度聴く" />
      ) : (
        <button className="today today-btn" onClick={() => fresh()} disabled={busy}>
          <span className="kicker">趣味电台</span>
          <span className="today-title">
            <span className="ja-serif">はじめての回</span>
          </span>
          <span className="today-go">{busy ? "AI 正在写这一期…" : "生成"}</span>
        </button>
      )}
      {error && <p className="error">{error}</p>}

      <div className="rows">
        {due > 0 && unheard && (
          <Link href="/practice" className="entry">
            <span className="entry-text ja-serif">練習</span>
            <span className="entry-count">{due}</span>
            <span className="chev" aria-hidden>›</span>
          </Link>
        )}
        <Link href="/moyu" className="entry">
          <span className="entry-text ja-serif">流す</span>
          <span className="chev" aria-hidden>›</span>
        </Link>
        {/* A new episode costs money and a minute of waiting, so it takes two taps: open the row, then 生成 (blank = any topic). */}
        {latest && (wishing ? (
          <form
            className="entry wish"
            onSubmit={(e) => {
              e.preventDefault();
              fresh(wish.trim() || undefined);
            }}
          >
            <input autoFocus value={wish} maxLength={100} onChange={(e) => setWish(e.target.value)} placeholder="想听什么？留空就随便聊" />
            <button type="submit" className="small" disabled={busy}>
              {busy ? "写着呢…" : "生成"}
            </button>
          </form>
        ) : (
          <button className="entry" onClick={() => setWishing(true)} disabled={busy}>
            <span className="entry-text ja-serif">新しい回</span>
            <span className="chev" aria-hidden>›</span>
          </button>
        ))}
      </div>

      {past.length > 0 && (
        <section>
          <h2 className="sec">往期</h2>
          <div className="rows">
            {past.map((e) => (
              <Link key={e.id} href={`/ep/${e.id}`} className="ep-row">
                <span className="ep-date">{shortDate(e.date)}</span>
                <span className="entry-text">
                  {e.title_zh}
                  {!e.heard && <i className="dot" aria-label="没听过" />}
                </span>
                <span className="chev" aria-hidden>›</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <Nav on="listen" />
    </main>
  );
}

function EpisodeCard({ ep, kicker, go }: { ep: RadioEpisode; kicker: string; go: string }) {
  return (
    <Link href={`/ep/${ep.id}`} className="today">
      <span className="kicker">{kicker}</span>
      <span className="ep-title">{ep.title_zh}</span>
      <span className="today-go">{go}</span>
    </Link>
  );
}
