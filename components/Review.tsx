"use client";

import Link from "next/link";
import { useState } from "react";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { transcribe } from "@/lib/client/recorder";
import { dueCards, findScenario, recordSpeech, reviewCard, useProgress, wavSeconds, type Card } from "@/lib/client/progress";
import HoldButton from "./HoldButton";
import Nav from "./Nav";

function tone(score: number) {
  return score >= 80 ? "good" : score >= 60 ? "warn" : "bad";
}

export default function Review() {
  const p = useProgress();
  // Fix today's queue when the page opens so cards don't vanish mid-review.
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [heard, setHeard] = useState<{ text: string; score?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [again, setAgain] = useState(0);

  const due = dueCards(p);
  const list = queue ?? due;
  const card = list[index];

  function begin() {
    unlock();
    setQueue(due);
    setIndex(0);
  }

  function listen(c: Card) {
    unlock();
    play(ttsUrl(c.ja, c.voice), 1).catch(() => setError("音频播放失败"));
  }

  async function onRecorded(wav: Blob) {
    if (!card) return;
    setBusy(true);
    setError("");
    try {
      const r = await transcribe(wav, card.ja);
      if (!r.text) {
        setError("没听清，再说一次试试");
        return;
      }
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      setHeard({ text: r.text, score: r.scores?.pron });
      setRevealed(true);
      listen(card);
    } catch (e) {
      setError(e instanceof Error ? e.message : "评分失败");
    } finally {
      setBusy(false);
    }
  }

  function answer(remembered: boolean) {
    if (!card) return;
    reviewCard(card.id, remembered);
    if (!remembered) {
      setAgain((n) => n + 1);
      // Missed cards come back at the end of today's queue.
      setQueue([...list, card]);
    }
    setIndex((i) => i + 1);
    setRevealed(false);
    setHeard(null);
    setError("");
  }

  if (p.cards.length === 0) {
    return (
      <main>
        <h1>复习</h1>
        <div className="card">
          <p style={{ marginTop: 0 }}>还没有收藏的句子。</p>
          <p className="muted">
            跟读时点 ☆，或者对话点评里点「☆ 收藏」，句子就会来到这里。之后按 1、3、7、14 天的间隔提醒你开口说一遍。
          </p>
          <Link href="/">去练习 →</Link>
        </div>
        <Nav on="review" />
      </main>
    );
  }

  if (!queue) {
    return (
      <main>
        <h1>复习</h1>
        <div className="card flash">
          {due.length > 0 ? (
            <>
              <div className="score-big">{due.length}</div>
              <p>句今天该复习了</p>
              <p className="muted">看中文，用日语说出来，再对照答案。</p>
              <button className="primary next-cta" onClick={begin}>开始</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 48 }}>✅</div>
              <p>今天没有要复习的了</p>
              <p className="muted">已收藏 {p.cards.length} 句，到期的会自动出现。</p>
              <Link href="/">回到今天 →</Link>
            </>
          )}
        </div>
        <Nav on="review" />
      </main>
    );
  }

  if (!card) {
    return (
      <main>
        <h1>复习</h1>
        <div className="card flash">
          <div style={{ fontSize: 48 }}>🎉</div>
          <p>今天的复习做完了</p>
          {again > 0 && <p className="muted">有 {again} 次「再练」，明天还会再见到它们。</p>}
          <Link href="/" className="go">
            <div className="cta" style={{ marginTop: 0 }}>回到今天 →</div>
          </Link>
        </div>
        <Nav on="review" />
      </main>
    );
  }

  const scenario = findScenario(p, card.scenarioId);

  return (
    <main>
      <div className="row spread">
        <Link href="/review" className="muted" onClick={() => setQueue(null)}>← 退出</Link>
        <span className="muted">
          {index + 1} / {list.length}
        </span>
      </div>
      <div className="progressbar">
        <div style={{ width: `${(index / list.length) * 100}%` }} />
      </div>

      <div className="card flash">
        {scenario && <div className="muted">{scenario.icon} {scenario.titleZh}</div>}
        <div className="prompt">{card.zh}</div>
        {revealed ? (
          <>
            <div className="answer">{card.ja}</div>
            {card.reading && <div className="kana">{card.reading}</div>}
            {heard && (
              <p className="muted">
                你说：{heard.text}
                {heard.score !== undefined && (
                  <>
                    {" "}· <strong className={tone(heard.score)}>{heard.score} 分</strong>
                  </>
                )}
              </p>
            )}
            <button onClick={() => listen(card)}>▶ 听原声</button>
          </>
        ) : (
          <p className="muted">用日语怎么说？按住下面的按钮说出来。</p>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="dock" style={{ bottom: 0, zIndex: 20 }}>
        <div className="dock-inner">
          {revealed ? (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button style={{ flex: 1, padding: 14 }} onClick={() => answer(false)}>再练</button>
              <button className="primary" style={{ flex: 1, padding: 14 }} onClick={() => answer(true)}>
                记住了
              </button>
            </div>
          ) : (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button onClick={() => setRevealed(true)} disabled={busy}>看答案</button>
              <div style={{ flex: 1 }}>
                <HoldButton label={busy ? "评分中…" : "按住说日语"} disabled={busy} onRecorded={onRecorded} onError={setError} />
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
