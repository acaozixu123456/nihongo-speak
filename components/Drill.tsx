"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LEVELS, type DrillOp, type DrillStep, type Ladder } from "@/lib/drill-model";
import { FAST_MS, STARTERS, diff, judge, loadLadder, readSeeds, saveSeed, type Seed } from "@/lib/client/drill";
import { chime, confetti, verdict, type Kind } from "@/lib/client/fx";
import { play, stop as stopAudio, ttsUrl, unlock } from "@/lib/client/player";
import { recordSpeech, wavSeconds } from "@/lib/client/progress";
import { transcribe } from "@/lib/client/recorder";
import HoldButton from "./HoldButton";

const VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";
const SPEED = LEVELS + 1; // the level after the four: every sentence again, as fast as it comes

type Mode = "home" | "loading" | "play" | "up" | "done";
type Result = { kind: Kind; heard: string; ms: number | null; peek?: boolean };
type Run = { i: number; ok: boolean; ms: number | null };

const OP_MARK: Record<DrillOp, string> = { base: "●", sub: "⇄", form: "↻", add: "＋" };

// 型ドリル: type a word or grammar point; 森先生 gives one change at a time (swap a word, change the
// form, say more) and the whole sentence is said out loud at once, four levels from two words up. Then
// a speed round of every sentence from its Chinese, again until each comes within three seconds.
export default function Drill() {
  const [mode, setMode] = useState<Mode>("home");
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [text, setText] = useState("");
  const [ladder, setLadder] = useState<Ladder | null>(null);
  const [error, setError] = useState("");
  const [lv, setLv] = useState(1);
  const [queue, setQueue] = useState<number[]>([]);
  const [pos, setPos] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [combo, setCombo] = useState(0);
  const [done, setDone] = useState(0); // steps said right in the levels
  const [lastRuns, setLastRuns] = useState<Run[]>([]);
  const t = useRef({ shown: 0, started: 0, again: new Set<number>(), runs: [] as Run[], card: 0, next: 0 as ReturnType<typeof setTimeout> | 0 }).current;

  useEffect(() => {
    setSeeds(readSeeds());
    return () => {
      stopAudio();
      if (t.next) clearTimeout(t.next);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const i = queue[pos] ?? -1;
  const step: DrillStep | null = ladder && i >= 0 ? ladder.steps[i] : null;

  // A new card: the clock starts for how soon speaking begins.
  useEffect(() => {
    t.shown = Date.now();
    t.started = 0;
  }, [pos, queue, mode, t]);

  async function open(seed: string, fresh = false) {
    const s = seed.trim();
    if (!s) return;
    unlock();
    setError("");
    setMode("loading");
    try {
      const l = await loadLadder(s, fresh);
      setLadder(l);
      startLevels(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : "出题失败");
      setMode("home");
    }
  }

  const levelSteps = (l: Ladder, n: number) => l.steps.map((s, k) => (s.lv === n ? k : -1)).filter((k) => k >= 0);

  function startLevels(l: Ladder) {
    t.again.clear();
    setCombo(0);
    setDone(0);
    t.runs = [];
    goLevel(l, 1);
  }

  function goLevel(l: Ladder, n: number) {
    let k = n;
    while (k <= LEVELS && !levelSteps(l, k).length) k++;
    setLv(k);
    setQueue(k > LEVELS ? l.steps.map((_, x) => x) : levelSteps(l, k));
    setPos(0);
    setResult(null);
    setMode("play");
  }

  // The speed round again, with only what wasn't fast yet.
  function speedAgain() {
    if (!ladder) return;
    const slow = lastRuns.filter((r) => !r.ok || r.ms === null || r.ms > FAST_MS).map((r) => r.i);
    setLv(SPEED);
    setQueue(slow.length ? slow : ladder.steps.map((_, x) => x));
    t.runs = [];
    setPos(0);
    setResult(null);
    setMode("play");
  }

  function hear(s: DrillStep) {
    return play(ttsUrl(s.ja, VOICE)).catch(() => {});
  }

  async function onRecorded(wav: Blob) {
    if (!step) return;
    const ms = t.started ? t.started - t.shown : null;
    setBusy(true);
    setError("");
    try {
      const r = await transcribe(wav, step.ja);
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      if (!r.text) {
        setError("聞き取れませんでした");
        return;
      }
      show(judge(r, step), r.text, ms);
    } catch {
      setError("聞き取れませんでした");
    } finally {
      setBusy(false);
    }
  }

  function peek() {
    if (!step) return;
    show("wrong", "", null, true);
  }

  function show(kind: Kind, heard: string, ms: number | null, peeked = false) {
    if (!step || !ladder) return;
    verdict(kind, peeked, false);
    setResult({ kind, heard, ms, peek: peeked });
    setCombo((c) => (kind === "right" ? c + 1 : 0));
    if (lv === SPEED) {
      t.runs = [...t.runs.filter((x) => x.i !== i), { i, ok: kind === "right", ms: kind === "right" ? ms : null }];
    } else if (kind === "right") {
      if (!t.again.has(i)) setDone((d) => d + 1);
    } else if (!t.again.has(i)) {
      // Missed: comes back at the end of this level.
      t.again.add(i);
      setQueue((q) => [...q, i]);
    }
    // Right: the sentence is said once, then on by itself.
    const card = t.card;
    const said = hear(step);
    // Not when the learner moved on (or said it again) while it played.
    if (kind === "right") said.then(() => card === t.card && (t.next = setTimeout(next, lv === SPEED ? 250 : 500)));
  }

  function retry() {
    t.card++;
    stopAudio();
    setResult(null);
    t.shown = Date.now();
    t.started = 0;
  }

  function next() {
    t.card++;
    if (t.next) clearTimeout(t.next);
    t.next = 0;
    stopAudio();
    if (!ladder) return;
    setResult(null);
    if (pos + 1 < queue.length) {
      setPos((p) => p + 1);
      return;
    }
    if (lv === SPEED) {
      const r = t.runs;
      const fast = r.filter((x) => x.ok && x.ms !== null && x.ms <= FAST_MS).length;
      setLastRuns(r);
      // A second speed round has only the slow ones: the rest were fast already.
      saveSeed(ladder, fast + (ladder.steps.length - r.length), Date.now());
      if (fast === r.length) confetti(70);
      setSeeds(readSeeds());
      setMode("done");
      return;
    }
    // A level done.
    if (lv === LEVELS) saveSeed(ladder, null, Date.now());
    chime(true);
    if (lv === LEVELS) confetti(40);
    setMode("up");
    const to = lv + 1;
    t.next = setTimeout(() => goLevel(ladder, to), 1500);
  }

  function home() {
    t.card++;
    stopAudio();
    if (t.next) clearTimeout(t.next);
    setSeeds(readSeeds());
    setMode("home");
    setResult(null);
  }

  // ---- screens ----

  if (mode === "home" || mode === "loading") {
    const loading = mode === "loading";
    return (
      <main className="dr">
        <Link href="/speak" className="back" aria-label="戻る">←</Link>
        <h1 className="dr-title">型ドリル</h1>
        <form
          className="dr-input"
          onSubmit={(e) => {
            e.preventDefault();
            open(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="食べる・〜てしまう"
            aria-label="単語・文法"
            maxLength={30}
            enterKeyHint="go"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !text.trim()} aria-label="始める">
            {loading ? <span className="dr-spin" /> : "▶"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        {loading ? (
          <div className="dr-making" aria-label="作成中">
            {[0, 1, 2, 3].map((k) => (
              <i key={k} style={{ animationDelay: `${k * 0.18}s` }} />
            ))}
          </div>
        ) : (
          <div className="dr-seeds">
            {(seeds.length ? seeds : STARTERS.map((s) => ({ seed: s, meaning: "", plays: 0, fast: 0, total: 0, last: 0 }))).map((s) => (
              <button key={s.seed} className="dr-seed" onClick={() => open(s.seed)}>
                <b>{s.seed}</b>
                {s.total > 0 && (
                  <span className={s.fast >= s.total ? "full" : ""} aria-label={`3秒以内 ${s.fast}/${s.total}`}>
                    ⚡{s.fast}/{s.total}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </main>
    );
  }

  if (!ladder) return null;

  if (mode === "up") {
    const to = lv + 1;
    return (
      <main className="dr dr-upwrap">
        <div className="dr-up">
          <span>{to > LEVELS ? "⚡" : `Lv${to}`}</span>
          <b>{to > LEVELS ? "スピード" : ["", "", "広げる", "形を変える", "長くする"][to]}</b>
        </div>
      </main>
    );
  }

  if (mode === "done") {
    const fast = lastRuns.filter((r) => r.ok && r.ms !== null && r.ms <= FAST_MS);
    const all = fast.length === lastRuns.length;
    return (
      <main className="dr">
        <button className="back" aria-label="戻る" onClick={home}>←</button>
        <h1 className="dr-title">{ladder.seed}</h1>
        <div className={`dr-score${all ? " all" : ""}`}>
          <b>⚡ {fast.length}</b>
          <span>/ {lastRuns.length}</span>
        </div>
        <div className="dr-list">
          {lastRuns.map((r) => {
            const s = ladder.steps[r.i];
            const ok = r.ok && r.ms !== null && r.ms <= FAST_MS;
            return (
              <button key={r.i} className="dr-row" onClick={() => hear(s)}>
                <i className={ok ? "ok" : r.ok ? "mid" : "no"} aria-hidden>{ok ? "⚡" : r.ok ? "✓" : "✕"}</i>
                <span>
                  {s.ja}
                  <small>{s.zh}</small>
                </span>
                {r.ok && r.ms !== null && <em>{(r.ms / 1000).toFixed(1)}s</em>}
              </button>
            );
          })}
        </div>
        <div className="dr-foot">
          {all ? (
            <button className="dr-go" onClick={() => open(ladder.seed, true)}>＋ 新しい文</button>
          ) : (
            <button className="dr-go" onClick={speedAgain}>⚡ もう一回</button>
          )}
          <button className="ko-on" onClick={all ? speedAgain : () => open(ladder.seed, true)}>{all ? "⚡ もう一回" : "＋ 新しい文"}</button>
        </div>
      </main>
    );
  }

  // ---- play ----
  if (!step) return null;
  const speed = lv === SPEED;
  const prev = i > 0 ? ladder.steps[i - 1].ja : "";
  const [same1, changed, same2] = diff(prev, step.ja);
  const total = speed ? queue.length : ladder.steps.length;
  const count = speed ? pos + (result ? 1 : 0) : done;

  return (
    <main className={`dr dr-play op-${speed ? "speed" : step.op}`}>
      <div className="dr-top">
        <button className="dr-x" aria-label="閉じる" onClick={home}>×</button>
        <div className="dr-lvs" aria-label={speed ? "スピード" : `レベル${lv}`}>
          {Array.from({ length: LEVELS }, (_, k) => (
            <i key={k} className={k + 1 < lv ? "d" : k + 1 === lv ? "n" : ""}>{k + 1}</i>
          ))}
          <i className={speed ? "n bolt" : "bolt"}>⚡</i>
        </div>
        {combo >= 2 ? <span className="dr-combo" key={combo}>{combo} 連</span> : <span className="dr-combo-sp" />}
      </div>
      <div className="dr-bar" aria-hidden>
        <i style={{ width: `${Math.min(100, (count / Math.max(1, total)) * 100)}%` }} />
      </div>

      {speed ? (
        <section className="dr-card">
          <p className="dr-zhcue" lang="zh-Hans">{step.zh}</p>
          {!result && <div className="dr-clock" key={`${pos}-${queue.length}`} aria-hidden />}
        </section>
      ) : (
        <section className="dr-card">
          {prev && <p className="dr-prev">{prev}</p>}
          <div className="dr-cue">
            <span className="dr-op" aria-hidden>{OP_MARK[step.op]}</span>
            <b>{step.op === "base" ? ladder.seed : step.cue}</b>
            <small lang="zh-Hans">{step.op === "base" ? ladder.meaning_zh : step.cue_zh}</small>
          </div>
        </section>
      )}

      <section className={`dr-ans${result ? ` is-${result.kind}` : ""}`}>
        {result ? (
          <>
            <div className="dr-mark" aria-label={result.kind === "right" ? "正解" : result.kind === "close" ? "惜しい" : "答え"}>
              {result.kind === "right" ? "✓" : result.kind === "close" ? "△" : result.peek ? "答え" : "✕"}
              {result.kind === "right" && result.ms !== null && <em>{(result.ms / 1000).toFixed(1)}s</em>}
            </div>
            <p className="dr-ja" onClick={() => hear(step)}>
              {speed ? (
                <span className="dr-new">{step.ja}</span>
              ) : (
                <>
                  {same1}
                  <span className="dr-new">{changed}</span>
                  {same2}
                </>
              )}
            </p>
            {!speed && <p className="dr-zh" lang="zh-Hans">{step.zh}</p>}
            {result.heard && result.kind !== "right" && <p className="dr-heard">{result.heard}</p>}
          </>
        ) : (
          <div className="dr-blank" aria-hidden>
            {busy ? <span className="dr-spin dark" /> : "？"}
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      <div className="dr-dock">
        {result ? (
          <div className="dr-btns">
            {result.kind !== "right" && <button className="dr-ghost" onClick={retry}>もう一回</button>}
            <button className="dr-go" onClick={next}>次へ</button>
          </div>
        ) : (
          <div className="dr-btns">
            <button className="dr-ghost" onClick={peek} disabled={busy}>答え</button>
            <div className="dr-mic">
              <HoldButton
                label={busy ? "…" : "● 話す"}
                disabled={busy}
                onStart={() => {
                  if (!t.started) t.started = Date.now();
                }}
                onRecorded={onRecorded}
                onError={setError}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
