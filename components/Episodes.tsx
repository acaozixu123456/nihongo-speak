"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { makeRadio, makingText, SHOW_LINES, useRadioMaking } from "@/lib/client/moyu";
import { useProgress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";

export const shortDate = (day: string) => {
  const [, m, d] = day.split("-").map(Number);
  return `${m}月${d}日`;
};

// 往期: every kept episode, and リクエスト for an episode on a topic of your own.
export default function Episodes() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wishing, setWishing] = useState(false);
  const [wish, setWish] = useState("");
  const eps = hydrated ? p.episodes : [];
  const making = useRadioMaking();

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

  return (
    <main className="page">
      <Link href="/me" className="back">← 我</Link>
      <h1 className="display">往期</h1>
      <div className="rows">
        {/* A new episode costs money and a minute of waiting, so it takes two taps: open the row, then 生成 (blank = any topic). */}
        {wishing ? (
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
        ) : null}
        {wishing && busy && making ? (
          <div className="making">
            <div className="making-text">{makingText(making)}</div>
            <div className={`track making ${making.stage === "claude" ? "slow" : ""}`}>
              <div style={{ width: `${making.stage === "write" ? Math.min(95, 5 + (making.lines / SHOW_LINES) * 90) : making.stage === "start" ? 4 : 50}%` }} />
            </div>
          </div>
        ) : null}
        {wishing ? null : (
          <button className="entry" onClick={() => setWishing(true)}>
            <span className="entry-text ja-serif">リクエスト</span>
            <span className="chev" aria-hidden>›</span>
          </button>
        )}
        {eps.map((e) => (
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
      {error && <p className="error">{error}</p>}
    </main>
  );
}
