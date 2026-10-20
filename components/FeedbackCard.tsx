"use client";

import Link from "next/link";
import type { Feedback } from "@/lib/claude";
import { useEffect, useRef } from "react";
import { hasCard, recordNote, toggleCard, type Progress } from "@/lib/client/progress";

export function Star({ p, ja, zh, reading, voice, scenarioId }: { p: Progress; ja: string; zh: string; reading?: string; voice: string; scenarioId: string }) {
  const saved = hasCard(p, ja);
  return (
    <button
      className={`small star ${saved ? "on" : ""}`}
      aria-label={saved ? "取消收藏" : "收藏到复习"}
      onClick={() => toggleCard({ ja, zh, reading, voice, scenarioId })}
    >
      {saved ? "已收藏" : "收藏"}
    </button>
  );
}

// The end of a call or a scene. Its review (what went well, the one line to say better, one phrase to
// keep) goes to the 先生 page; here only a link to it.
export default function FeedbackCard({
  feedback,
  area,
  title,
  children,
}: {
  feedback: Feedback;
  area: "call" | "scene";
  title: string;
  children?: React.ReactNode;
}) {
  const saved = useRef<Feedback | null>(null);
  useEffect(() => {
    if (saved.current === feedback) return;
    saved.current = feedback;
    const { fix } = feedback;
    const phrase = feedback.phrases[0];
    recordNote({
      area,
      title,
      good: feedback.overall_zh,
      ...(fix.better && { fix: { said: fix.you_said, better: fix.better, zh: fix.why_zh || feedback.focus_zh } }),
      ...(phrase && { lines: [{ ja: phrase.ja, zh: phrase.zh }] }),
    });
  }, [feedback, area, title]);
  return (
    <div className="fb-done">
      <div className="fb-done-t">结束了，辛苦了</div>
      <Link href={`/me#${area}`} className="to-sensei">
        <span>
          <b>老师的点评</b>
          <small>{feedback.fix.better ? "1 处要改" : "这次没有要改的"}</small>
        </span>
        <i>›</i>
      </Link>
      {children && <div className="row">{children}</div>}
    </div>
  );
}
