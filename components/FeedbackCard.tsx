"use client";

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

// The end-of-conversation review: overall comment, lines to say better, phrases worth keeping.
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
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>点评</h2>
      <p>{feedback.overall_zh}</p>
      {feedback.corrections.length > 0 && <h2>可以说得更好</h2>}
      {feedback.corrections.map((c, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          <div className="muted">你说：{c.you_said}</div>
          <div className="ja">→ {c.better}</div>
          <div className="zh">{c.why_zh}</div>
          <div className="row">
            <button className="small" onClick={() => say(c.better)}>听一下</button>
            <Star {...card} ja={c.better} zh={`换个更自然的说法：${c.you_said}`} />
          </div>
        </div>
      ))}
      <h2>值得记住的表达</h2>
      {feedback.phrases.map((x, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <div className="ja">{x.ja}</div>
          <div className="kana">{x.reading}</div>
          <div className="zh">{x.zh}</div>
          <div className="row">
            <button className="small" onClick={() => say(x.ja)}>听一下</button>
            <Star {...card} ja={x.ja} zh={x.zh} reading={x.reading} />
          </div>
        </div>
      ))}
      <p className="muted">收藏的句子会进入复习，隔几天提醒你说一遍。</p>
      {children && <div className="row">{children}</div>}
    </div>
  );
}
