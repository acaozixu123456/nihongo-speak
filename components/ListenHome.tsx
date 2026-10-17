"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { makeRadio } from "@/lib/client/moyu";
import { todayStats, useProgress, type RadioEpisode } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import Nav, { Top } from "./Nav";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

export const shortDate = (day: string) => {
  const [, m, d] = day.split("-").map(Number);
  return `${m}月${d}日`;
};

// 听: one card to press (the unheard episode, or make a new one), then 一直听 and the back catalogue as quiet rows.
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
  const past = unheard ? eps.slice(1) : eps;

  return (
    <main className="page">
      <Top note={date} />
      <h1 className="display">
        聴く
      </h1>

      {unheard ? (
        <EpisodeCard ep={unheard} />
      ) : (
        <button className="today today-btn" onClick={() => fresh()} disabled={busy}>
          <span className="kicker">趣味电台</span>
          <span className="today-title">
            <span className="ja-serif">{latest ? "新しい回" : "はじめての回"}</span>
          </span>
          <span className="today-zh">两人聊一个日本冷知识，约 5 分钟</span>
          <span className="today-go">{busy ? "AI 正在写这一期…" : "生成新的一期"}</span>
        </button>
      )}
      {error && <p className="error">{error}</p>}

      <div className="rows">
        <Link href="/moyu" className="entry">
          <span className="entry-text ja-serif">流す</span>
          <span className="chev" aria-hidden>›</span>
        </Link>
        {unheard && (
          <button className="entry" onClick={() => fresh()} disabled={busy}>
            <span className="entry-text">{busy ? "AI 正在写这一期…" : "生成新的一期"}</span>
            <span className="chev" aria-hidden>›</span>
          </button>
        )}
        {wishing ? (
          <form
            className="entry wish"
            onSubmit={(e) => {
              e.preventDefault();
              if (wish.trim()) fresh(wish.trim());
            }}
          >
            <input autoFocus value={wish} maxLength={100} onChange={(e) => setWish(e.target.value)} placeholder="想听什么？如：日本电车为啥这么准时" />
            <button type="submit" className="small" disabled={busy || !wish.trim()}>
              {busy ? "写着呢…" : "生成"}
            </button>
          </form>
        ) : (
          <button className="entry" onClick={() => setWishing(true)} disabled={busy}>
            <span className="entry-text ja-serif">リクエスト</span>
            <span className="chev" aria-hidden>›</span>
          </button>
        )}
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

function EpisodeCard({ ep }: { ep: RadioEpisode }) {
  return (
    <Link href={`/ep/${ep.id}`} className="today">
      <span className="kicker">趣味电台 · 新的一期</span>
      <span className="ep-title">{ep.title_zh}</span>
      <span className="today-go">▶ 收听</span>
    </Link>
  );
}
