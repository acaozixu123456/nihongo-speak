"use client";

import { useState } from "react";
import type { Scenario } from "@/content/scenarios";
import { play, setRate, ttsUrl, unlock } from "@/lib/client/player";
import { transcribe, type SttResult } from "@/lib/client/recorder";
import { hasCard, recordShadow, shadowTarget, toggleCard, useProgress } from "@/lib/client/progress";
import { confetti } from "@/lib/client/fx";
import HoldButton from "./HoldButton";
import { RatePicker } from "./Listen";

type Attempt = { wavUrl: string; result: SttResult };

function tone(score: number) {
  return score >= 80 ? "good" : score >= 60 ? "warn" : "bad";
}

type Props = { scenario: Scenario; active: boolean; onNext: () => void };

export default function Shadow({ scenario, active, onNext }: Props) {
  const [index, setIndex] = useState(0);
  const [rate, setRateState] = useState(1);
  const [showZh, setShowZh] = useState(false);
  const [attempts, setAttempts] = useState<Record<number, Attempt>>({});
  const [passed, setPassed] = useState(false);
  const progress = useProgress();
  const best = progress.scenarios[scenario.id]?.shadow ?? {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const line = scenario.lines[index];
  const attempt = attempts[index];
  const scores = attempt?.result.scores;
  const scored = Object.values(best);
  const average = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
  const target = shadowTarget(scenario);
  const saved = hasCard(progress, line.ja);

  function listen() {
    unlock();
    setError("");
    play(ttsUrl(line.ja, line.voice), rate).catch(() => setError("音频播放失败"));
  }

  async function onRecorded(wav: Blob) {
    setBusy(true);
    setError("");
    try {
      const result = await transcribe(wav, line.ja);
      if (!result.text) {
        setError("没听清，再说一次试试");
        return;
      }
      const wavUrl = URL.createObjectURL(wav);
      setAttempts((prev) => {
        if (prev[index]) URL.revokeObjectURL(prev[index].wavUrl);
        return { ...prev, [index]: { wavUrl, result } };
      });
      if (result.scores) {
        const pron = result.scores.pron;
        setPassed(pron >= 80);
        if (pron >= 80 && (best[index] ?? 0) < 80) confetti(40);
        recordShadow(scenario.id, index, pron);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "评分失败");
    } finally {
      setBusy(false);
    }
  }

  function go(delta: number) {
    setError("");
    setPassed(false);
    setIndex((i) => Math.min(scenario.lines.length - 1, Math.max(0, i + delta)));
  }

  return (
    <div>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          先听原声，再按住按钮模仿着说。注意语调的高低和停顿，不只是读对假名。80 分以上算过关。
        </p>
        <RatePicker
          rate={rate}
          onChange={(r) => {
            setRateState(r);
            setRate(r);
          }}
        />
        {average !== null && (
          <p className="muted" style={{ marginBottom: 0 }}>
            已练 {scored.length}/{scenario.lines.length} 句，最高分平均 {average}
          </p>
        )}
        {scored.length >= target && (
          <button className="primary next-cta" onClick={onNext}>跟读完成，去和 AI 对话 →</button>
        )}
      </div>

      <div className="card">
        <div className="row spread">
          <span className="speaker">
            {index + 1} / {scenario.lines.length} · {line.speaker}
          </span>
          <div className="row">
            {best[index] !== undefined && <span className={`muted ${tone(best[index])}`}>最高 {best[index]}</span>}
            <button
              className={`star ${saved ? "on" : ""}`}
              aria-label={saved ? "取消收藏" : "收藏到复习"}
              onClick={() =>
                toggleCard({ ja: line.ja, reading: line.kana, zh: line.zh, voice: line.voice, scenarioId: scenario.id })
              }
            >
              {saved ? "★" : "☆"}
            </button>
          </div>
        </div>
        <div className="ja">
          {scores && scores.words.length > 0
            ? scores.words.map((w, i) => (
                <span
                  key={i}
                  className={`word ${w.errorType !== "None" || w.accuracy < 60 ? "bad" : w.accuracy < 80 ? "warn" : ""}`}
                >
                  {w.word}
                </span>
              ))
            : line.ja}
        </div>
        <div className="kana">{line.kana}</div>
        {showZh && <div className="zh">{line.zh}</div>}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={listen}>▶ 听原声</button>
          {attempt && (
            <button
              onClick={() => {
                unlock();
                play(attempt.wavUrl, 1).catch(() => {});
              }}
            >
              ▶ 听我的
            </button>
          )}
          <button className={`small ${showZh ? "on" : ""}`} onClick={() => setShowZh(!showZh)}>中文</button>
        </div>
      </div>

      {attempt && (
        <div className="card">
          {scores ? (
            <>
              <div className="row" style={{ gap: 16 }}>
                <div key={scores.pron + attempt.wavUrl} className={`score-big ${tone(scores.pron)} ${passed ? "pass" : ""}`}>
                  {scores.pron}
                </div>
                <div className="muted">
                  准确度 {scores.accuracy} · 流利度 {scores.fluency} · 完整度 {scores.completeness}
                </div>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                {passed
                  ? "过关！可以去下一句了。"
                  : "上面句子里标红的词发音偏差较大，标黄的可以再练练。先听原声再试一次。"}
              </p>
              {passed && index < scenario.lines.length - 1 && (
                <button className="primary next-cta" onClick={() => go(1)}>下一句 →</button>
              )}
            </>
          ) : null}
          <p className="muted" style={{ marginBottom: 0 }}>识别结果：{attempt.result.text}</p>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {active && (
        <div className="dock">
          <div className="dock-inner">
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button onClick={() => go(-1)} disabled={index === 0 || busy}>上一句</button>
              <div style={{ flex: 1 }}>
                <HoldButton
                  label={busy ? "评分中…" : "按住跟读"}
                  disabled={busy}
                  onRecorded={onRecorded}
                  onError={setError}
                />
              </div>
              <button onClick={() => go(1)} disabled={index === scenario.lines.length - 1 || busy}>下一句</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
