"use client";

import Link from "next/link";
import { useState } from "react";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { allScenarios, dayKey, dueCards, findScenario, useProgress, weakList } from "@/lib/client/progress";
import { BUILDINGS, buildingOf, stars, starText } from "@/lib/client/game";
import Nav from "./Nav";

type Tab = "scrolls" | "items" | "book";

// Mastery of a saved expression, from its review interval step.
const RANK = ["见习", "熟悉", "熟练", "掌握"];

// The bag: saved expressions as scrolls, items, and a picture book of scenes.
export default function Bag() {
  const p = useProgress();
  const [tab, setTab] = useState<Tab>("scrolls");
  const [pick, setPick] = useState<string | null>(null);
  const due = dueCards(p);
  const today = dayKey();
  const cards = [...p.cards].sort((a, b) => (a.due < b.due ? -1 : 1));
  const card = cards.find((c) => c.id === pick) ?? cards[0];
  const scenes = allScenarios(p);
  const weak = weakList(p);
  const slots = Math.max(12, Math.ceil(cards.length / 4) * 4);

  return (
    <main>
      <Link href="/me" className="back">← 我</Link>
      <header className="page-mast">
        <span className="icon" aria-hidden>🎒</span>
        <div>
          <h1>背包</h1>
          <p className="muted">
            卷轴 {p.cards.length} · 保护卡 {p.freezes} · 待复习 {due.length}
          </p>
        </div>
      </header>
      <div className="seg" style={{ margin: "10px 3px" }}>
        <button className={tab === "scrolls" ? "on" : ""} onClick={() => setTab("scrolls")}>📜 表达卷轴</button>
        <button className={tab === "items" ? "on" : ""} onClick={() => setTab("items")}>🧪 道具</button>
        <button className={tab === "book" ? "on" : ""} onClick={() => setTab("book")}>🏅 图鉴</button>
      </div>

      {tab === "scrolls" && (
        <>
          <div className="slots" style={{ margin: "0 3px" }}>
            {Array.from({ length: slots }, (_, i) => {
              const c = cards[i];
              if (!c) return <div key={i} className="slot empty">?</div>;
              const step = Math.min(3, c.step);
              return (
                <button
                  key={c.id}
                  className={`slot s${step} ${c.id === card?.id ? "sel" : ""} ${c.due <= today ? "due" : ""}`}
                  onClick={() => setPick(c.id)}
                  aria-label={c.ja}
                >
                  📜
                  <span className="cnt">{"★".repeat(step)}</span>
                </button>
              );
            })}
          </div>
          {card ? (
            <div className="win">
              <div className="small-text">
                📜 表达卷轴 <span className="y">{"★".repeat(Math.min(3, card.step)) || "☆"}</span> · {RANK[Math.min(3, card.step)]}
                {findScenario(p, card.scenarioId) && ` · 来自 ${findScenario(p, card.scenarioId)!.titleZh}`}
              </div>
              <div className="ja" style={{ marginTop: 6 }}>{card.ja}</div>
              {card.reading && <div className="kana">{card.reading}</div>}
              <div className="zh">{card.zh}</div>
              <div className="small-text" style={{ marginTop: 4 }}>{card.due <= today ? "今天该去神社复习了" : `下次复习：${card.due}`}</div>
              <div className="row" style={{ marginTop: 10 }}>
                <Link href="/review" className="btn primary">⛩️ 去神社复习 ({due.length})</Link>
                <button
                  onClick={() => {
                    unlock();
                    play(ttsUrl(card.ja, card.voice), 1).catch(() => {});
                  }}
                >
                  ▶ 听
                </button>
              </div>
            </div>
          ) : (
            <div className="win">
              <p className="muted" style={{ margin: 0 }}>背包还是空的。跟读时点 ☆、对话点评里点「☆ 收藏」，句子就会变成卷轴放进来。</p>
            </div>
          )}
        </>
      )}

      {tab === "items" && (
        <div className="win">
          <div className="quest">
            <span className="qi">🛡️</span>
            <span className="qb">
              连续保护卡 ×{p.freezes}
              <span className="small-text" style={{ display: "block" }}>连续 7 天得一张，最多 2 张。哪天没空练，自动帮你保住连续记录。</span>
            </span>
          </div>
          <Link href="/train#weak" className="quest">
            <span className="qi">📕</span>
            <span className="qb">
              弱点之书 · {weak.length} 页
              <span className="small-text" style={{ display: "block" }}>
                {weak.length ? `最弱：${weak[0].tag}` : "AI 发现的薄弱语法点会写在这里"}
              </span>
            </span>
            <span className="qr">打开</span>
          </Link>
          <Link href="/quick" className="quest">
            <span className="qi">⚡</span>
            <span className="qb">
              瞬间说道场券
              <span className="small-text" style={{ display: "block" }}>无限次使用 · 看中文，3 秒内开口</span>
            </span>
            <span className="qr">使用</span>
          </Link>
        </div>
      )}

      {tab === "book" && (
        <div className="win">
          {scenes.map((s) => {
            const b = buildingOf(s, p);
            const n = stars(p, s);
            return (
              <Link key={s.id} href={`/s/${s.id}`} className="quest">
                <span className="qi" style={n === 0 ? { filter: "grayscale(1)", opacity: 0.6 } : undefined}>{s.icon}</span>
                <span className="qb">
                  {s.titleZh}
                  <span className="small-text" style={{ display: "block" }}>
                    {BUILDINGS[b].icon} {BUILDINGS[b].name} · {s.title}
                  </span>
                </span>
                <span className="qr">{starText(n)}</span>
              </Link>
            );
          })}
          <p className="small-text" style={{ marginBottom: 0 }}>
            集齐 {scenes.reduce((a, s) => a + stars(p, s), 0)} / {scenes.length * 3} 颗星
          </p>
        </div>
      )}
      <Nav on="me" />
    </main>
  );
}
