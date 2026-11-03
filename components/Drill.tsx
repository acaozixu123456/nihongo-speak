"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LEVELS, TIERS, TIER_NAME, tierOf, type DrillOp, type DrillStep, type Ladder } from "@/lib/drill-model";
import { DRILL_PATH, PATH_ITEMS } from "@/content/drill-path";
import { cleared, diff, fastMs, findSeed, judge, loadLadder, nextOnPath, readSeeds, saveSeed, type Seed } from "@/lib/client/drill";
import { flowOf } from "@/lib/client/fluency";
import { chime, confetti, verdict, type Kind } from "@/lib/client/fx";
import { play, stop as stopAudio, ttsUrl, unlock } from "@/lib/client/player";
import { recordDrill, recordSpeech, useProgress, wavSeconds } from "@/lib/client/progress";
import { transcribe } from "@/lib/client/recorder";
import DrillTime from "./DrillTime";
import HoldButton from "./HoldButton";

const VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";
const SPEED = LEVELS + 1; // the level after the four: every sentence again, as fast as it comes
const IDLE = 45_000; // no tap or voice for this long: the clock stops
const FLUSH = 15; // seconds counted before they are saved

// Reaction time as if the sentence were 12 characters, by the same length rule as the speed clock.
const scaled = (ms: number, ja: string) => Math.round((ms * (2000 + 60 * 12)) / (2000 + 60 * ja.length));
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

type Mode = "home" | "loading" | "play" | "up" | "done";
type Result = { kind: Kind; heard: string; ms: number | null; peek?: boolean };
type Run = { i: number; ok: boolean; ms: number | null };

// Said right, from memory, and soon enough for its length.
const fastRun = (l: Ladder, r: Run) => r.ok && r.ms !== null && r.ms <= fastMs(l.steps[r.i].ja, tierOf(l));

