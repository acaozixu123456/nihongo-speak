"use client";

import Link from "next/link";
import type { Feedback } from "@/lib/claude";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { hasCard, toggleCard, useProgress, type Progress } from "@/lib/client/progress";
import { SenseiLine } from "./Sensei";

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

// The end-of-conversation review, from 森先生: one thing to fix next time, the line that shows it, and one
// phrase to keep.
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
      <SenseiLine
        ja={fix.better ? "おつかれさま。次はここだけね。" : "おつかれさま。よく話せましたね。"}
        zh={feedback.overall_zh}
        nod={!fix.better}
      />
      {fix.better ? (
        <div className="memo-blk m-bad fb-blk">
          <div className="memo-hd">
            <span className="memo-mk">!</span>ここを直そう
          </div>
          {fix.you_said && (
            <div className="memo-ln m-wrong">
              <span className="memo-t">言った</span>
              <s>{fix.you_said}</s>
            </div>
          )}
          <div className="memo-ln m-right">
            <span className="memo-t">正しく</span>
            <span>{fix.better}</span>
            <button className="bag-play memo-play" aria-label="聞く" onClick={() => say(fix.better)}>
              ▶
            </button>
          </div>
          <div className="memo-zh">{fix.why_zh || feedback.focus_zh}</div>
          {fix.zh && (
            <div className="row">
              <Star {...card} ja={fix.better} zh={fix.zh} />
            </div>
          )}
        </div>
      ) : (
        feedback.focus_zh && <p className="muted">{feedback.focus_zh}</p>
      )}
      {point.tag && (
        <Link href="/weak" className="fb-weak">
          苦手に入れました：{point.tag} ›
        </Link>
      )}
      {phrase && (
        <div className="fb-keep">
          <span className="kicker">覚えよう</span>
          <div className="ja">{phrase.ja}</div>
          <div className="kana">{phrase.reading}</div>
          <div className="zh">{phrase.zh}</div>
          <div className="row">
            <button className="small" onClick={() => say(phrase.ja)}>▶ 聞く</button>
            <Star {...card} ja={phrase.ja} zh={phrase.zh} reading={phrase.reading} />
          </div>
        </div>
      )}
      {children && <div className="row">{children}</div>}
    </div>
  );
}
