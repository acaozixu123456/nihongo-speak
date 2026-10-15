"use client";

import Link from "next/link";
import { useProgress, weakList, weakness } from "@/lib/client/progress";
import Nav from "./Nav";

// Grammar points and expressions the AI coach keeps seeing the learner get wrong.
export default function Weak() {
  const p = useProgress();
  const list = weakList(p);
  const fixed = Object.values(p.weak).filter((w) => w.miss > 0 && weakness(w) <= 0).length;
  return (
    <main>
      <header className="page-mast">
        <span className="icon" aria-hidden>📕</span>
        <div>
          <h1>弱点の書</h1>
          <p className="muted">薄弱点 · AI 从你每次开口里找出来的</p>
        </div>
      </header>
      {list.length === 0 ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>{Object.keys(p.weak).length ? "现在没有明显的薄弱点 🎉" : "还没有记录。"}</p>
          <p className="muted">
            在瞬间说和复习里每说一句，AI 会看这句考的是哪个语法或说法、你用对了没有。同一个点错得多，就会出现在这里，可以针对它专门练。
          </p>
          <Link href="/quick">去练瞬间说 →</Link>
        </div>
      ) : (
        <div className="card">
          {list.map((w) => (
            <Link key={w.tag} href={`/quick?drill=${encodeURIComponent(w.tag)}`} className="weak-row">
              <div className="row spread">
                <span className="weak-tag">{w.tag}</span>
                <span className="small-text">
                  错 {w.miss} · 对 {w.hit}
                </span>
              </div>
              <div className="small-text">{w.zh}</div>
              <div className="weak-bar">
                <div style={{ width: `${(w.miss / (w.miss + w.hit)) * 100}%` }} />
              </div>
              {w.examples[0] && (
                <div className="weak-ex">
                  <s>{w.examples[0].said}</s> → {w.examples[0].better}
                </div>
              )}
              <div className="small-text" style={{ color: "var(--accent)" }}>强化练习 →</div>
            </Link>
          ))}
        </div>
      )}
      {fixed > 0 && <p className="muted" style={{ textAlign: "center" }}>已经练好 {fixed} 个曾经的薄弱点。</p>}
      <Nav on="bag" />
    </main>
  );
}
