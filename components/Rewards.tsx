"use client";

import { useEffect, useState } from "react";
import { dayKey, onXp, useProgress, type XpEvent } from "@/lib/client/progress";
import { formatDuration, totals } from "@/lib/client/metrics";
import { chime, confetti } from "@/lib/client/fx";
import { STATION_LEVEL, jobTitle } from "@/lib/client/game";

type Celebration = { kind: "goal" | "level" | "quests" | "freeze"; event: XpEvent };

// Floating "+N XP" pills, and a celebration for goals, level-ups and full quest days.
export default function Rewards() {
  const [pops, setPops] = useState<{ id: number; amount: number }[]>([]);
  const [queue, setQueue] = useState<Celebration[]>([]);
  const p = useProgress();

  useEffect(
    () =>
      onXp((e) => {
        const id = Date.now() + Math.random();
        setPops((x) => [...x, { id, amount: e.amount }]);
        setTimeout(() => setPops((x) => x.filter((y) => y.id !== id)), 1400);
        const found: Celebration[] = [];
        if (e.goalReached) found.push({ kind: "goal", event: e });
        if (e.questsDone) found.push({ kind: "quests", event: e });
        if (e.levelUp) found.push({ kind: "level", event: e });
        if (e.freezeEarned) found.push({ kind: "freeze", event: e });
        if (found.length) {
          chime(true);
          confetti(90);
          setQueue((q) => [...q, ...found]);
        } else {
          chime();
        }
      }),
    [],
  );

  const current = queue[0];
  const lvUp = current?.event.levelUp ?? 1;
  const close = () => setQueue((q) => q.slice(1));
  const today = dayKey();
  const t = totals(p, today, today);

  return (
    <>
      <div className="pops" aria-live="polite">
        {pops.map((x) => (
          <div key={x.id} className="pop">+{x.amount} XP</div>
        ))}
      </div>
      {current && (
        <div className={`overlay ${current.kind === "level" ? "levelup" : ""}`} onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {current.kind === "goal" && (
              <>
                <div style={{ fontSize: 56 }}>🔥</div>
                <h2>今天的目标完成了！</h2>
                <p style={{ margin: 0 }}>
                  已经连续练习 <strong>{current.event.streak}</strong> 天
                </p>
                <div className="kpis">
                  <div className="kpi">
                    <b style={{ fontSize: 18 }}>{formatDuration(t.speakSec)}</b>
                    <span>开口</span>
                  </div>
                  <div className="kpi">
                    <b style={{ fontSize: 18 }}>{t.said}</b>
                    <span>句</span>
                  </div>
                  <div className="kpi">
                    <b style={{ fontSize: 18 }}>{t.pron ?? "–"}</b>
                    <span>发音均分</span>
                  </div>
                </div>
                <p className="muted">明天也来保持连续记录吧。想多练也可以继续。</p>
              </>
            )}
            {current.kind === "quests" && (
              <>
                <div style={{ fontSize: 56 }}>🎁</div>
                <h2>今日任务全部完成</h2>
                <p className="muted">场景、日记、复习都做了，额外奖励 +10 XP。</p>
              </>
            )}
            {current.kind === "level" && (
              <>
                <div className="big">LEVEL UP!</div>
                <div className="portrait">🧑‍💼</div>
                <div className="rank">
                  Lv.{lvUp - 1} {jobTitle(lvUp - 1)} → <span className="y">Lv.{lvUp} {jobTitle(lvUp)}</span>
                </div>
                <div className="loot win">
                  <div className="y">▼ 获得奖励</div>
                  <div>
                    <span>🎖️ 新职位</span>
                    <span>{jobTitle(lvUp)}</span>
                  </div>
                  {lvUp === STATION_LEVEL && (
                    <div>
                      <span>🚉 新地点解锁</span>
                      <span>駅（问路·坐车）</span>
                    </div>
                  )}
                  <div>
                    <span>📈 今天开口</span>
                    <span>{formatDuration(t.speakSec)} · {t.said} 句</span>
                  </div>
                </div>
                <p className="muted">每一级都是实实在在开口练出来的。</p>
              </>
            )}
            {current.kind === "freeze" && (
              <>
                <div style={{ fontSize: 56 }}>🛡️</div>
                <h2>获得一张保护卡</h2>
                <p className="muted">连续 7 天的奖励。哪天实在没空练，它会自动帮你保住连续记录（最多存 2 张）。</p>
              </>
            )}
            <button className="primary" onClick={close}>
              ▶ 继续冒险
            </button>
          </div>
        </div>
      )}
    </>
  );
}
