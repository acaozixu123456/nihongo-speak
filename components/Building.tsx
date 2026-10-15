"use client";

import Link from "next/link";
import { useState } from "react";
import { removeCustom, stepsDone, useProgress, type Step } from "@/lib/client/progress";
import { BUILDINGS, buildingScenarios, npc, stars, starText, type BuildingId } from "@/lib/client/game";
import Nav from "./Nav";

const STEPS: { key: Step; icon: string; label: string }[] = [
  { key: "listen", icon: "👂", label: "偷听" },
  { key: "shadow", icon: "🦜", label: "模仿说话" },
  { key: "talk", icon: "💬", label: "对话" },
];

const FLOOR = (b: BuildingId, i: number) => (b === "work" ? `${i + 1}F` : b === "life" ? `${i + 1}番` : `#${i + 1}`);
const PROPS: Record<BuildingId, string[]> = {
  work: ["🖥️", "🗂️", "☕"],
  life: ["🏥", "🚿", "🌸"],
  custom: ["🍙", "🧃", "📦"],
};

// Inside one building: each floor (or shop) is a scenario with three stars to earn.
export default function Building({ id }: { id: BuildingId }) {
  const p = useProgress();
  const info = BUILDINGS[id];
  const list = buildingScenarios(p, id);
  const firstOpen = list.findIndex((s) => stars(p, s) < 3);
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked ?? (firstOpen >= 0 ? firstOpen : 0);
  const current = list[sel];
  const who = current ? npc(current) : null;
  // The top floor of the company is the boss: open once every floor below has been visited.
  const bossLocked = (i: number) => id === "work" && i === list.length - 1 && list.slice(0, -1).some((s) => stars(p, s) === 0);

  return (
    <main>
      <Link href="/" className="back">← 小镇</Link>
      <header className="page-mast">
        <span className="icon" aria-hidden>{info.icon}</span>
        <div>
          <h1>{info.ja}</h1>
          <p className="muted">{info.sub}</p>
        </div>
      </header>

      <div className={`scene-art ${id}`}>
        <div className="floor" />
        <span className="s" style={{ left: 16 }}>{PROPS[id][0]}</span>
        <span className="s" style={{ left: 70, fontSize: 30 }}>{PROPS[id][1]}</span>
        {who && <span className="s" style={{ left: 22, bottom: 52 }}>{who.sprite}</span>}
        <span className="s" style={{ right: 60, fontSize: 36 }}>🧑‍💼</span>
        <span className="s" style={{ right: 16, fontSize: 28 }}>{PROPS[id][2]}</span>
        {who && <span className="speech">{who.name}：{who.line}</span>}
      </div>

      <div className="win floors">
        <div className="y">▶ {id === "work" ? "选择楼层" : id === "life" ? "选择要去的地方" : "货架上的场景"}</div>
        {list.length === 0 && <p className="muted">货架还是空的。告诉 AI 你想练什么场合，它会写一个新场景放上来。</p>}
        {list.map((s, i) => {
          const n = stars(p, s);
          const lock = bossLocked(i);
          const done = stepsDone(p, s);
          const nowStep = STEPS.find((x) => !done[x.key])?.key;
          return (
            <div key={s.id}>
              <button className={`fl ${i === sel ? "sel" : ""} ${lock ? "lock" : ""}`} onClick={() => setPicked(i)}>
                <span className="no">{FLOOR(id, i)}</span>
                <span className="t">
                  {s.icon} {s.titleZh}
                  <small>{lock ? `🔒 先去过 1F–${list.length - 1}F` : `${npc(s).name} · ${s.level}`}</small>
                </span>
                <span className="st">{lock ? "BOSS" : starText(n)}</span>
              </button>
              {i === sel && !lock && (
                <>
                  <div className="steps">
                    {STEPS.map((x) => (
                      <Link key={x.key} href={`/s/${s.id}?step=${x.key}`} className={done[x.key] ? "ok" : x.key === nowStep ? "now" : ""}>
                        <b>{x.icon}</b>
                        {x.label}
                        {done[x.key] && " ✓"}
                      </Link>
                    ))}
                  </div>
                  {id === "custom" && (
                    <button
                      className="small ghost"
                      style={{ marginBottom: 8 }}
                      onClick={() => {
                        if (confirm(`下架「${s.titleZh}」？`)) {
                          removeCustom(s.id);
                          setPicked(null);
                        }
                      }}
                    >
                      ✕ 下架这个场景
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {id === "custom" && (
        <Link href="/new" className="btn primary next-cta" style={{ display: "block" }}>
          ＋ 进新货：让 AI 写新场景
        </Link>
      )}
      <Nav on="town" />
    </main>
  );
}
