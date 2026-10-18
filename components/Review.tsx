"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { play, preload, stop, ttsUrl, unlock } from "@/lib/client/player";
import { transcribe } from "@/lib/client/recorder";
import { dueCards, findEpisode, findScenario, recordSpeech, reviewCard, useProgress, wavSeconds, type Card } from "@/lib/client/progress";
import { useJudge } from "./AiJudge";
import HoldButton from "./HoldButton";
import { Stamp, StreakPill, VerdictSheet, kindByText, kindOf } from "./Verdict";
import { useCoach } from "@/lib/client/coach";
import { stepDone, useOnRoute } from "@/lib/client/route";
import type { Variant } from "@/lib/claude";
import { variantOk } from "@/lib/variant";

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

  const due = dueCards(p);
  const list = queue ?? due;
  const card = list[index];
  // A card seen before comes back as a new sentence on the same pattern, so it isn't memorised as one string.
  // Until the AI answers (or if it fails), the original card is asked.
  const [plain, setPlain] = useState(false);
  const wantVariant = !!queue && !!card && card.step > 0 && !plain;
  const { data: variantData, error: variantError } = useCoach<Variant>(
    wantVariant ? { kind: "variant", ja: card.ja, zh: card.zh } : null,
  );
  const variant = variantData && variantOk(variantData) ? variantData : null;
  // A slow answer isn't waited for: after a few seconds, or once the answer is shown, the original card stays.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!wantVariant) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [wantVariant, index]);
  useEffect(() => {
    if (wantVariant && !variant && (slow || revealed)) setPlain(true);
  }, [wantVariant, variant, slow, revealed]);
  const variantFailed = !!variantError || (!!variantData && !variant);
  type Ask = { zh: string; ja: string; reading?: string; pattern?: string };
  // Once the learner has answered, the sentence they were shown stays put.
  const ask: Ask | null =
    heard?.ask ??
    (wantVariant && variant
      ? { zh: variant.zh, ja: variant.ja, reading: variant.reading, pattern: variant.pattern_zh }
      : card
        ? { zh: card.zh, ja: card.ja, reading: card.reading }
        : null);

  // What the AI makes of the spoken answer becomes the 判定; without the AI, how close the words came decides.
  // 看答案 without speaking counts as a miss, quietly.
  const scenario = card ? findScenario(p, card.scenarioId) : undefined;
  const judge = useJudge(heard ? { zh: heard.ask.zh, ja: heard.ask.ja, where: scenario?.titleZh, said: heard.text } : null);
  const kind = heard
    ? judge.data
      ? kindOf(judge.data.verdict)
      : judge.failed
        ? kindByText(heard.text, heard.ask.ja)
        : null
    : revealed
      ? "wrong"
      : null;

  // Once judged, the right sentence is read out: slower when it was missed.
  const readFor = useRef<string | null>(null);
  useEffect(() => {
    if (!kind || !card || !ask || readFor.current === card.id + index) return;
    readFor.current = card.id + index;
    const t = setTimeout(() => listen(card, ask.ja, kind === "right" ? 1 : 0.85), heard ? 600 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

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

  // On today's route there is no intro: the cards start at once, and the route moves on when they're done.
  const onRoute = useOnRoute();
  useEffect(() => {
    if (onRoute && !queue) {
      if (due.length) begin();
      else stepDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRoute]);
  const over = !!queue && !card;
  useEffect(() => {
    if (over) stepDone();
  }, [over]);

  function listen(c: Card, ja = c.ja, rate = 1) {
    unlock();
    play(ttsUrl(ja, c.voice), rate).catch(() => setError("音频播放失败"));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "评分失败");
    } finally {
      setBusy(false);
    }
  }

  function answer(remembered: boolean) {
    if (!card) return;
    stop();
    reviewCard(card.id, remembered);
    if (!remembered) {
      setAgain((n) => n + 1);
      // Missed cards come back at the end of today's queue.
      setQueue([...list, card]);
    }
    setIndex((i) => i + 1);
    setRevealed(false);
    setHeard(null);
    setPlain(false);
    setError("");
  }

  if (p.cards.length === 0) {
    return (
      <main>
        <Link href="/" className="back">← 今日</Link>
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
      </main>
    );
  }

  if (!queue) {
    return (
      <main>
        <Link href="/" className="back">← 今日</Link>
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
      </main>
    );
  }

  if (!card) {
    return (
      <main>
        <Link href="/" className="back">← 今日</Link>
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
          <Link href="/" className="btn primary next-cta" style={{ display: "block" }}>回到今日 →</Link>
        </div>
      </main>
    );
  }

  const fromRadio = card.scenarioId.startsWith("radio:") ? findEpisode(p, card.scenarioId.slice(6)) : undefined;
  const ja = ask?.ja ?? card.ja;

  return (
    <main>
      <div className="row spread">
        <Link href="/review" className="muted" onClick={() => setQueue(null)}>✕</Link>
        <div className="progressbar" style={{ flex: 1, margin: "0 12px" }}>
          <div style={{ width: `${(index / list.length) * 100}%` }} />
        </div>
        <StreakPill />
      </div>

      <div className={`card flash ${kind ? `v-${kind}` : ""}`}>
        <Stamp kind={heard ? kind : null} />
        {!revealed && (
          <div className="meta">
            {[
              ask && ask.ja !== card.ja && ask.pattern
                ? `新句子 · ${ask.pattern}`
                : fromRadio
                  ? `趣味电台 · ${fromRadio.title_zh}`
                  : scenario?.titleZh,
            ]}
          </div>
        )}
        {wantVariant && !variant && !variantFailed && !heard ? (
          <div className="prompt judge-wait muted">出个新句子…</div>
        ) : (
          <div className={`prompt ${revealed ? "asked" : ""}`}>{ask?.zh ?? card.zh}</div>
        )}
        {heard ? (
          <button className={`said said-${kind ?? "wait"}`} onClick={() => listen(card, ja)}>
            {kind === "right" ? ja : heard.text}
          </button>
        ) : (
          !revealed &&
          ask &&
          ask.ja !== card.ja && (
            <button className="link-btn" onClick={() => setPlain(true)}>换回原句</button>
          )
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {revealed ? (
        <VerdictSheet
          key={card.id + index}
          kind={kind}
          quiet={!heard}
          ja={ja}
          voice={card.voice}
          why={judge.data}
          onHear={() => listen(card, ja, kind === "right" ? 1 : 0.85)}
          onNext={() => answer(kind !== "wrong")}
        />
      ) : (
        <div className="dock" style={{ bottom: 0, zIndex: 20 }}>
          <div className="dock-inner">
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button onClick={() => setRevealed(true)} disabled={busy}>答え</button>
              <div style={{ flex: 1 }}>
                <HoldButton label={busy ? "…" : "🎙 日本語で"} disabled={busy} onRecorded={onRecorded} onError={setError} />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
