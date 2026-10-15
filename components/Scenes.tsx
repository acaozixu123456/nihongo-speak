"use client";

import Link from "next/link";
import { scenarios, type Scenario } from "@/content/scenarios";
import { removeCustom, stepsDone, useProgress, type Progress } from "@/lib/client/progress";
import Nav from "./Nav";

function ScenarioCard({ p, s, custom }: { p: Progress; s: Scenario; custom?: boolean }) {
  const done = stepsDone(p, s);
  const best = Object.values(p.scenarios[s.id]?.shadow ?? {});
  const avg = best.length ? Math.round(best.reduce((a, b) => a + b, 0) / best.length) : null;
  const allDone = done.listen && done.shadow && done.talk;
  return (
    <Link href={`/s/${s.id}`} className="card scard">
      <div className="icon">{s.icon}</div>
      <div className="body">
        <div className="row spread" style={{ flexWrap: "nowrap" }}>
          <strong className="ellipsis">{s.titleZh}</strong>
          {allDone ? <span className="small-text good">✓ 完成</span> : custom ? <span className="tag">AI</span> : null}
        </div>
        <div className="small-text ellipsis">{s.title}</div>
        <div className="dots">
          <i className={done.listen ? "on" : ""} />
          <i className={done.shadow ? "on" : ""} />
          <i className={done.talk ? "on" : ""} />
          {avg !== null && <span className="small-text" style={{ marginLeft: 6 }}>跟读均分 {avg}</span>}
        </div>
      </div>
      {custom && (
        <button
          className="small ghost"
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
    { key: "work", label: "职场" },
    { key: "life", label: "生活" },
  ] as const;
  return (
    <main>
      <h1>场景</h1>
      <p className="muted" style={{ marginTop: 0 }}>每个场景三步：精听 → 跟读 → 和 AI 对话。</p>
      <Link href="/new" className="go solid">
        <div className="title">✨ 生成新场景</div>
        <div className="cta" style={{ marginTop: 2 }}>说说你最近遇到的情况，AI 帮你写成练习 →</div>
      </Link>
      {p.custom.length > 0 && (
        <section>
          <h2>我的场景</h2>
          {p.custom.map((s) => (
            <ScenarioCard key={s.id} p={p} s={s} custom />
          ))}
        </section>
      )}
      {groups.map((g) => (
        <section key={g.key}>
          <h2>{g.label}</h2>
          {scenarios
            .filter((s) => s.category === g.key)
            .map((s) => (
              <ScenarioCard key={s.id} p={p} s={s} />
            ))}
        </section>
      ))}
      <Nav on="scenes" />
    </main>
  );
}
