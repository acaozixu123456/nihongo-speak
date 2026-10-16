"use client";

import type { ShadowCoach as Coach } from "@/lib/claude";
import type { SttResult } from "@/lib/client/recorder";
import { useCoach } from "@/lib/client/coach";

// One concrete thing to fix on the next try, read from the pronunciation scores by the AI coach.
export default function ShadowCoach({ ja, kana, result }: { ja: string; kana?: string; result: SttResult }) {
  const { data, error, retry } = useCoach<Coach>({ kind: "shadow", ja, kana, said: result.text, scores: result.scores });

  if (error) {
    return (
      <div className="judge">
        <span className="muted">AI 教练没连上（{error}）。</span>
        <button className="small" onClick={retry}>重试</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="judge">
        <span className="muted judge-wait">AI 教练在听…</span>
      </div>
    );
  }
  return (
    <div className="judge">
      {data.score_doubt && <p className="judge-right">🤔 {data.doubt_zh}</p>}
      <div className="judge-head">
        <strong className="y">教练</strong>
        <span>{data.tip_zh}</span>
      </div>
      {data.words.map((w, i) => (
        <div key={i} className="judge-fix">
          <div>
            <b>{w.word}</b> <span className="small-text">{w.kana}</span>
          </div>
          <div className="small-text">{w.why_zh}</div>
        </div>
      ))}
    </div>
  );
}
