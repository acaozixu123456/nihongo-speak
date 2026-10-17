"use client";

import Link from "next/link";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { dayKey, dueCards, findScenario, useProgress } from "@/lib/client/progress";

// How well a saved expression is known, from its review interval step.
const RANK = ["新收藏", "熟悉", "熟练", "掌握"];

// Saved expressions, the ones due for review first.
export default function Bag() {
  const p = useProgress();
  const due = dueCards(p);
  const today = dayKey();
  const cards = [...p.cards].sort((a, b) => (a.due < b.due ? -1 : 1));

  return (
    <main>
      <Link href="/me" className="back">← 我</Link>
      <header className="page-mast">
        <div>
          <h1>收藏的表达</h1>
          <p className="muted">
            {p.cards.length} 句{due.length ? ` · ${due.length} 句今天该复习` : ""}
          </p>
        </div>
      </header>

      {due.length > 0 && (
        <Link href="/review" className="btn primary next-cta" style={{ display: "block" }}>
          复习今天到期的 {due.length} 句
        </Link>
      )}

      {cards.length === 0 ? (
        <p className="muted">还没有收藏。跟读或对话时点「收藏」，句子就会放在这里，之后按间隔提醒你复习。</p>
      ) : (
        <div className="list">
          {cards.map((c) => {
            const from = findScenario(p, c.scenarioId);
            return (
              <div key={c.id} className="item">
                <div className="item-body">
                  <div className="ja">{c.ja}</div>
                  {c.reading && <div className="kana">{c.reading}</div>}
                  <div className="zh">{c.zh}</div>
                  <div className="small-text" style={{ marginTop: 4 }}>
                    {RANK[Math.min(3, c.step)]} · {c.due <= today ? <span className="y">今天复习</span> : `下次 ${c.due.slice(5)}`}
                    {from && ` · ${from.titleZh}`}
                  </div>
                </div>
                <button
                  className="small"
                  onClick={() => {
                    unlock();
                    play(ttsUrl(c.ja, c.voice), 1).catch(() => {});
                  }}
                >
                  听
                </button>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
