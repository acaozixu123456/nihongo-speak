"use client";

import { useEffect, useRef, useState } from "react";
import type { Scenario } from "@/content/scenarios";
import { play, setRate, stop, ttsUrl, unlock } from "@/lib/client/player";
import { markListened } from "@/lib/client/progress";

export const RATES = [0.6, 0.8, 1, 1.2];

export function RatePicker({ rate, onChange }: { rate: number; onChange: (r: number) => void }) {
  return (
    <div className="row">
      <span className="muted">语速</span>
      {RATES.map((r) => (
        <button key={r} className={`small ${rate === r ? "on" : ""}`} onClick={() => onChange(r)}>
          {r}x
        </button>
      ))}
    </div>
  );
}

export default function Listen({ scenario, active, onNext }: { scenario: Scenario; active: boolean; onNext: () => void }) {
  const [rate, setRateState] = useState(1);
  const [showJa, setShowJa] = useState(false);
  const [tools, setTools] = useState(false);
  const [showKana, setShowKana] = useState(false);
  const [showZh, setShowZh] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const runId = useRef(0);

  // Another tab, or another page: the run stops there instead of carrying on to the next line.
  useEffect(() => {
    if (active) return;
    runId.current++;
    setCurrent(null);
  }, [active]);
  useEffect(() => () => void runId.current++, []);

  function changeRate(r: number) {
    setRateState(r);
    setRate(r);
  }

  async function playFrom(start: number, single: boolean) {
    unlock();
    const id = ++runId.current;
    setError("");
    try {
      let i = start;
      while (i < scenario.lines.length && runId.current === id) {
        setCurrent(i);
        const line = scenario.lines[i];
        await play(ttsUrl(line.ja, line.voice), rate);
        if (runId.current !== id) return;
        if (single) {
          if (!loop) break;
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        await new Promise((r) => setTimeout(r, 400));
        i++;
      }
      // A full run from the first line counts as having listened to the scenario.
      if (!single && start === 0 && i === scenario.lines.length && runId.current === id) {
        markListened(scenario);
        setFinished(true);
      }
    } catch {
      if (runId.current === id) setError("音频播放失败，请检查网络后再试");
    }
    if (runId.current === id) setCurrent(null);
  }

  function halt() {
    runId.current++;
    stop();
    setCurrent(null);
  }

  function toggleReveal(i: number) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div>
      {/* One line of advice; speed and subtitles wait behind 設定 so the first listen needs no decisions. */}
      <div className="listen-bar">
        <span>字幕なしで一回通して聞く</span>
        <button className="text-btn" onClick={() => setTools(!tools)}>
          {rate}× · 字幕 {tools ? "‹" : "›"}
        </button>
      </div>
      {tools && (
        <div className="listen-tools">
          <RatePicker rate={rate} onChange={changeRate} />
          <div className="row" style={{ marginTop: 8 }}>
            <span className="muted">字幕</span>
            <button className={`small ${showJa ? "on" : ""}`} onClick={() => setShowJa(!showJa)}>日文</button>
            <button className={`small ${showKana ? "on" : ""}`} onClick={() => setShowKana(!showKana)}>读音</button>
            <button className={`small ${showZh ? "on" : ""}`} onClick={() => setShowZh(!showZh)}>中文</button>
            <button className={`small ${loop ? "on" : ""}`} onClick={() => setLoop(!loop)}>单句循环</button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {finished && (
        <div className="card">
          <strong>整段听完了</strong>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            听不出的句子点开再听几遍。觉得差不多了，就开口跟着说。
          </p>
          <button className="primary next-cta" onClick={onNext}>まねる →</button>
        </div>
      )}

      {scenario.lines.map((line, i) => {
        const visible = showJa || revealed.has(i);
        return (
          <div key={i} className={`listen-line line ${current === i ? "current" : ""}`} onClick={() => playFrom(i, true)}>
            <div className="row spread">
              <span className="speaker">{line.speaker}</span>
              <button
                className="text-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleReveal(i);
                }}
              >
                {revealed.has(i) ? "隠す" : "見る"}
              </button>
            </div>
            <div className={`ja ${visible ? "" : "hidden-text"}`}>{line.ja}</div>
            {(showKana || revealed.has(i)) && <div className="kana">{line.kana}</div>}
            {(showZh || revealed.has(i)) && <div className="zh">{line.zh}</div>}
          </div>
        );
      })}

      {!finished && (
        <div className="sticky-cta">
          {current === null ? (
            <button className="primary" onClick={() => playFrom(0, false)}>▶ 通して聞く</button>
          ) : (
            <button onClick={halt}>■ 止める</button>
          )}
        </div>
      )}
    </div>
  );
}
