"use client";

import { useEffect, useRef, useState } from "react";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { knownTags, recordPoints, useProgress, type JudgedPoint } from "@/lib/client/progress";

export type Verdict = "good" | "ok" | "off";

export type Judge = {
  verdict: Verdict;
  summary_zh: string;
  right_zh: string;
  fixes: { you_said: string; better: string; why_zh: string }[];
  others: { ja: string; zh: string }[];
  points: JudgedPoint[];
  fixed?: string; // a free answer (心で答える): what they said, put right
};

// Answers already judged, so going back and forth on the same screen doesn't ask again.
const cache = new Map<string, Judge>();

// Asks the AI coach about one spoken answer. Nothing is shown by itself: the page turns the verdict into its
// 判定, and the details wait behind なぜ？ (JudgeWhy). Weak points are recorded either way.
// q: the learner answers this question in their own words (心で答える) instead of saying the zh; form is
// the 型 practised with it.
export function useJudge(args: { zh: string; ja: string; where?: string; said: string; q?: string; form?: string } | null) {
  const [data, setData] = useState<Judge | null>(null);
  const [failed, setFailed] = useState(false);
  const p = useProgress();
  const known = useRef<string[]>([]);
  known.current = knownTags(p);
  const key = args ? JSON.stringify([args.zh, args.ja, args.said]) : null;

  useEffect(() => {
    setData(null);
    setFailed(false);
    if (!args || !key) return;
    const hit = cache.get(key);
    if (hit) return setData(hit);
    const ctrl = new AbortController();
    // A judge that never answers mustn't hold the verdict forever.
    const slow = setTimeout(() => ctrl.abort("slow"), 15000);
    fetch("/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...args, known: known.current }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        const j = body as Judge;
        j.points ??= [];
        j.fixes ??= [];
        j.others ??= [];
        cache.set(key, j);
        recordPoints(j.points, j.fixes);
        setData(j);
      })
      .catch(() => {
        if (ctrl.signal.reason === "slow" || !ctrl.signal.aborted) setFailed(true);
      })
      .finally(() => clearTimeout(slow));
    return () => {
      clearTimeout(slow);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, failed };
}

// The なぜ？ sheet: Japanese large, the Chinese reason small and grey.
export function JudgeWhy({ data, voice }: { data: Judge; voice: string }) {
  const hear = (text: string) => {
    unlock();
    play(ttsUrl(text, voice), 1).catch(() => {});
  };
  return (
    <>
      <div className="why-h">なぜ？</div>
      {data.fixes.length === 0 && <p className="why-zh">{data.summary_zh}</p>}
      {data.fixes.map((f, i) => (
        <button key={i} className="why-fix" onClick={() => hear(f.better)}>
          <span className="why-ja">{f.better}</span>
          <span className="why-zh">{f.why_zh}</span>
        </button>
      ))}
      {data.others.length > 0 && (
        <>
          <div className="why-h">ほかの言い方</div>
          {data.others.map((o, i) => (
            <button key={i} className="why-alt" onClick={() => hear(o.ja)}>
              <span>▶ {o.ja}</span>
              <span className="why-zh">{o.zh}</span>
            </button>
          ))}
        </>
      )}
    </>
  );
}
