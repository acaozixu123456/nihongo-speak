"use client";

import Link from "next/link";
import { useState } from "react";
import type { Scenario } from "@/content/scenarios";
import { stop } from "@/lib/client/player";
import { stepsDone, useProgress, type Step } from "@/lib/client/progress";
import Listen from "./Listen";
import Shadow from "./Shadow";
import Talk from "./Talk";

const TABS = [
  { key: "listen", label: "① 精听" },
  { key: "shadow", label: "② 跟读" },
  { key: "talk", label: "③ 对话" },
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
      <Link href="/" className="muted">← 今天</Link>
      <h1>
        {scenario.icon} {scenario.titleZh}
      </h1>
      <div className="muted">{scenario.title}</div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => go(t.key)}>
            {t.label} {done[t.key] && <span className="check">✓</span>}
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
