"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { STUCK, type Hito } from "@/lib/hitokoto-model";
import type { DrillStep } from "@/lib/drill-model";
import { judge } from "@/lib/client/drill";
import { addHito, dueHito, explainHito, isDue, isStuck, readHito, recallHito } from "@/lib/client/hitokoto";
import { closeness, verdict, type Kind } from "@/lib/client/fx";
import { play, stop as stopAudio, ttsUrl, unlock } from "@/lib/client/player";
import { recordSpeech, wavSeconds } from "@/lib/client/progress";
import { transcribe } from "@/lib/client/recorder";
import { readSilent, writeSilent } from "@/lib/client/silent";
import HoldButton, { type MicPhase } from "./HoldButton";

const VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";
const TINT = ["#fbe3dc", "#e1ecf8", "#eee4f8", "#e0f1e4", "#fbefcf", "#f3e6d8"];
const INK = ["#9b3a26", "#2f6db0", "#7a4bb0", "#2f8a4c", "#a0700c", "#7a5a3a"];

type Mode = "home" | "loading" | "one" | "recall" | "done";
type Result = { kind: Kind; heard: string; peek?: boolean };

const hear = (ja: string) => play(ttsUrl(ja, VOICE)).catch(() => {});
const asStep = (h: Hito): DrillStep => ({ lv: 1, op: "base", cue: "", cue_zh: "", ja: h.ja, kana: h.kana, zh: h.zh });

