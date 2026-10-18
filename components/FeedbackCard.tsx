"use client";

import Link from "next/link";
import type { Feedback } from "@/lib/claude";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { hasCard, toggleCard, useProgress, type Progress } from "@/lib/client/progress";

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

// The end-of-conversation review: one thing to fix next time, the line that shows it, and one phrase to keep.
export default function FeedbackCard({
  feedback,
  voice,
  scenarioId,
  children,
}: {
  feedback: Feedback;
  voice: string;
  scenarioId: string;
  children?: React.ReactNode;
}) {
  const p = useProgress();
  const card = { p, voice, scenarioId };
  const say = (text: string) => {
    unlock();
    play(ttsUrl(text, voice), 1).catch(() => {});
  };
  const { fix, point } = feedback;
  const phrase = feedback.phrases[0];
  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>{feedback.overall_zh}</p>
      <span className="kicker">下次只改这一件事</span>
      <p className="focus-one">{feedback.focus_zh}</p>
      {fix.better && (
        <div style={{ marginBottom: 12 }}>
          {fix.you_said && <div className="muted">你说：{fix.you_said}</div>}
          <div className="ja">→ {fix.better}</div>
          <div className="zh">{fix.why_zh}</div>
          <div className="row">
            <button className="small" onClick={() => say(fix.better)}>听一下</button>
            {fix.zh && <Star {...card} ja={fix.better} zh={fix.zh} />}
          </div>
        </div>
      )}
      {point.tag && (
        <p className="small-text">
          已记进薄弱点「{point.tag}」，明天的练一练会出题。<Link href="/weak">看看 →</Link>
        </p>
      )}
      {phrase && (
        <>
          <span className="kicker">记住这一句</span>
          <div style={{ marginBottom: 10 }}>
            <div className="ja">{phrase.ja}</div>
            <div className="kana">{phrase.reading}</div>
            <div className="zh">{phrase.zh}</div>
            <div className="row">
              <button className="small" onClick={() => say(phrase.ja)}>听一下</button>
              <Star {...card} ja={phrase.ja} zh={phrase.zh} reading={phrase.reading} />
            </div>
          </div>
        </>
      )}
      {children && <div className="row">{children}</div>}
    </div>
  );
}
