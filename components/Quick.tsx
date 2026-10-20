"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { play, stop, ttsUrl, unlock } from "@/lib/client/player";
import { transcribe } from "@/lib/client/recorder";
import {
  QUICK_LIMIT_MS,
  dayKey,
  drillRound,
  hasCard,
  markQuickOff,
  quickMastered,
  quickRound,
  recordQuick,
  recordSpeech,
  saveDrill,
  toggleCard,
  useProgress,
  wavSeconds,
  type QuickItem,
} from "@/lib/client/progress";
import { totals } from "@/lib/client/metrics";
import { addDays } from "@/lib/progress-model";
import { stepDone, useOnRoute } from "@/lib/client/route";
import { useJudge, type Verdict } from "./AiJudge";
import HoldButton from "./HoldButton";
import { Stamp, StreakPill, VerdictSheet, kindByText, kindOf, type Kind } from "./Verdict";

type Result = {
  item: QuickItem;
  ms: number | null;
  hinted: boolean;
  heard?: string;
  score?: number;
  sttFailed?: boolean;
};

const SIZES = [5, 10, 20];
const SIZE_KEY = "nihongo-speak:quick-size";
const HINT_CHARS = 3;
const ROUTE_SIZE = 5;
const ROUTE_DRILL = 3;

const secs = (ms: number) => (ms / 1000).toFixed(1);

function loadSize() {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return SIZES.includes(n) ? n : 10;
  } catch {
    return 10;
  }
}

// Counts down from 3s, then keeps counting how far over the learner went.
function Timer({ start, frozen, onOver }: { start: number; frozen: number | null; onOver: () => void }) {
  const [now, setNow] = useState(start);
  const over = useRef(false);
  const cb = useRef(onOver);
  cb.current = onOver;
  useEffect(() => {
    if (frozen !== null) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (!over.current && n - start > QUICK_LIMIT_MS) {
        over.current = true;
        cb.current();
      }
    }, 100);
    return () => clearInterval(t);
  }, [frozen, start]);
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