const OP_MARK: Record<DrillOp, string> = { base: "●", sub: "⇄", form: "形", add: "＋" };

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
  const t = useRef({ shown: 0, live: 0, again: new Set<number>(), ok: new Set<number>(), runs: [] as Run[], typed: "", card: 0, next: 0 as ReturnType<typeof setTimeout> | 0, act: 0, pend: 0, sess: 0 }).current;
  const progress = useProgress();
  const [sess, setSess] = useState(0); // seconds this word, for the done screen

  // Practice time: while a card or level-up is on screen, the page is in view and something happened
  // in the last 45 s. Saved every 15 s, and when leaving play or the page.
  useEffect(() => {
    if (mode !== "play" && mode !== "up") return;
    const flush = () => {
      if (t.pend) recordDrill(t.pend);
      t.pend = 0;
    };
    const tick = setInterval(() => {
      if (document.hidden || Date.now() - t.act > IDLE) return;
      t.pend++;
      t.sess++;
      if (t.pend >= FLUSH) flush();
    }, 1000);
    const hide = () => document.hidden && flush();
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", hide);
      flush();
      setSess(t.sess);
    };
  }, [mode, t]);

  useEffect(() => {
    setSeeds(readSeeds());
    return () => {
      t.card++;
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
    t.act = t.shown;
    t.live = 0;
  }, [pos, queue, mode, t]);

  // A word or grammar point at its tier: the highest opened unless one is given (升级, or 新しい文 at this one).
  async function open(seed: string, fresh = false, tier?: number) {
    const s = seed.trim();
    if (!s) return;
    unlock();
    setError("");
    setMode("loading");
    t.typed = s;
    try {
      const l = await loadLadder(s, fresh, tier ?? findSeed(readSeeds(), s)?.tier ?? 1);
      setLadder(l);
      startLevels(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : "出题失败");
      setSeeds(readSeeds());
      setMode("home");
    }
  }

  const levelSteps = (l: Ladder, n: number) => l.steps.map((s, k) => (s.lv === n ? k : -1)).filter((k) => k >= 0);

  function startLevels(l: Ladder) {
    t.again.clear();
    t.ok.clear();
    setCombo(0);
    setDone(0);
    t.runs = [];
    t.sess = 0;
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
    const slow = lastRuns.filter((r) => !fastRun(ladder, r)).map((r) => r.i);
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
    const card = t.card;
    const live = t.live;
    t.act = Date.now();
    setBusy(true);
    setError("");
    try {
      // How soon after the card the voice began: the mic going live plus where speech starts in it.
      const flow = await flowOf(wav).catch(() => null);
      const ms = live && flow?.runs.length ? Math.max(0, Math.round(live + flow.runs[0][0] * 1000 - t.shown)) : null;
      const r = await transcribe(wav, step.ja);
      // Left (×) or moved on while it was being checked: this result is for a card no longer shown.
      if (card !== t.card) return;
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      if (!r.text) {
        setError("聞き取れませんでした");
        return;
      }
      show(judge(r, step, i > 0 ? ladder?.steps[i - 1] : undefined), r.text, ms);
    } catch {
      setError("聞き取れませんでした");
    } finally {
      setBusy(false);
    }
  }

  function peek() {
    t.act = Date.now();
    if (!step) return;
    show("wrong", "", null, true);
  }

  function show(kind: Kind, heard: string, ms: number | null, peeked = false) {
    if (!step || !ladder) return;
    verdict(kind, peeked, false);
    setResult({ kind, heard, ms, peek: peeked });
    setCombo((c) => (kind === "right" ? c + 1 : 0));
    if (lv === SPEED) {
      // Said again after a miss or the answer: right, but not from memory, so no time.
      const first = !t.runs.some((x) => x.i === i);
      if (kind === "right" && first && ms !== null) recordDrill(0, scaled(ms, step.ja));
      t.runs = [...t.runs.filter((x) => x.i !== i), { i, ok: kind === "right", ms: kind === "right" && first ? ms : null }];
    } else if (kind === "right") {
      if (!t.ok.has(i)) {
        t.ok.add(i);
        setDone((d) => d + 1);
      }
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
    t.act = Date.now();
    t.card++;
    stopAudio();
    setResult(null);
    t.shown = Date.now();
    t.live = 0;
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
      const fast = r.filter((x) => fastRun(ladder, x)).length;
      setLastRuns(r);
      // A second speed round has only the slow ones: the rest were fast already.
      saveSeed(ladder, fast + (ladder.steps.length - r.length), Date.now(), t.typed);
      if (fast === r.length) confetti(70);
      setSeeds(readSeeds());
      setMode("done");
      return;
    }
    // A level done.
    if (lv === LEVELS) saveSeed(ladder, null, Date.now(), t.typed);
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
    const nextItem = nextOnPath(seeds);
    // Typed by the learner, not on the list.
    const own = seeds.filter((x) => !PATH_ITEMS.some((p) => findSeed([x], p.seed)));
    return (
      <main className="dr">
        <Link href="/speak" className="back" aria-label="戻る">←</Link>
        <h1 className="dr-title">型ドリル</h1>
        <DrillTime p={progress} />
        {error && <p className="error">{error}</p>}
        {loading ? (
          <div className="dr-making" aria-label="作成中">
            {[0, 1, 2, 3].map((k) => (
              <i key={k} style={{ animationDelay: `${k * 0.18}s` }} />
            ))}
          </div>
        ) : (
          <>
            {nextItem && (
              <button className="dr-next" onClick={() => open(nextItem.seed)}>
                <span>
                  <b>{nextItem.seed}</b>
                  <small lang="zh-Hans">{nextItem.zh}</small>
                </span>
                <i aria-hidden>▶</i>
              </button>
            )}
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
            {own.length > 0 && (
              <div className="dr-seeds">
                {own.map((x) => (
                  <Chip key={x.seed} seed={x.seed} rec={x} onOpen={() => open(x.seed)} />
                ))}
              </div>
            )}
            {DRILL_PATH.map((stage) => (
              <section key={stage.name} className="dr-stage">
                <h2>
                  {stage.name}
                  <span>
                    {stage.items.filter((x) => cleared(findSeed(seeds, x.seed), 1)).length}/{stage.items.length}
                  </span>
                </h2>
                <div className="dr-seeds">
                  {stage.items.map((x) => (
                    <Chip key={x.seed} seed={x.seed} rec={findSeed(seeds, x.seed)} onOpen={() => open(x.seed)} />
                  ))}
                </div>
              </section>
            ))}
          </>
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
    const fast = lastRuns.filter((r) => fastRun(ladder, r));
    const all = fast.length === lastRuns.length;
    const tier = tierOf(ladder);
    // Every sentence of this ladder fast (this round or one before it): the next tier opens.
    const up = all && cleared(findSeed(seeds, t.typed), tier) && tier < TIERS;
    const after = nextOnPath(seeds);
    return (
      <main className="dr">
        <button className="back" aria-label="戻る" onClick={home}>←</button>
        <h1 className="dr-title">
          {ladder.seed}
          {tier > 1 && <span className="dr-tier">{TIER_NAME[tier]}</span>}
        </h1>
        <div className={`dr-score${all ? " all" : ""}`}>
          <b>⚡ {fast.length}</b>
          <span>/ {lastRuns.length}</span>
          {sess > 0 && <em aria-label="練習時間">⏱ {clock(sess)}</em>}
        </div>
        <div className="dr-list">
          {lastRuns.map((r) => {
            const s = ladder.steps[r.i];
            const ok = fastRun(ladder, r);
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
          {!all ? (
            <>
              <button className="dr-go" onClick={speedAgain}>⚡ もう一回</button>
              <button className="ko-on" onClick={() => open(t.typed, true, tier)}>＋ 新しい文</button>
            </>
          ) : up ? (
            <>
              <button
                className="dr-go dr-up-go"
                onClick={() => open(t.typed, false, tier + 1)}
              >
                ↑ {TIER_NAME[tier + 1]}
              </button>
              <button className="ko-on" onClick={() => open(t.typed, true, tier)}>＋ 新しい文</button>
            </>
          ) : (
            <>
              {after && findSeed(seeds, after.seed) === undefined ? (
                <button className="dr-go" onClick={() => open(after.seed)}>▶ {after.seed}</button>
              ) : (
                <button className="dr-go" onClick={() => open(t.typed, true, tier)}>＋ 新しい文</button>
              )}
              <button className="ko-on" onClick={home}>一覧</button>
            </>
          )}
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
        {combo >= 2 ? (
          <span className="dr-combo" key={combo}>{combo} 連</span>
        ) : tierOf(ladder) > 1 ? (
          <span className="dr-tier sm">{TIER_NAME[tierOf(ladder)]}</span>
        ) : (
          <span className="dr-combo-sp" />
        )}
      </div>
      <div className="dr-bar" aria-hidden>
        <i style={{ width: `${Math.min(100, (count / Math.max(1, total)) * 100)}%` }} />
      </div>

      <section className="dr-card">
        {prev && <p className="dr-prev">{prev}</p>}
        <div className="dr-cue">
          <span className="dr-op" aria-hidden>{OP_MARK[step.op]}</span>
          <b>{step.op === "base" ? ladder.seed : step.cue}</b>
          <small lang="zh-Hans">{step.op === "base" ? step.zh : step.cue_zh}</small>
        </div>
        {speed && !result && <div className="dr-clock" key={`${pos}-${queue.length}`} style={{ animationDuration: `${fastMs(step.ja, tierOf(ladder))}ms` }} aria-hidden />}
      </section>

      <section className={`dr-ans${result ? ` is-${result.kind}` : ""}`}>
        {result ? (
          <>
            <div className="dr-mark" aria-label={result.kind === "right" ? "正解" : result.kind === "close" ? "惜しい" : "答え"}>
              {result.kind === "right" ? "✓" : result.kind === "close" ? "△" : result.peek ? "答え" : "✕"}
              {result.kind === "right" && result.ms !== null && <em>{(result.ms / 1000).toFixed(1)}s</em>}
            </div>
            <p
              className="dr-ja"
              onClick={() => {
                // Hearing it again: stays on this card until 次へ.
                if (result.kind === "right") {
                  t.card++;
                  if (t.next) clearTimeout(t.next);
                  t.next = 0;
                }
                hear(step);
              }}
            >
              {same1}
              <span className="dr-new">{changed}</span>
              {same2}
            </p>
            <p className="dr-zh" lang="zh-Hans">{step.zh}</p>
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
                onLive={() => {
                  t.live = Date.now();
                  t.act = t.live;
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

// One word or grammar point on the list: ⚡ when every sentence of its current tier came fast, its
// tier once 升级 is open.
function Chip({ seed, rec, onOpen }: { seed: string; rec?: Seed; onOpen: () => void }) {
  const run = rec?.tiers[rec.tier];
  const full = cleared(rec);
  return (
    <button className={`dr-seed${rec ? " seen" : ""}${full ? " full" : ""}`} onClick={onOpen}>
      <b>{seed}</b>
      {rec && rec.tier > 1 && <em>{TIER_NAME[rec.tier]}</em>}
      {run && run.fast > 0 ? (
        <span aria-label={`スピード ${run.fast}/${run.total}`}>{full ? "⚡" : `⚡${run.fast}/${run.total}`}</span>
      ) : rec ? (
        <span className="mid" aria-label="練習した">✓</span>
      ) : null}
    </button>
  );
}
