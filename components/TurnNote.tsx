"use client";

import { useEffect, useState } from "react";
import type { Scenario } from "@/content/scenarios";
import type { TurnCheck, Turn } from "@/lib/claude";
import { useCoach } from "@/lib/client/coach";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { knownTags, recordPoints, useProgress } from "@/lib/client/progress";

// Lines whose grammar points were already counted, so a re-render doesn't count them twice.
const recorded = new Set<string>();

// A mark under each thing the learner says in a conversation: a green ✓ when it was fine as said, or
// the more natural line (the why only on a tap), so the talk isn't stopped by a paragraph to read.
// onResult hands the check up: the lines to say again come back when the talk is over.
export default function TurnNote({
  scenarioId,
  talk,
  history,
  voice,
  onResult,
}: {
  scenarioId: string;
  talk: Scenario["talk"];
  history: Turn[];
  voice: string;
  onResult?: (check: TurnCheck) => void;
}) {
  const p = useProgress();
  // Fixed when the line is said, so later progress changes don't ask again.
  const [known] = useState(() => knownTags(p));
  const [why, setWhy] = useState(false);
  const body = { kind: "turn", scenarioId, talk, history, known };
  const { data, error, retry } = useCoach<TurnCheck>(body);

  useEffect(() => {
    if (!data) return;
    onResult?.(data);
    const key = JSON.stringify([scenarioId, history]);
    if (recorded.has(key)) return;
    recorded.add(key);
    const said = history[history.length - 1]?.text ?? "";
    recordPoints(data.points, data.better ? [{ you_said: said, better: data.better }] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (error) {
    return (
      <div className="turn-note muted">
        点评没连上 <button className="small" onClick={retry}>重试</button>
      </div>
    );
  }
  if (!data) return <div className="turn-note wait" aria-label="点评中"><i /><i /><i /></div>;
  if (data.verdict === "good" || !data.better) return <div className="turn-note good"><span className="tn-ok" aria-label="说得对">✓</span></div>;
  return (
    <div className={`turn-note ${data.verdict === "off" ? "bad" : "warn"}`}>
      <div className="tn-better">
        <button
          className="tn-line"
          aria-label="听这句"
          onClick={() => {
            unlock();
            play(ttsUrl(data.better, voice), 1).catch(() => {});
          }}
        >
          <i aria-hidden>→</i>
          <b>{data.better}</b>
        </button>
        <button className="tn-why" aria-label="为什么" aria-expanded={why} onClick={() => setWhy(!why)}>?</button>
      </div>
      {why && <div className="small-text">{data.why_zh}</div>}
    </div>
  );
}
