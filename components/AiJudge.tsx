"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { knownTags, recordPoints, useProgress, type JudgedPoint } from "@/lib/client/progress";

export type Verdict = "good" | "ok" | "off";

type Judge = {
  verdict: Verdict;
  summary_zh: string;
  right_zh: string;
  fixes: { you_said: string; better: string; why_zh: string }[];
  others: { ja: string; zh: string }[];
  points: JudgedPoint[];
};

const LABEL: Record<Verdict, { text: string; tone: string }> = {
  good: { text: "说得对", tone: "good" },
  ok: { text: "意思通了，可以更好", tone: "warn" },
  off: { text: "意思不太对", tone: "bad" },
};

// Answers already judged, so going back and forth on the same screen doesn't ask again.
const cache = new Map<string, Judge>();

// Asks the AI coach about one spoken answer and shows what was right, what to fix and other ways to say it.
export default function AiJudge({
  zh,
  ja,
  where,
  said,
  voice,
  onVerdict,
}: {
  zh: string;
  ja: string;
  where?: string;
  said: string;
  voice: string;
  onVerdict?: (v: Verdict) => void;
}) {
  const [data, setData] = useState<Judge | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cb = useRef(onVerdict);
  cb.current = onVerdict;
  const p = useProgress();
  const known = useRef<string[]>([]);
  known.current = knownTags(p);

  useEffect(() => {
    const key = JSON.stringify([zh, ja, said]);
    const hit = cache.get(key);
    if (hit) {
      setData(hit);
      setFailed(false);
      return;
    }
    const ctrl = new AbortController();
    setData(null);
    setFailed(false);
    fetch("/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zh, ja, where, said, known: known.current }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const j = (await res.json()) as Judge;
        j.points ??= [];
        cache.set(key, j);
        recordPoints(j.points, j.fixes);
        setData(j);
        cb.current?.(j.verdict);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setFailed(true);
      });
    return () => ctrl.abort();
  }, [zh, ja, where, said, attempt]);

  function hear(text: string) {
    unlock();
    play(ttsUrl(text, voice), 1).catch(() => {});
  }

  if (failed) {
    return (
      <div className="judge">
        <span className="muted">AI 点评没连上。</span>
        <button className="small" onClick={() => setAttempt((n) => n + 1)}>重试</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="judge">
        <span className="muted judge-wait">AI 正在看你说的…</span>
      </div>
    );
  }
  const l = LABEL[data.verdict];
  return (
    <div className={`judge judge-${l.tone}`}>
      <div className="judge-head">
        <strong className={l.tone}>{l.text}</strong>
        <span>{data.summary_zh}</span>
      </div>
      {data.right_zh && <p className="judge-right">👍 {data.right_zh}</p>}
      {data.fixes.map((f, i) => (
        <div key={i} className="judge-fix">
          <div>
            <s>{f.you_said}</s> → <b>{f.better}</b>
            <button className="small" onClick={() => hear(f.better)} aria-label="听">▶</button>
          </div>
          <div className="small-text">{f.why_zh}</div>
        </div>
      ))}
      {data.points.length > 0 && (
        <div className="judge-points">
          <span className="small-text">这句考的是</span>
          {data.points.map((pt) => (
            <span key={pt.tag} className={`chip ${pt.ok ? "chip-ok" : "chip-miss"}`} title={pt.zh}>
              {pt.ok ? "✓" : "✗"} {pt.tag}
            </span>
          ))}
          {data.points.some((pt) => !pt.ok) && (
            <Link href="/weak" className="small-text">已记进薄弱点 →</Link>
          )}
        </div>
      )}
      {data.others.length > 0 && (
        <div className="judge-others">
          <div className="small-text">还可以这样说</div>
          {data.others.map((o, i) => (
            <button key={i} className="judge-alt" onClick={() => hear(o.ja)}>
              <span>▶ {o.ja}</span>
              <span className="small-text">{o.zh}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
