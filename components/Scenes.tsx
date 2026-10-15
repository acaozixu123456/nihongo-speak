"use client";

import Link from "next/link";
import { scenarios, type Scenario } from "@/content/scenarios";
import { removeCustom, stepsDone, useProgress, type Progress } from "@/lib/client/progress";
import Nav from "./Nav";

function ScenarioCard({ p, s, n, custom }: { p: Progress; s: Scenario; n: number; custom?: boolean }) {
  const done = stepsDone(p, s);
  const best = Object.values(p.scenarios[s.id]?.shadow ?? {});
  const avg = best.length ? Math.round(best.reduce((a, b) => a + b, 0) / best.length) : null;
  const allDone = done.listen && done.shadow && done.talk;
  return (
    <Link href={`/s/${s.id}`} className={`tile ${allDone ? "done" : ""}`}>
      <div className="tile-top">
        <span className="tile-n">{String(n).padStart(2, "0")}</span>
        {custom && <span className="tag">AI</span>}
        {allDone && <i className="stamp">済</i>}
      </div>
      <div className="tile-icon">{s.icon}</div>
      <strong className="tile-title">{s.titleZh}</strong>
      <div className="tile-ja ellipsis">{s.title}</div>
      <div className="steps3">
        <i className={done.listen ? "on" : ""}>聴</i>
        <i className={done.shadow ? "on" : ""}>読</i>
        <i className={done.talk ? "on" : ""}>話</i>
        {avg !== null && <span className="small-text">{avg}</span>}
      </div>
      {custom && (
        <button
          className="small ghost tile-x"
          aria-label="删除"
          onClick={(e) => {
            e.preventDefault();
            if (confirm(`删除「${s.titleZh}」？`)) removeCustom(s.id);
          }}
        >
          ✕
        </button>
      )}
    </Link>
  );
}

export default function Scenes() {
  const p = useProgress();
  const groups = [
    { key: "work", label: "职场", ja: "職場" },
    { key: "life", label: "生活", ja: "生活" },
  ] as const;
  return (
    <main>
      <header className="page-mast">
        <h1>場面</h1>
        <p className="muted">场景 · 每个场景三步：聴 精听 → 読 跟读 → 話 和 AI 对话</p>
      </header>
      <Link href="/new" className="go solid big">
        <span className="go-kanji" aria-hidden>新</span>
        <div className="title">生成新场景</div>
        <div className="cta">说说你最近遇到的情况，AI 帮你写成练习 →</div>
      </Link>
      {p.custom.length > 0 && (
        <section>
          <h2>自作 <span>我的场景</span></h2>
          <div className="tiles">
            {p.custom.map((s, i) => (
              <ScenarioCard key={s.id} p={p} s={s} n={i + 1} custom />
            ))}
          </div>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.key}>
          <h2>{g.ja} <span>{g.label}</span></h2>
          <div className="tiles">
            {scenarios
              .filter((s) => s.category === g.key)
              .map((s, i) => (
                <ScenarioCard key={s.id} p={p} s={s} n={i + 1} />
              ))}
          </div>
        </section>
      ))}
      <Nav on="scenes" />
    </main>
  );
}
