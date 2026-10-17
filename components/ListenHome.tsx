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

// 听: the latest 趣味电台 episode with its notes, a new one on demand, 一直听 (摸鱼模式), and the back catalogue.
export default function ListenHome() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eps = hydrated ? p.episodes : [];
  const latest = eps[0];
  const minutes = Math.floor((todayStats(p).moyuSec ?? 0) / 60);

  const d = new Date();
  const date = hydrated ? `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY_JA[d.getDay()]}）${minutes ? ` · 今天听了 ${minutes} 分钟` : ""}` : "";

  async function fresh() {
    setBusy(true);
    setError("");
    try {
      const ep = await makeRadio();
      router.push(`/ep/${ep.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Top note={date} />
      <h1 className="display">
        聴く<small>听</small>
      </h1>

      {latest && !latest.heard ? (
        <EpisodeCard ep={latest} n={eps.length} />
      ) : (
        <div className="today">
          <span className="kicker">趣味电台</span>
          <span className="today-title">
            <span className="ja-serif">{latest ? "新しい回" : "はじめての回"}</span>
          </span>
          <span className="today-zh">两位主持人聊一个日本的冷知识，约 5 分钟。AI 同时整理好文稿、重点句、单词和语法，重点句自动进复习。</span>
        </div>
      )}
      <button className="cta" onClick={fresh} disabled={busy}>
        {busy ? "AI 正在写这一期，大约 20 秒…" : latest && !latest.heard ? "换一期新的" : "生成新的一期"}
      </button>
      {error && <p className="error">{error}</p>}

      <Link href="/moyu" className="entry entry-solo">
        <span className="entry-ja">流す</span>
        <span className="entry-text">
          一直听
          <small>电台、复习、瞬间说轮着放，锁屏不停，适合通勤和摸鱼</small>
        </span>
        <span className="chev" aria-hidden>›</span>
      </Link>

      {eps.length > (latest && !latest.heard ? 1 : 0) && (
        <section>
          <h2 className="sec">往期 · {eps.length}</h2>
          <div className="rows">
            {eps.slice(latest && !latest.heard ? 1 : 0).map((e) => (
              <Link key={e.id} href={`/ep/${e.id}`} className="ep-row">
                <span className="ep-date">{shortDate(e.date)}</span>
                <span className="entry-text">
                  {e.title_zh}
                  <small>
                    {e.words?.length ?? 0} 个单词 · {e.grammar?.length ?? 0} 个语法{e.heard ? "" : " · 没听过"}
                  </small>
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

function EpisodeCard({ ep, n }: { ep: RadioEpisode; n: number }) {
  return (
    <Link href={`/ep/${ep.id}`} className="today">
      <span className="kicker">
        趣味电台 · 第 {n} 期 · {shortDate(ep.date)}
      </span>
      <span className="ep-title">{ep.title_zh}</span>
      <span className="today-zh">{ep.hook_zh}</span>
      <span className="ep-meta">
        <i>{ep.lines.length} 句对话</i>
        <i>{ep.words?.length ?? 0} 个单词</i>
        <i>{ep.grammar?.length ?? 0} 个语法</i>
      </span>
      <span className="today-go">▶ 收听</span>
    </Link>
  );
}
