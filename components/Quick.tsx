"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { play, stop, ttsUrl, unlock } from "@/lib/client/player";
import { transcribe } from "@/lib/client/recorder";
import {
  QUICK_LIMIT_MS,
  dayKey,
  hasCard,
  quickRound,
  recordQuick,
  recordSpeech,
  toggleCard,
  useProgress,
  wavSeconds,
  type QuickItem,
} from "@/lib/client/progress";
import { totals } from "@/lib/client/metrics";
import { addDays } from "@/lib/progress-model";
import HoldButton from "./HoldButton";
import Nav from "./Nav";

type Result = { item: QuickItem; ms: number | null; heard?: string; score?: number };

const secs = (ms: number) => (ms / 1000).toFixed(1);

function tone(score: number) {
  return score >= 80 ? "good" : score >= 60 ? "warn" : "bad";
}

// Counts down from 3s, then keeps counting how far over the learner went.
function Timer({ start, frozen }: { start: number; frozen: number | null }) {
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (frozen !== null) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [frozen]);
  const elapsed = (frozen ?? now) - start;
  const left = QUICK_LIMIT_MS - elapsed;
  const ratio = Math.max(0, left / QUICK_LIMIT_MS);
  return (
    <div className={`qtimer ${left < 0 ? "over" : ""}`}>
      <div className="qtimer-bar">
        <div style={{ width: `${ratio * 100}%` }} />
      </div>
      <span>{left >= 0 ? `${Math.ceil(left / 1000)}` : `超时 ${secs(-left)}s`}</span>
    </div>
  );
}

