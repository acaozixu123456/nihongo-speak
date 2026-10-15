"use client";

import Link from "next/link";
import { useState } from "react";
import type { Scenario } from "@/content/scenarios";
import { stop } from "@/lib/client/player";
import { findScenario, stepsDone, useProgress, type Step } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import Listen from "./Listen";
import Shadow from "./Shadow";
import Talk from "./Talk";

const TABS = [
  { key: "listen", kanji: "聴", label: "精听" },
  { key: "shadow", kanji: "読", label: "跟读" },
  { key: "talk", kanji: "話", label: "对话" },
] as const;

export default function ScenarioView({ scenario, step }: { scenario: Scenario; step?: Step }) {
  const [tab, setTab] = useState<Step>(step ?? "listen");
  const done = stepsDone(useProgress(), scenario);

  function go(next: Step) {
    stop();
    setTab(next);
    window.scrollTo({ top: 0 });
  }

  return (
    <main>
      <Link href="/scenes" className="muted">← 场景</Link>
      <header className="scene-head">
        <div className="scene-icon">{scenario.icon}</div>
        <div>
          <h1>{scenario.titleZh}</h1>
          <div className="scene-ja">{scenario.title}</div>
        </div>
      </header>
      <div className="tabs steps">
        {TABS.map((t, i) => (
          <button key={t.key} className={`${tab === t.key ? "on" : ""} ${done[t.key] ? "did" : ""}`} onClick={() => go(t.key)}>
            <span className="step-k">{t.kanji}</span>
            <span className="step-l">
              {i + 1} · {t.label}
              {done[t.key] && <span className="check"> ✓</span>}
            </span>
          </button>
        ))}
      </div>
      {/* Keep every tab mounted so switching back doesn't lose progress. */}
      <div hidden={tab !== "listen"}><Listen scenario={scenario} onNext={() => go("shadow")} /></div>
      <div hidden={tab !== "shadow"}>
        <Shadow scenario={scenario} active={tab === "shadow"} onNext={() => go("talk")} />
      </div>
      <div hidden={tab !== "talk"}><Talk scenario={scenario} active={tab === "talk"} /></div>
    </main>
  );
}

export function CustomScenarioView({ id, step }: { id: string; step?: Step }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const scenario = findScenario(p, id);
  if (scenario) return <ScenarioView scenario={scenario} step={step} />;
  return (
    <main>
      <Link href="/scenes" className="muted">← 场景</Link>
      <p className="muted">{hydrated ? "找不到这个场景，可能已经删除了。" : "加载中…"}</p>
    </main>
  );
}
