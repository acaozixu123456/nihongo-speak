"use client";

import { useState } from "react";
import type { Scenario } from "@/content/scenarios";
import { play, setRate, ttsUrl, unlock } from "@/lib/client/player";
import { transcribe, type SttResult } from "@/lib/client/recorder";
import HoldButton from "./HoldButton";
import { RatePicker } from "./Listen";

type Attempt = { wavUrl: string; result: SttResult };

function tone(score: number) {
  return score >= 80 ? "good" : score >= 60 ? "warn" : "bad";
}

export default function Shadow({ scenario, active }: { scenario: Scenario; active: boolean }) {
  const [index, setIndex] = useState(0);
  const [rate, setRateState] = useState(1);
  const [showZh, setShowZh] = useState(false);
  const [attempts, setAttempts] = useState<Record<number, Attempt>>({});
  const [best, setBest] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const line = scenario.lines[index];
  const attempt = attempts[index];
  const scores = attempt?.result.scores;
  const scored = Object.values(best);
  const average = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;

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
        setBest((prev) => ({ ...prev, [index]: Math.max(prev[index] ?? 0, pron) }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "评分失败");
    } finally {
      setBusy(false);
    }
  }

  function go(delta: number) {
    setError("");
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
      </div>

      <div className="card">
        <div className="row spread">
          <span className="speaker">
            {index + 1} / {scenario.lines.length} · {line.speaker}
          </span>
          {best[index] !== undefined && <span className={`muted ${tone(best[index])}`}>最高 {best[index]}</span>}
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
                <div className={`score-big ${tone(scores.pron)}`}>{scores.pron}</div>
                <div className="muted">
                  准确度 {scores.accuracy} · 流利度 {scores.fluency} · 完整度 {scores.completeness}
                </div>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                上面句子里标红的词发音偏差较大，标黄的可以再练练。
              </p>
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