export default function Quick() {
  const p = useProgress();
  const [round, setRound] = useState<QuickItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [shownAt, setShownAt] = useState(0);
  const [spokeAt, setSpokeAt] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const spokeRef = useRef<number | null>(null);

  const item = round?.[index];

  function show(i: number) {
    setIndex(i);
    setShownAt(Date.now());
    setSpokeAt(null);
    spokeRef.current = null;
    setResult(null);
    setError("");
  }

  function begin() {
    unlock();
    setRound(quickRound(p));
    setResults([]);
    show(0);
  }

  function hear(i: QuickItem) {
    unlock();
    play(ttsUrl(i.ja, i.voice), 1).catch(() => setError("音频播放失败"));
  }

  function finish(r: Result) {
    recordQuick(r.ms);
    setResult(r);
    setResults((rs) => [...rs, r]);
    hear(r.item);
  }

  function onStart() {
    // Only the first press counts as the reaction; a retry after "too short" keeps it.
    if (spokeRef.current === null) {
      spokeRef.current = Date.now();
      setSpokeAt(spokeRef.current);
    }
  }

  async function onRecorded(wav: Blob) {
    if (!item) return;
    setBusy(true);
    setError("");
    try {
      const r = await transcribe(wav, item.ja);
      if (!r.text) {
        setError("没听清，再按住说一次");
        return;
      }
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      finish({ item, ms: (spokeRef.current ?? Date.now()) - shownAt, heard: r.text, score: r.scores?.pron });
    } catch (e) {
      setError(e instanceof Error ? e.message : "识别失败");
    } finally {
      setBusy(false);
    }
  }

  function giveUp() {
    if (!item) return;
    finish({ item, ms: null });
  }

  function next() {
    stop();
    show(index + 1);
  }

  // ---- Intro ----
  if (!round) {
    const today = dayKey();
    const t = totals(p, today, today);
    return (
      <main>
        <header className="page-mast">
          <h1>瞬間</h1>
          <p className="muted">瞬间说 · 看中文，3 秒内开口</p>
        </header>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            真实对话里只有一两秒反应时间。这里每题给你一句中文和它出现的场合，<strong>3 秒内按住按钮开口</strong>
            ，说完对照标准说法。
          </p>
          <p className="muted">
            一轮 10 题。不用说得和答案一模一样，意思对、先说出来最重要。App 会记下你从看到题目到开口用了几秒，看它一周周变短。
          </p>
          {t.quickMs !== null && (
            <p className="muted">
              今天已经答了 {t.quickSpoke} 题，平均 {secs(t.quickMs)} 秒开口。
            </p>
          )}
          <button className="primary next-cta" onClick={begin}>开始一轮</button>
        </div>
        <Nav on="review" />
      </main>
    );
  }

  // ---- Summary ----
  if (!item) {
    const spoke = results.filter((r) => r.ms !== null);
    const avg = spoke.length ? spoke.reduce((a, r) => a + r.ms!, 0) / spoke.length : null;
    const fast = spoke.filter((r) => r.ms! <= QUICK_LIMIT_MS).length;
    const today = dayKey();
    const before = totals(p, addDays(today, -7), addDays(today, -1));
    return (
      <main>
        <header className="page-mast">
          <h1>瞬間</h1>
          <p className="muted">这一轮的结果</p>
        </header>
        <div className="card">
          <div className="kpis">
            <div className="kpi">
              <b>{avg === null ? "–" : `${secs(avg)}s`}</b>
              <span>平均开口</span>
            </div>
            <div className="kpi">
              <b>
                {fast} / {results.length}
              </b>
              <span>3 秒内</span>
            </div>
            <div className="kpi">
              <b>{results.length - spoke.length}</b>
              <span>没说出来</span>
            </div>
          </div>
          {avg !== null && before.quickMs !== null && (
            <p className="muted" style={{ marginBottom: 0, textAlign: "center" }}>
              过去 7 天平均 {secs(before.quickMs)} 秒，这一轮
              <span className={`delta ${avg <= before.quickMs ? "up" : "down"}`}>
                {avg <= before.quickMs ? ` 快了 ${secs(before.quickMs - avg)} 秒` : ` 慢了 ${secs(avg - before.quickMs)} 秒`}
              </span>
            </p>
          )}
        </div>
        <div className="card">
          {results.map((r, i) => (
            <div key={i} className="qrow">
              <span className={r.ms === null ? "bad" : r.ms <= QUICK_LIMIT_MS ? "good" : "warn"}>
                {r.ms === null ? "✗" : `${secs(r.ms)}s`}
              </span>
              <div>
                <div>{r.item.ja}</div>
                <div className="small-text">{r.item.zh}</div>
              </div>
            </div>
          ))}
        </div>
        <button className="primary next-cta" onClick={begin}>再来一轮</button>
        <p style={{ textAlign: "center" }}>
          <Link href="/" className="muted">回到今天</Link>
        </p>
        <Nav on="review" />
      </main>
    );
  }

  // ---- One prompt ----
  const saved = hasCard(p, item.ja);
  return (
    <main>
      <div className="row spread">
        <Link href="/quick" className="muted" onClick={() => setRound(null)}>← 退出</Link>
        <span className="muted">
          {index + 1} / {round.length}
        </span>
      </div>
      <div className="progressbar">
        <div style={{ width: `${(index / round.length) * 100}%` }} />
      </div>

      <div className="card flash">
        <div className="muted">{item.where}</div>
        <div className="prompt">{item.zh}</div>
        {!result && <Timer key={shownAt} start={shownAt} frozen={spokeAt} />}
        {result && (
          <>
            <div className="qtime">
              {result.ms === null ? (
                <span className="bad">这次没说出来，没关系</span>
              ) : (
                <span className={result.ms <= QUICK_LIMIT_MS ? "good" : "warn"}>{secs(result.ms)} 秒开口</span>
              )}
            </div>
            <div className="answer">{item.ja}</div>
            {item.reading && <div className="kana">{item.reading}</div>}
            {result.heard && (
              <p className="muted">
                你说：{result.heard}
                {result.score !== undefined && (
                  <>
                    {" "}· <strong className={tone(result.score)}>发音 {result.score}</strong>
                  </>
                )}
              </p>
            )}
            <div className="row" style={{ justifyContent: "center" }}>
              <button onClick={() => hear(item)}>▶ 听原声</button>
              <button
                className={`star ${saved ? "on" : ""}`}
                onClick={() =>
                  toggleCard({ ja: item.ja, reading: item.reading, zh: item.zh, voice: item.voice, scenarioId: item.scenarioId })
                }
              >
                {saved ? "★ 已加入复习" : "☆ 加入复习"}
              </button>
            </div>
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="dock" style={{ bottom: 0, zIndex: 20 }}>
        <div className="dock-inner">
          {result ? (
            <button className="primary" style={{ width: "100%", padding: 14 }} onClick={next}>
              {index + 1 < round.length ? "下一题 →" : "看结果"}
            </button>
          ) : (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button onClick={giveUp} disabled={busy}>说不出来</button>
              <div style={{ flex: 1 }}>
                <HoldButton
                  label={busy ? "识别中…" : "按住说日语"}
                  disabled={busy}
                  onStart={onStart}
                  onRecorded={onRecorded}
                  onError={setError}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
