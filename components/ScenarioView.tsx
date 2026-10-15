"use client";

import Link from "next/link";
import { useState } from "react";
import type { Scenario } from "@/content/scenarios";
import { stop } from "@/lib/client/player";
import Listen from "./Listen";
import Shadow from "./Shadow";
import Talk from "./Talk";

const TABS = [
  { key: "listen", label: "① 精听" },
  { key: "shadow", label: "② 跟读" },
  { key: "talk", label: "③ 对话" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default function ScenarioView({ scenario }: { scenario: Scenario }) {
  const [tab, setTab] = useState<Tab>("listen");
  return (
    <main>
      <Link href="/" className="muted">← 场景列表</Link>
      <h1>{scenario.title}</h1>
      <div className="muted">{scenario.titleZh}</div>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "on" : ""}
            onClick={() => {
              stop();
              setTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Keep every tab mounted so switching back doesn't lose progress. */}
      <div hidden={tab !== "listen"}><Listen scenario={scenario} /></div>
      <div hidden={tab !== "shadow"}><Shadow scenario={scenario} active={tab === "shadow"} /></div>
      <div hidden={tab !== "talk"}><Talk scenario={scenario} active={tab === "talk"} /></div>
    </main>
  );
}
