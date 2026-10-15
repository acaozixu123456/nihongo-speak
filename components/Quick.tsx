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
  weakList,
  type QuickItem,
} from "@/lib/client/progress";
import { totals } from "@/lib/client/metrics";
import { addDays } from "@/lib/progress-model";
import AiJudge, { type Verdict } from "./AiJudge";
import HoldButton from "./HoldButton";
import Nav from "./Nav";

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

const secs = (ms: number) => (ms / 1000).toFixed(1);

function tone(score: number) {
  return score >= 80 ? "good" : score >= 60 ? "warn" : "bad";
}

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
  // After the answer is shown: cover it and say it again from memory.
  const [again, setAgain] = useState<"off" | "covered" | { heard: string; score?: number; ok?: boolean }>("off");
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
    setAgain("off");
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

  function begin(n = size) {
    unlock();
    setRound(weakPoint?.drill?.length ? drillRound(weakPoint) : quickRound(p, n));
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

  function hear(i: QuickItem) {
    unlock();
    play(ttsUrl(i.ja, i.voice), 1).catch(() => setError("原声播放失败，可以再点一次「听原声」"));
  }

  function finish(r: Result) {
    // Only the first attempt in a round counts toward the sentence's record;
    // the retry at the end comes right after seeing the answer.
    const retry = retried.has(r.item.ja);
    if (!retry) recordQuick(r.item, r.ms, r.hinted);
    setResult(r);
    setResults((rs) => [...rs, r]);
    hear(r.item);
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
        setError("没听清，再按住说一次");
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

  async function onAgain(wav: Blob) {
    if (!item) return;
    setBusy(true);
    setError("");
    try {
      const r = await transcribe(wav, item.ja);
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      setAgain({ heard: r.text || "（没听清）", score: r.scores?.pron, ok: !!r.text });
    } catch {
      recordSpeech(wavSeconds(wav));
      setAgain({ heard: "（识别失败，自己对照一下）" });
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

  // ---- Intro for a targeted drill ----
  if (!round && drill) {
    return (
      <main>
        <div className="row spread">
          <Link href="/weak" className="muted">← 薄弱点</Link>
        </div>
        <header className="page-mast">
          <h1>強化</h1>
          <p className="muted">针对一个薄弱点的瞬间说</p>
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
                {error} <button className="small" onClick={makeDrill}>重试</button>
              </p>
            )}
          </div>
        )}
        <Nav on="review" />
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
        <header className="page-mast">
          <h1>瞬間</h1>
          <p className="muted">瞬间说 · 看中文，3 秒内开口</p>
        </header>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            真实对话里只有一两秒反应时间。每题给你一句中文和它出现的场合，<strong>3 秒内按住按钮开口</strong>
            ，说完对照标准说法。
          </p>
          <p className="muted">
            不用和答案一模一样，意思对、先说出来最重要。说不出来的句子，这一轮最后会再出现一次，之后几天也会优先出现，直到能连续三次 3 秒内说出来。
          </p>
          {(t.quickMs !== null || mastered > 0) && (
            <p className="muted">
              {t.quickMs !== null && `今天已经答了 ${t.quickSpoke} 题，平均 ${secs(t.quickMs)} 秒开口。`}
              {mastered > 0 && `已经练熟 ${mastered} 句。`}
            </p>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <span className="muted">每轮</span>
            <div className="seg" style={{ flex: 1 }}>
              {SIZES.map((n) => (
                <button key={n} className={size === n ? "on" : ""} onClick={() => pickSize(n)}>
                  {n} 题
                </button>
              ))}
            </div>
          </div>
          <button className="primary next-cta" onClick={() => begin()}>开始</button>
        </div>
        <WeakTeaser />
        <Nav on="review" />
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
            <button className="primary next-cta" onClick={() => begin()}>这个点再练一轮</button>
            <p style={{ textAlign: "center" }}>
              <Link href="/weak">回薄弱点 →</Link>
            </p>
          </>
        ) : (
          <>
            <WeakTeaser />
            <button className="primary next-cta" onClick={() => begin()}>再来一轮</button>
          </>
        )}
        <p style={{ textAlign: "center" }}>
          <Link href="/" className="muted">回到今天</Link>
        </p>
        <Nav on="review" />
      </main>
    );
  }

  // ---- One prompt ----
  const saved = hasCard(p, item.ja);
  const comingBack = result && round.slice(index + 1).some((i) => i.ja === item.ja);
  const hint = (item.reading ?? item.ja).slice(0, HINT_CHARS);
  return (
    <main>
      <div className="row spread">
        <Link href={drill ? `/quick?drill=${encodeURIComponent(drill)}` : "/quick"} className="muted" onClick={() => setRound(null)}>
          ← 退出
        </Link>
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
        {!result && (
          <>
            <Timer key={shownAt} start={shownAt} frozen={spokeAt} onOver={() => setOvertime(true)} />
            {hinted ? (
              <div className="qhint">开头：{hint}…</div>
            ) : (
              overtime &&
              spokeAt === null && (
                <button className="small" style={{ marginTop: 10 }} onClick={() => setHinted(true)}>
                  💡 给个开头
                </button>
              )
            )}
          </>
        )}
        {result && (
          <>
            <div className="qtime">
              {result.ms === null ? (
                <span className="bad">这次没说出来，没关系</span>
              ) : result.hinted ? (
                <span className="warn">看了提示后 {secs(result.ms)} 秒开口</span>
              ) : (
                <span className={result.ms <= QUICK_LIMIT_MS ? "good" : "warn"}>{secs(result.ms)} 秒开口</span>
              )}
            </div>
            {again === "covered" ? (
              <p className="muted">答案盖住了。不看原文，按住再说一遍。</p>
            ) : (
              <>
                <div className="answer">{item.ja}</div>
                {item.reading && <div className="kana">{item.reading}</div>}
              </>
            )}
            {result.heard && again === "off" && (
              <p className="muted">
                你说：{result.heard}
                {result.score !== undefined && (
                  <>
                    {" "}· <strong className={tone(result.score)}>发音 {result.score}</strong>
                  </>
                )}
              </p>
            )}
            {result.heard && again === "off" && (
              <AiJudge
                zh={item.zh}
                ja={item.ja}
                where={item.where}
                said={result.heard}
                voice={item.voice}
                onVerdict={results.filter((x) => x.item.ja === item.ja).length === 1 ? (v) => onVerdict(result, v) : undefined}
              />
            )}
            {result.sttFailed && again === "off" && <p className="muted">这次没连上识别服务，计时照样记下了。自己对照一下答案。</p>}
            {typeof again === "object" && (
              <p className="muted">
                再说一遍：{again.heard}
                {again.score !== undefined && (
                  <>
                    {" "}· <strong className={tone(again.score)}>发音 {again.score}</strong>
                  </>
                )}
              </p>
            )}
            {typeof again === "object" && again.ok && (
              <AiJudge zh={item.zh} ja={item.ja} where={item.where} said={again.heard} voice={item.voice} />
            )}
            {comingBack && <p className="small-text">这句本轮最后会再出现一次。</p>}
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
          {!result ? (
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
          ) : again === "covered" ? (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button onClick={() => setAgain("off")} disabled={busy}>算了</button>
              <div style={{ flex: 1 }}>
                <HoldButton label={busy ? "识别中…" : "按住再说一遍"} disabled={busy} onRecorded={onAgain} onError={setError} />
              </div>
            </div>
          ) : (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              {again === "off" && (
                <button style={{ flex: 1, padding: 14 }} onClick={() => { stop(); setAgain("covered"); }}>
                  🙈 盖住再说
                </button>
              )}
              <button className="primary" style={{ flex: 1, padding: 14 }} onClick={next}>
                {index + 1 < round.length ? "下一题 →" : "看结果"}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// The shakiest grammar points so far, with a way into their drills.
function WeakTeaser() {
  const p = useProgress();
  const list = weakList(p).slice(0, 3);
  if (!list.length) return null;
  return (
    <div className="card">
      <div className="row spread">
        <strong>AI 发现的薄弱点</strong>
        <Link href="/weak" className="small-text">全部 →</Link>
      </div>
      {list.map((w) => (
        <Link key={w.tag} href={`/quick?drill=${encodeURIComponent(w.tag)}`} className="weak-row">
          <div className="row spread">
            <span className="weak-tag">{w.tag}</span>
            <span className="small-text" style={{ color: "var(--accent)" }}>强化 →</span>
          </div>
          <div className="small-text">
            {w.zh} · 错 {w.miss} 次
          </div>
        </Link>
      ))}
    </div>
  );
}
