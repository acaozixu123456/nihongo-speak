"use client";

import Link from "next/link";
import { useState } from "react";
import type { Scenario } from "@/content/scenarios";
import { stop } from "@/lib/client/player";
import { findScenario, stepsDone, useProgress, type Step } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { BUILDINGS, buildingOf, buildingScenarios, npc, stars, starText } from "@/lib/client/game";
import Listen from "./Listen";
import Shadow from "./Shadow";
import Talk from "./Talk";

const TABS = [
  { key: "listen", icon: "👂", label: "偷听" },
  { key: "shadow", icon: "🦜", label: "模仿说话" },
  { key: "talk", icon: "💬", label: "对话" },
] as const;

export default function ScenarioView({ scenario, step }: { scenario: Scenario; step?: Step }) {
  const [tab, setTab] = useState<Step>(step ?? "listen");
  const p = useProgress();
  const done = stepsDone(p, scenario);
  const b = buildingOf(scenario, p);
  const floor = buildingScenarios(p, b).findIndex((s) => s.id === scenario.id) + 1;
  const where = b === "work" ? `${floor}F` : b === "life" ? `${floor}番` : `#${floor}`;

  function go(next: Step) {
    stop();
    setTab(next);
    window.scrollTo({ top: 0 });
  }

  return (
    <main>
      <Link href={`/b/${b}`} className="back">← {BUILDINGS[b].name}</Link>
      <header className="scene-head">
        <div className="scene-icon">{scenario.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="scene-where">
            {BUILDINGS[b].icon} {BUILDINGS[b].name} {where} · {npc(scenario).name} <span className="y">{starText(stars(p, scenario))}</span>
          </div>
          <h1>{scenario.titleZh}</h1>
          <div className="scene-ja">{scenario.title}</div>
        </div>
      </header>
      <div className="tabs steps">
        {TABS.map((t) => (
          <button key={t.key} className={`${tab === t.key ? "on" : ""} ${done[t.key] ? "did" : ""}`} onClick={() => go(t.key)}>
            <b>{t.icon}</b>
            {t.label}
            {done[t.key] && " ✓"}
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
      <Link href="/" className="back">← 小镇</Link>
      <p className="muted">{hydrated ? "找不到这个场景，可能已经删除了。" : "加载中…"}</p>
    </main>
  );
}