export default function Quick({ drill }: { drill?: string }) {
  const p = useProgress();
  const weakPoint = drill ? p.weak[drill] : undefined;
  const [making, setMaking] = useState(false);
  const [size, setSize] = useState(10);
  const [round, setRound] = useState<QuickItem[] | null>(null);
  const [retried, setRetried] = useState<Set<string>>(new Set());
  // First-attempt answers the AI judged as wrong in meaning.
  const [off, setOff] = useState<Set<string>>(new Set());
  const judged = useRef<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [shownAt, setShownAt] = useState(0);
  const [spokeAt, setSpokeAt] = useState<number | null>(null);
  const [overtime, setOvertime] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const spokeRef = useRef<number | null>(null);

  useEffect(() => setSize(loadSize()), []);

  const item = round?.[index];

  function show(i: number) {
    setIndex(i);
    setShownAt(Date.now());
    setSpokeAt(null);
    spokeRef.current = null;
    setOvertime(false);
    setHinted(false);
    setResult(null);
    setError("");
  }

  async function makeDrill() {
    if (!weakPoint) return;
    setMaking(true);
    setError("");
    try {
      const res = await fetch("/api/drill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tag: weakPoint.tag, zh: weakPoint.zh, examples: weakPoint.examples }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      saveDrill(weakPoint.tag, { pattern: d.pattern, explain: d.explain_zh, drill: d.items });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "生成练习失败，再试一次");
    } finally {
      setMaking(false);
    }
  }

  // A weak point without practice sentences yet gets them on arrival.
  const needDrill = !!weakPoint && !weakPoint.drill?.length;
  useEffect(() => {
    if (needDrill) makeDrill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needDrill]);

  function begin(n?: number) {
    unlock();
    setRound(weakPoint?.drill?.length ? drillRound(weakPoint).slice(0, n) : quickRound(p, n ?? size));
    setRetried(new Set());
    setOff(new Set());
    judged.current = new Set();
    setResults([]);
    show(0);
  }

  function pickSize(n: number) {
    setSize(n);
    try {
      localStorage.setItem(SIZE_KEY, String(n));
    } catch {}
  }

  function hear(i: QuickItem, rate = 1) {
    unlock();
    play(ttsUrl(i.ja, i.voice), rate).catch(() => setError("原声播放失败"));
  }

  function finish(r: Result) {
    // Only the first attempt in a round counts toward the sentence's record;
    // the retry at the end comes right after seeing the answer.
    const retry = retried.has(r.item.ja);
    if (!retry) recordQuick(r.item, r.ms, r.hinted);
    setResult(r);
    setResults((rs) => [...rs, r]);
    const weak = r.ms === null || r.hinted || r.ms > QUICK_LIMIT_MS;
    if (weak && !retry && round) {
      setRetried((s) => new Set(s).add(r.item.ja));
      setRound([...round, r.item]);
    }
  }

  function onVerdict(r: Result, v: Verdict) {
    // Only the first attempt's verdict changes the record, and only once.
    if (judged.current.has(r.item.ja)) return;
    judged.current.add(r.item.ja);
    if (v !== "off") return;
    setOff((s) => new Set(s).add(r.item.ja));
    markQuickOff(r.item.ja);
    // A quick but wrong answer still needs another go at the end of the round.
    const weak = r.ms === null || r.hinted || r.ms > QUICK_LIMIT_MS;
    if (!weak) {
      setRetried((s) => new Set(s).add(r.item.ja));
      setRound((rd) => (rd ? [...rd, r.item] : rd));
    }
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
    const ms = (spokeRef.current ?? Date.now()) - shownAt;
    setBusy(true);
    setError("");
    try {
      const r = await transcribe(wav, item.ja);
      if (!r.text) {
        setError("没听清，再说一次");
        return;
      }
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      finish({ item, ms, hinted, heard: r.text, score: r.scores?.pron });
    } catch {
      // The reaction time is what this drill measures, so a failed upload shouldn't cost the answer.
      recordSpeech(wavSeconds(wav));
      finish({ item, ms, hinted, sttFailed: true });
    } finally {
      setBusy(false);
    }
  }

  function giveUp() {
    if (!item) return;
    finish({ item, ms: null, hinted });
  }

  function next() {
    stop();
    show(index + 1);
  }

  // The 判定: the AI's verdict on what was said, made stricter by the clock (slow or hinted is at best 惜しい).
  // Nothing said, or no recogniser, shows the answer quietly.
  const first = !!result && results.filter((x) => x.item.ja === result.item.ja).length === 1;
  const judge = useJudge(result?.heard ? { zh: result.item.zh, ja: result.item.ja, where: result.item.where, said: result.heard } : null);
  let kind: Kind | null = null;
  if (result) {
    if (result.ms === null) kind = "wrong";
    else if (!result.heard) kind = "close";
    else {
      const base = judge.data ? kindOf(judge.data.verdict) : judge.failed ? kindByText(result.heard, result.item.ja) : null;
      kind = base === "right" && (result.hinted || result.ms > QUICK_LIMIT_MS) ? "close" : base;
    }
  }
  const verdictOf = judge.data?.verdict;
  useEffect(() => {
    if (result && verdictOf && first) onVerdict(result, verdictOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdictOf]);
  // Once judged: a missed sentence goes into review by itself, and the right one is read out (slower if missed).
  useEffect(() => {
    if (!result || !kind) return;
    const { item: it } = result;
    if (kind === "wrong" && !hasCard(p, it.ja))
      toggleCard({ ja: it.ja, reading: it.reading, zh: it.zh, voice: it.voice, scenarioId: it.scenarioId });
    const t = setTimeout(() => hear(it, kind === "right" ? 1 : 0.85), result.heard ? 600 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, result]);

  // On today's route: a short round starts at once, and the route moves on after its summary.
  const onRoute = useOnRoute();
  // The teacher's 直す stop: a few of the weak point's sentences, as soon as they are there.
  const drillReady = !!weakPoint?.drill?.length;
  useEffect(() => {
    if (onRoute && !round && (!drill || drillReady)) begin(drill ? ROUTE_DRILL : ROUTE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRoute, drillReady]);
  const over = !!round && !item;
  useEffect(() => {
    if (over) stepDone();
  }, [over]);

  // ---- Intro for a targeted drill ----
  if (!round && drill) {
    return (
      <main>
        <div className="row spread">
          <Link href="/weak" className="back">← 苦手</Link>
        </div>
        <header className="page-mast">
          <div>
            <h1>苦手</h1>
            <p className="muted">针对一个薄弱点的瞬间说</p>
          </div>
        </header>
        {!weakPoint ? (
          <div className="card">
            <p style={{ marginTop: 0 }}>找不到这个薄弱点了。</p>
            <Link href="/weak">回薄弱点 →</Link>
          </div>
        ) : (
          <div className="card">
            <div className="weak-tag">{weakPoint.tag}</div>
            <p className="muted" style={{ marginTop: 4 }}>
              {weakPoint.zh} · 错 {weakPoint.miss} 次 · 对 {weakPoint.hit} 次
            </p>
            {weakPoint.examples.slice(0, 2).map((e, i) => (
              <div key={i} className="weak-ex">
                <s>{e.said}</s> → {e.better}
              </div>
            ))}
            {weakPoint.drill?.length ? (
              <>
                {weakPoint.pattern && <div className="pattern">{weakPoint.pattern}</div>}
                {weakPoint.explain && <p>{weakPoint.explain}</p>}
                <button className="primary next-cta" onClick={() => begin()}>
                  开始练 {weakPoint.drill.length} 句
                </button>
                <p style={{ textAlign: "center" }}>
                  <button className="small" onClick={makeDrill} disabled={making}>
                    {making ? "AI 出题中…" : "换一批句子"}
                  </button>
                </p>
              </>
            ) : (
              <p className="muted judge-wait">{making ? "AI 正在讲解并出题…" : ""}</p>
            )}
            {error && (
              <p className="error">
                {error} <button className="small" onClick={makeDrill}>もう一回</button>
              </p>
            )}
          </div>
        )}
      </main>
    );
  }

  // ---- Intro ----
  if (!round) {
    const today = dayKey();
    const t = totals(p, today, today);
    const mastered = quickMastered(p);
    return (
      <main>
        <Link href="/speak" className="back">← 話す</Link>
        <header className="page-mast">
          <div>
            <h1>瞬間</h1>
            <p className="muted">看中文，3 秒内开口</p>
          </div>
        </header>
        <div className="card">
          {(t.quickMs !== null || mastered > 0) && (
            <p className="muted">
              {t.quickMs !== null && `今天已经答了 ${t.quickSpoke} 题，平均 ${secs(t.quickMs)} 秒开口。`}
              {mastered > 0 && `已经练熟 ${mastered} 句。`}
            </p>
          )}
          <div className="row" style={{ marginTop: 0 }}>
            <div className="seg" style={{ flex: 1 }}>
              {SIZES.map((n) => (
                <button key={n} className={size === n ? "on" : ""} onClick={() => pickSize(n)}>
                  {n} 题
                </button>
              ))}
            </div>
          </div>
          <button className="primary next-cta" onClick={() => begin()}>始める</button>
        </div>
      </main>
    );
  }

  // ---- Summary ----
  if (!item) {
    // A sentence retried at the end counts once, by its first attempt.
    const firsts = results.filter((r, i) => results.findIndex((x) => x.item.ja === r.item.ja) === i);
    const spoken = firsts.filter((r) => r.ms !== null && !r.hinted);
    const recalled = spoken.filter((r) => !off.has(r.item.ja));
    // Reaction time counts every answer that was spoken unaided, right or wrong.
    const avg = spoken.length ? spoken.reduce((a, r) => a + r.ms!, 0) / spoken.length : null;
    const fast = recalled.filter((r) => r.ms! <= QUICK_LIMIT_MS).length;
    const today = dayKey();
    const before = totals(p, addDays(today, -7), addDays(today, -1));
    return (
      <main>
        <header className="page-mast">
          <div>
            <h1>瞬間</h1>
            <p className="muted">这一轮的结果</p>
          </div>
        </header>
        <div className="card">
          <div className="kpis">
            <div className="kpi">
              <b>{avg === null ? "–" : `${secs(avg)}s`}</b>
              <span>平均开口</span>
            </div>
            <div className="kpi">
              <b>
                {fast} / {firsts.length}
              </b>
              <span>3 秒内</span>
            </div>
            <div className="kpi">
              <b>{firsts.length - recalled.length}</b>
              <span>没说出·说错</span>
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
              {(() => {
                const first = results.findIndex((x) => x.item.ja === r.item.ja) === i;
                const wrong = first && off.has(r.item.ja);
                return (
                  <span className={r.ms === null || wrong ? "bad" : r.hinted ? "warn" : r.ms <= QUICK_LIMIT_MS ? "good" : "warn"}>
                    {r.ms === null ? "✗" : r.hinted ? "提示" : wrong ? "说错" : `${secs(r.ms)}s`}
                  </span>
                );
              })()}
              <div>
                <div>{r.item.ja}</div>
                <div className="small-text">
                  {r.item.zh}
                  {results.findIndex((x) => x.item.ja === r.item.ja) !== i && " · 再来一次"}
                </div>
              </div>
            </div>
          ))}
        </div>
        {drill ? (
          <>
            <button className="primary next-cta" onClick={() => begin()}>もう一組</button>
            <p style={{ textAlign: "center" }}>
              <Link href="/weak">回薄弱点 →</Link>
            </p>
          </>
        ) : (
          <button className="primary next-cta" onClick={() => begin()}>もう一組</button>
        )}
        <p style={{ textAlign: "center" }}>
          <Link href="/speak" className="muted">話すへ</Link>
        </p>
      </main>
    );
  }

  // ---- One prompt ----
  const hint = (item.reading ?? item.ja).slice(0, HINT_CHARS);
  return (
    <main>
      <div className="row spread">
        <Link href={drill ? `/quick?drill=${encodeURIComponent(drill)}` : "/quick"} className="muted" onClick={() => setRound(null)}>
          ✕
        </Link>
        <div className="progressbar" style={{ flex: 1, margin: "0 12px" }}>
          <div style={{ width: `${(index / round.length) * 100}%` }} />
        </div>
        <StreakPill />
      </div>

      <div className={`card flash ${kind ? `v-${kind}` : ""}`}>
        <Stamp kind={result?.heard ? kind : null} />
        <div className={`prompt ${result ? "asked" : ""}`}>{item.zh}</div>
        {!result ? (
          <>
            <Timer key={shownAt} start={shownAt} frozen={spokeAt} onOver={() => setOvertime(true)} />
            {hinted ? (
              <div className="qhint">{hint}…</div>
            ) : (
              overtime &&
              spokeAt === null && (
                <button className="link-btn" onClick={() => setHinted(true)}>ヒント</button>
              )
            )}
          </>
        ) : (
          result.heard && (
            <button className={`said said-${kind ?? "wait"}`} onClick={() => hear(item)}>
              {kind === "right" ? item.ja : result.heard}
            </button>
          )
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {result ? (
        <VerdictSheet
          key={`${index}-${shownAt}`}
          kind={kind}
          quiet={!result.heard}
          ja={item.ja}
          voice={item.voice}
          why={judge.data}
          note={result.ms !== null ? `${secs(result.ms)} 秒` : undefined}
          onHear={() => hear(item, kind === "right" ? 1 : 0.85)}
          onNext={next}
        />
      ) : (
        <div className="dock" style={{ bottom: 0, zIndex: 20 }}>
          <div className="dock-inner">
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button onClick={giveUp} disabled={busy}>答え</button>
              <div style={{ flex: 1 }}>
                <HoldButton
                  label={busy ? "聞き取り中…" : "🎙 日本語で"}
                  disabled={busy}
                  onStart={onStart}
                  onRecorded={onRecorded}
                  onError={setError}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
