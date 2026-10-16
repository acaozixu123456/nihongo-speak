"use client";

import Link from "next/link";
import { useState } from "react";
import { useProgress } from "@/lib/client/progress";
import { BUILDINGS, buildingStars, type BuildingId } from "@/lib/client/game";
import { Floors } from "./Floors";
import Nav from "./Nav";

const TABS: BuildingId[] = ["work", "life", "custom"];
const TAB_LABEL: Record<BuildingId, string> = { work: "🏢 工作", life: "🏘️ 生活", custom: "📸 我的" };

// Every scenario in one place: work, daily life, and the ones the AI wrote from the learner's own day.
export default function Scenes({ tab: initial }: { tab?: BuildingId }) {
  const p = useProgress();
  const [tab, setTab] = useState<BuildingId>(initial ?? "work");
  const st = buildingStars(p, tab);

  return (
    <main>
      <header className="page-mast">
        <span className="icon" aria-hidden>🏢</span>
        <div>
          <h1>場面</h1>
          <p className="muted">每个场景：偷听 → 模仿说话 → 对话</p>
        </div>
      </header>

      <Link href="/new" className="win redo">
        <span className="redo-i" aria-hidden>📸</span>
        <span>
          <b className="y">重来一次</b>
          <span className="small-text" style={{ display: "block" }}>
            今天哪句话没说出来？说一句发生了什么，或者拍张照片，AI 把它变成场景让你重新练。
          </span>
        </span>
      </Link>

      <div className="seg" style={{ margin: "12px 3px" }}>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <p className="small-text" style={{ margin: "0 3px 8px" }}>
        {BUILDINGS[tab].sub} · ★{st.got}/{st.of}
      </p>
      <Floors key={tab} id={tab} />
      <Nav on="scenes" />
    </main>
  );
}