// 私の一言: a sentence from the learner's own day. Typed (or said in Chinese), taken apart so every part
// is understood, drilled through its 型, then said again from a situation on days 1, 3 and 7.
export default function Hitokoto() {
  const [mode, setMode] = useState<Mode>("home");
  const [list, setList] = useState<Hito[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [cur, setCur] = useState<Hito | null>(null);
  const [part, setPart] = useState(-1);
  const [queue, setQueue] = useState<Hito[]>([]);
  const [pos, setPos] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mic, setMic] = useState<MicPhase>("idle");
  const [silent, setSilent] = useState(false);
  const [right, setRight] = useState(0);
  const card = useRef(0);
  const firsts = useRef(new Set<string>());

  useEffect(() => {
    setList(readHito());
    setSilent(readSilent());
    const q = new URLSearchParams(location.search);
    if (q.get("go") === "1") {
      const due = dueHito();
      if (due.length) startRecall(due);
      history.replaceState(null, "", "/mine");
    }
    return () => {
      card.current++;
      stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    const s = text.trim();
    if (!s) return;
    unlock();
    setError("");
    setMode("loading");
    try {
      const h = addHito(s, await explainHito(s));
      setText("");
      setList(readHito());
      openOne(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : "出错了");
      setMode("home");
    }
  }

  function openOne(h: Hito) {
    unlock();
    setCur(h);
    setPart(-1);
    setMode("one");
  }

  function startRecall(hs: Hito[]) {
    unlock();
    card.current++;
    stopAudio();
    firsts.current.clear();
    setQueue(hs);
    setPos(0);
    setRight(0);
    setResult(null);
    setReveal(false);
    setMode("recall");
  }

  const h = mode === "recall" ? queue[pos] : null;

  function show(kind: Kind, heard: string, peek = false, play = true) {
    if (!h) return;
    verdict(kind, peek, false);
    setResult({ kind, heard, peek });
    setReveal(false);
    // The first try at each sentence is the one that counts for when it comes back.
    if (!firsts.current.has(h.id)) {
      firsts.current.add(h.id);
      recallHito(h.id, kind === "right");
      if (kind === "right") setRight((r) => r + 1);
    }
    if (play) hear(h.ja);
  }

  async function onRecorded(wav: Blob) {
    if (!h) return;
    const c = card.current;
    setBusy(true);
    setError("");
    try {
      const r = await transcribe(wav, h.ja);
      if (c !== card.current) return;
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      if (!r.text) return setError("聞き取れませんでした");
      let kind = judge(r, asStep(h));
      // Said the way for another listener (同僚 for 上司): right too.
      if (kind !== "right" && h.versions.some((v) => closeness(r.text, v.ja) >= 0.85)) kind = "right";
      show(kind, r.text);
    } catch {
      setError("聞き取れませんでした");
    } finally {
      setBusy(false);
    }
  }

  function next() {
    card.current++;
    stopAudio();
    setResult(null);
    setReveal(false);
    if (pos + 1 < queue.length) return setPos((p) => p + 1);
    setList(readHito());
    setMode("done");
  }

  function toggleSilent() {
    writeSilent(!silent);
    setSilent(!silent);
  }

  function home() {
    card.current++;
    stopAudio();
    setList(readHito());
    setMode("home");
  }

  const silentBtn = (
    <button className={`hi-silent${silent ? " on" : ""}`} aria-pressed={silent} onClick={toggleSilent}>
      {silent ? "🔇 声なし" : "🔈 声あり"}
    </button>
  );

  // ---- home ----
  if (mode === "home" || mode === "loading") {
    const due = list.filter((x) => isDue(x));
    return (
      <main className="dr">
        <Link href="/speak" className="back" aria-label="戻る">←</Link>
        <h1 className="dr-title">私の一言</h1>
        {error && <p className="error">{error}</p>}
        <form
          className="dr-input"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="さっき電話に出られなくて、すみません"
            aria-label="言った一言"
            maxLength={80}
            enterKeyHint="go"
            autoFocus={!list.length}
            disabled={mode === "loading"}
          />
          <button type="submit" disabled={mode === "loading" || !text.trim()} aria-label="追加">
            {mode === "loading" ? <span className="dr-spin" /> : "＋"}
          </button>
        </form>
        {mode === "loading" && (
          <div className="dr-making" aria-label="作成中">
            {[0, 1, 2, 3].map((k) => (
              <i key={k} style={{ animationDelay: `${k * 0.18}s` }} />
            ))}
          </div>
        )}
        {mode === "home" && due.length > 0 && (
          <button className="dr-next" onClick={() => startRecall(due)}>
            <span>
              <b>思い出す</b>
              <small>{due.length} 文</small>
            </span>
            <i aria-hidden>▶</i>
          </button>
        )}
        {mode === "home" && list.length > 0 && (
          <div className="pl-grid hi-list">
            {list.map((x) => (
              <button key={x.id} className="pl two" onClick={() => openOne(x)}>
                <span className="pl-text">
                  <b>{x.ja}</b>
                  <span>{x.zh}</span>
                </span>
                <Dots h={x} />
              </button>
            ))}
          </div>
        )}
      </main>
    );
  }

  // ---- one sentence, taken apart ----
  if (mode === "one" && cur) {
    const p = part >= 0 ? cur.parts[part] : null;
    return (
      <main className="dr hi-one">
        <button className="back" aria-label="戻る" onClick={home}>←</button>
        <section className="hi-card">
          <p className="hi-ja">
            {cur.parts.map((x, k) => (
              <button
                key={k}
                className={`hi-part${k === part ? " on" : ""}`}
                style={{ background: TINT[k % TINT.length], color: INK[k % INK.length] }}
                onClick={() => setPart(k === part ? -1 : k)}
              >
                {x.ja}
              </button>
            ))}
            <button className="hi-play" aria-label="聞く" onClick={() => hear(cur.ja)}>▶</button>
          </p>
          <p className="dr-zh" lang="zh-Hans">{cur.zh}</p>
          {cur.fix_zh && <p className="hi-fix" lang="zh-Hans">! {cur.fix_zh}</p>}
          {p ? (
            <div className="hi-note" style={{ borderColor: INK[part % INK.length] }}>
              <b style={{ color: INK[part % INK.length] }}>{p.ja}</b>
              <span lang="zh-Hans">{p.zh}</span>
              <p lang="zh-Hans">{p.note_zh}</p>
            </div>
          ) : (
            <div className="hi-parts">
              {cur.parts.map((x, k) => (
                <button key={k} className="hi-chip" onClick={() => setPart(k)}>
                  <i style={{ background: INK[k % INK.length] }} />
                  <b>{x.ja}</b>
                  <span lang="zh-Hans">{x.zh}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="pl-grid hi-vers">
          {cur.versions.map((v) => (
            <button key={v.to} className="pl two" onClick={() => hear(v.ja)}>
              <em>{v.to.split("・")[0]}</em>
              <span className="pl-text">
                <b>{v.ja}</b>
                <span>{v.zh}</span>
              </span>
            </button>
          ))}
          {cur.reply_ja && (
            <button className="pl two" onClick={() => hear(cur.reply_ja)}>
              <em>続けて</em>
              <span className="pl-text">
                <b>{cur.reply_ja}</b>
                <span>{cur.reply_zh}</span>
              </span>
            </button>
          )}
        </div>

        <div className="dr-dock">
          <div className="dr-btns">
            <Link className="dr-ghost hi-kata" href={`/drill?s=${encodeURIComponent(cur.kata)}`}>
              型ドリル
            </Link>
            <button className="dr-go" onClick={() => startRecall([cur])}>言ってみる</button>
          </div>
        </div>
      </main>
    );
  }

  // ---- done ----
  if (mode === "done") {
    const all = right === queue.length;
    return (
      <main className="dr">
        <button className="back" aria-label="戻る" onClick={home}>←</button>
        <h1 className="dr-title">私の一言</h1>
        <div className={`dr-score${all ? " all" : ""}`}>
          <b>✓ {right}</b>
          <span>/ {queue.length}</span>
        </div>
        <div className="dr-list">
          {queue.map((x) => {
            const now = readHito().find((y) => y.id === x.id) ?? x;
            return (
              <button key={x.id} className="dr-row" onClick={() => hear(x.ja)}>
                <span>
                  {x.ja}
                  <small>{x.zh}</small>
                </span>
                <Dots h={now} />
              </button>
            );
          })}
        </div>
        <div className="dr-foot">
          <button className="dr-go" onClick={home}>一覧</button>
        </div>
      </main>
    );
  }

  // ---- recall: from the situation, the whole sentence ----
  if (!h) return null;
  return (
    <main className="dr dr-play op-add">
      <div className="dr-top">
        <button className="dr-x" aria-label="閉じる" onClick={home}>×</button>
        <div className="dr-lvs" aria-label={`${pos + 1}/${queue.length}`}>
          {queue.map((x, k) => (
            <i key={x.id} className={k < pos ? "d" : k === pos ? "n" : ""}>{k + 1}</i>
          ))}
        </div>
        {silentBtn}
      </div>

      <section className="dr-card">
        <div className="dr-cue hi-scene">
          <span className="dr-op" aria-hidden>💬</span>
          <b lang="zh-Hans">{h.scene_zh}</b>
        </div>
      </section>

      <section className={`dr-ans${result ? ` is-${result.kind}` : ""}`}>
        {result || reveal ? (
          <>
            {result && (
              <div className="dr-mark" aria-label={result.kind === "right" ? "正解" : result.kind === "close" ? "惜しい" : "答え"}>
                {result.kind === "right" ? "✓" : result.kind === "close" ? "△" : result.peek ? "答え" : "✕"}
              </div>
            )}
            <p className="dr-ja" onClick={() => hear(h.ja)}>{h.ja}</p>
            <p className="dr-zh" lang="zh-Hans">{h.zh}</p>
            {result?.heard && result.kind !== "right" && <p className="dr-heard">{result.heard}</p>}
          </>
        ) : (
          <div className={`dr-blank${busy ? "" : ` mic-${mic}`}`} aria-live="polite">
            {busy ? (
              <span className="dr-spin dark" role="img" aria-label="判定中" />
            ) : silent ? (
              <span className="dr-think" aria-hidden>🤫</span>
            ) : mic === "live" ? (
              <b>話して</b>
            ) : mic === "starting" ? (
              <b>待って…</b>
            ) : (
              <span aria-hidden>？</span>
            )}
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      <div className="dr-dock">
        <div className="dr-btns">
          {result ? (
            <>
              {result.kind !== "right" && (
                <button className="dr-ghost" onClick={() => { card.current++; stopAudio(); setResult(null); }}>
                  もう一回
                </button>
              )}
              <button className="dr-go" onClick={next}>次へ</button>
            </>
          ) : reveal ? (
            <>
              <button className="dr-ghost hi-no" onClick={() => show("wrong", "", false, false)}>✕ 違った</button>
              <button className="dr-go hi-yes" onClick={() => show("right", "", false, false)}>✓ 言えた</button>
            </>
          ) : silent ? (
            <>
              <button className="dr-ghost" onClick={() => show("wrong", "", true)}>答え</button>
              <button
                className="dr-go"
                onClick={() => {
                  setReveal(true);
                  hear(h.ja);
                }}
              >
                頭で言えた
              </button>
            </>
          ) : (
            <>
              <button className="dr-ghost" onClick={() => show("wrong", "", true)} disabled={busy}>答え</button>
              <div className="dr-mic">
                <HoldButton label={busy ? "…" : "● 話す"} disabled={busy} onPhase={setMic} onRecorded={onRecorded} onError={setError} />
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

// How far along: one dot per right recall to 定着 (days 1, 3, 7), ✓ once it has stuck; ● today when due.
function Dots({ h }: { h: Hito }) {
  if (isStuck(h)) return <span className="hi-dots stuck" aria-label="定着">✓</span>;
  return (
    <span className={`hi-dots${isDue(h) ? " due" : ""}`} aria-label={`${h.step}/${STUCK}`}>
      {Array.from({ length: STUCK }, (_, k) => (
        <i key={k} className={k < h.step ? "on" : ""} />
      ))}
    </span>
  );
}
