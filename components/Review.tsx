"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { play, preload, ttsUrl, unlock } from "@/lib/client/player";
import { transcribe } from "@/lib/client/recorder";
import { dueCards, findEpisode, findScenario, recordSpeech, reviewCard, useProgress, wavSeconds, type Card } from "@/lib/client/progress";
import AiJudge, { type Verdict } from "./AiJudge";
import HoldButton from "./HoldButton";
import { useCoach } from "@/lib/client/coach";
import type { Variant } from "@/lib/claude";
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
  const [heard, setHeard] = useState<{ text: string; score?: number; ask: { zh: string; ja: string; reading?: string; pattern?: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [again, setAgain] = useState(0);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const due = dueCards(p);
  const list = queue ?? due;
  const card = list[index];
  // A card seen before comes back as a new sentence on the same pattern, so it isn't memorised as one string.
  // Until the AI answers (or if it fails), the original card is asked.
  const [plain, setPlain] = useState(false);
  const wantVariant = !!queue && !!card && card.step > 0 && !plain;
  const { data: variant } = useCoach<Variant>(wantVariant ? { kind: "variant", ja: card.ja, zh: card.zh } : null);
  type Ask = { zh: string; ja: string; reading?: string; pattern?: string };
  // Once the learner has answered, the sentence they were shown stays put.
  const ask: Ask | null =
    heard?.ask ??
    (wantVariant && variant
      ? { zh: variant.zh, ja: variant.ja, reading: variant.reading, pattern: variant.pattern_zh }
      : card
        ? { zh: card.zh, ja: card.ja, reading: card.reading }
        : null);

  // The sentence on screen is fetched while the learner reads it, so 听 plays at once.
  const askJa = queue && card && ask ? ttsUrl(ask.ja, card.voice) : null;
  useEffect(() => {
    if (askJa) preload([askJa]);
  }, [askJa]);

  function begin() {
    unlock();
    setQueue(due);
    setIndex(0);
  }

  function listen(c: Card, ja = c.ja) {
    unlock();
    play(ttsUrl(ja, c.voice), 1).catch(() => setError("音频播放失败"));
  }

  async function onRecorded(wav: Blob) {
    if (!card || !ask) return;
    const shown = ask;
    setBusy(true);
    setError("");
    try {
      const r = await transcribe(wav, shown.ja);
      if (!r.text) {
        setError("没听清，再说一次试试");
        return;
      }
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      setHeard({ text: r.text, score: r.scores?.pron, ask: shown });
      setRevealed(true);
      listen(card, shown.ja);
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
    setVerdict(null);
    setPlain(false);
    setError("");
  }

  if (p.cards.length === 0) {
    return (
      <main>
        <Link href="/speak" className="back">← 说</Link>
        <header className="page-mast">
          <div>
            <h1>复习</h1>
            <p className="muted">按 1、3、7、14 天的间隔再说一遍</p>
          </div>
        </header>
        <div className="card">
          <p style={{ marginTop: 0 }}>还没有收藏的句子。</p>
          <p className="muted">
            跟读或对话时点「收藏」，句子就会来到这里。之后按 1、3、7、14 天的间隔提醒你开口说一遍。
          </p>
          <Link href="/scenes">去练习 →</Link>
        </div>
        <Nav on="speak" />
      </main>
    );
  }

  if (!queue) {
    return (
      <main>
        <Link href="/speak" className="back">← 说</Link>
        <header className="page-mast">
          <div>
            <h1>复习</h1>
            <p className="muted">按 1、3、7、14 天的间隔再说一遍</p>
          </div>
        </header>
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
                            <p>今天没有要复习的了</p>
              <p className="muted">已收藏 {p.cards.length} 句，到期的会自动出现。</p>
              <Link href="/quick">去练瞬间说 →</Link>
            </>
          )}
        </div>
        <Nav on="speak" />
      </main>
    );
  }

  if (!card) {
    return (
      <main>
        <Link href="/speak" className="back">← 说</Link>
        <header className="page-mast">
          <div>
            <h1>复习</h1>
            <p className="muted">按 1、3、7、14 天的间隔再说一遍</p>
          </div>
        </header>
        <div className="card flash">
                    <p>今天的复习做完了</p>
          {again > 0 && <p className="muted">有 {again} 次「再练」，明天还会再见到它们。</p>}
          {Object.keys(p.weak).length > 0 && (
            <p>
              <Link href="/weak">看 AI 找出的薄弱点 →</Link>
            </p>
          )}
          <Link href="/speak" className="btn primary next-cta" style={{ display: "block" }}>回到今日训练 →</Link>
        </div>
        <Nav on="speak" />
      </main>
    );
  }

  const scenario = findScenario(p, card.scenarioId);
  const fromRadio = card.scenarioId.startsWith("radio:") ? findEpisode(p, card.scenarioId.slice(6)) : undefined;

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
        {scenario && <div className="muted">{scenario.titleZh}</div>}
        {fromRadio && <div className="muted">趣味电台 · {fromRadio.title_zh}</div>}
        {ask && ask.ja !== card.ja && (
          <div className="small-text y">换了个新句子 · 同样考「{ask.pattern}」</div>
        )}
        {wantVariant && !variant && !heard && <div className="small-text judge-wait">AI 正在出一个新句子…</div>}
        <div className="prompt">{ask?.zh ?? card.zh}</div>
        {revealed ? (
          <>
            <div className="answer">{ask?.ja ?? card.ja}</div>
            {ask?.reading && <div className="kana">{ask.reading}</div>}
            {ask && ask.ja !== card.ja && <div className="small-text">原句：{card.ja}</div>}
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
            {heard && (
              <AiJudge
                zh={heard.ask.zh}
                ja={heard.ask.ja}
                where={scenario ? scenario.titleZh : undefined}
                said={heard.text}
                voice={card.voice}
                onVerdict={setVerdict}
              />
            )}
            <button style={{ marginTop: 12 }} onClick={() => listen(card, ask?.ja)}>听原声</button>
          </>
        ) : (
          <>
            <p className="muted">用日语怎么说？点下面的按钮说出来。</p>
            {ask && ask.ja !== card.ja && (
              <button className="small" onClick={() => setPlain(true)}>还是考原句</button>
            )}
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="dock" style={{ bottom: 0, zIndex: 20 }}>
        <div className="dock-inner">
          {revealed ? (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button className={verdict === "off" ? "primary" : ""} style={{ flex: 1, padding: 14 }} onClick={() => answer(false)}>
                再练
              </button>
              <button className={verdict === "off" ? "" : "primary"} style={{ flex: 1, padding: 14 }} onClick={() => answer(true)}>
                记住了
              </button>
            </div>
          ) : (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button onClick={() => setRevealed(true)} disabled={busy}>看答案</button>
              <div style={{ flex: 1 }}>
                <HoldButton label={busy ? "评分中…" : "点一下说日语"} disabled={busy} onRecorded={onRecorded} onError={setError} />
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
