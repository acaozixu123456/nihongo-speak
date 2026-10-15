"use client";

import { useEffect, useState } from "react";
import { onXp, type XpEvent } from "@/lib/client/progress";
import { chime, confetti } from "@/lib/client/fx";

// Floating "+N XP" pills, and a celebration the first time today's goal is met.
export default function Rewards() {
  const [pops, setPops] = useState<{ id: number; amount: number }[]>([]);
  const [goal, setGoal] = useState<XpEvent | null>(null);

  useEffect(
    () =>
      onXp((e) => {
        const id = Date.now() + Math.random();
        setPops((p) => [...p, { id, amount: e.amount }]);
        setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1400);
        if (e.goalReached) {
          chime(true);
          confetti(90);
          setGoal(e);
        } else {
          chime();
        }
      }),
    [],
  );

  return (
    <>
      <div className="pops" aria-live="polite">
        {pops.map((p) => (
          <div key={p.id} className="pop">+{p.amount} XP</div>
        ))}
      </div>
      {goal && (
        <div className="overlay" onClick={() => setGoal(null)}>
          <div className="modal">
            <div style={{ fontSize: 56 }}>🔥</div>
            <h2>今天的目标完成了！</h2>
            <p>已经连续练习 <strong>{goal.streak}</strong> 天</p>
            <p className="muted">明天也来保持连续记录吧。想多练也可以继续。</p>
            <button className="primary" onClick={() => setGoal(null)}>好的</button>
          </div>
        </div>
      )}
    </>
  );
}
