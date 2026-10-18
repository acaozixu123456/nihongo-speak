"use client";

import { useEffect, useState } from "react";
import type { Scenario } from "@/content/scenarios";
import type { TurnCheck, Turn } from "@/lib/claude";
import { useCoach } from "@/lib/client/coach";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { knownTags, recordPoints, useProgress } from "@/lib/client/progress";

// Lines whose grammar points were already counted, so a re-render doesn't count them twice.
const recorded = new Set<string>();

// A small note under each thing the learner says in a conversation: fine as is, or a more natural way to say it.
export default function TurnNote({
  scenarioId,
  talk,
  history,
  voice,
}: {
  scenarioId: string;
  talk: Scenario["talk"];
  history: Turn[];
  voice: string;
}) {
  const p = useProgress();
  // Fixed when the line is said, so later progress changes don't ask again.
  const [known] = useState(() => knownTags(p));
  const body = { kind: "turn", scenarioId, talk, history, known };
  const { data, error, retry } = useCoach<TurnCheck>(body);

  useEffect(() => {
    if (!data) return;
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
  if (!data) return <div className="turn-note muted judge-wait">点评中…</div>;
  if (data.verdict === "good") return <div className="turn-note good">✓ {data.why_zh}</div>;
  return (
    <div className={`turn-note ${data.verdict === "off" ? "bad" : "warn"}`}>
      <div>
        → <b>{data.better}</b>{" "}
        <button
          className="small"
          aria-label="听"
          onClick={() => {
            unlock();
            play(ttsUrl(data.better, voice), 1).catch(() => {});
          }}
        >
          ▶
        </button>
      </div>
      <div className="small-text">{data.why_zh}</div>
    </div>
  );
}
