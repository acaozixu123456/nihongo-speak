"use client";

import Link from "next/link";
import { useState } from "react";
import { removeCustom, stepsDone, useProgress, type Step } from "@/lib/client/progress";
import { buildingScenarios, npc, stars, type BuildingId } from "@/lib/client/game";

const STEPS: { key: Step; label: string }[] = [
  { key: "listen", label: "听" },
  { key: "shadow", label: "跟读" },
  { key: "talk", label: "对话" },
];

// One group of scenarios. Tapping a row opens its three steps; the first unfinished one is open to start with.
export function Floors({ id }: { id: BuildingId }) {
  const p = useProgress();
  const list = buildingScenarios(p, id);
  const firstOpen = list.findIndex((s) => stars(p, s) < 3);
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked ?? (firstOpen >= 0 ? firstOpen : 0);

  if (list.length === 0) {
    return <p className="muted">还没有自己的场景。点上面的「重来一次」，AI 会把你遇到的情况写成场景放在这里。</p>;
  }

  return (
    <div className="list">
      {list.map((s, i) => {
        const n = stars(p, s);
        const done = stepsDone(p, s);
        const nowStep = STEPS.find((x) => !done[x.key])?.key;
        return (
          <div key={s.id} className={`scene ${i === sel ? "open" : ""}`}>
            <button className="scene-row" onClick={() => setPicked(i)}>
              <span className="scene-no">{String(i + 1).padStart(2, "0")}</span>
              <span className="row-text">
                {s.titleZh}
                <small>
                  {npc(s).name} · {s.level}
                </small>
              </span>
              <span className={`dots d${n}`} aria-label={`完成 ${n}/3`}>
                <i />
                <i />
                <i />
              </span>
            </button>
            {i === sel && (
              <div className="scene-steps">
                <div className="steps">
                  {STEPS.map((x) => (
                    <Link key={x.key} href={`/s/${s.id}?step=${x.key}`} className={done[x.key] ? "ok" : x.key === nowStep ? "now" : ""}>
                      {x.label}
                      {done[x.key] && " ✓"}
                    </Link>
                  ))}
                </div>
                {id === "custom" && (
                  <button
                    className="small ghost"
                    onClick={() => {
                      if (confirm(`删除「${s.titleZh}」？`)) {
                        removeCustom(s.id);
                        setPicked(null);
                      }
                    }}
                  >
                    删除这个场景
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
