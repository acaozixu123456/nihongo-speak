"use client";

import Link from "next/link";
import { useState } from "react";
import type { BuildingId } from "@/lib/client/game";
import { Floors } from "./Floors";

const TABS: BuildingId[] = ["work", "life", "custom"];
const TAB_LABEL: Record<BuildingId, string> = { work: "工作", life: "生活", custom: "我的" };

// Every scenario in one place: work, daily life, and the ones the AI wrote from the learner's own day.
export default function Scenes({ tab: initial }: { tab?: BuildingId }) {
  const [tab, setTab] = useState<BuildingId>(initial ?? "work");

  return (
    <main>
      <Link href="/speak" className="back">← 说</Link>
      <header className="page-mast">
        <div>
          <h1>场景对话</h1>
        </div>
      </header>

      <Link href="/new" className="redo">
        <span className="redo-t">重来一次</span>
        <span className="redo-d">今天哪句话没说出来？</span>
        <span className="redo-go">开始 ›</span>
      </Link>

      <div className="seg">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <Floors key={tab} id={tab} />
    </main>
  );
}
