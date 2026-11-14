"use client";

import { useEffect, useRef, useState } from "react";
import { ASK_VOICE } from "@/content/kokoro-patterns";
import { LEVELS, tierOf, type DrillReply, type Ladder } from "@/lib/drill-model";
import { checkOwn, judge, replyFastMs, replyStep } from "@/lib/client/drill";
import { flowOf } from "@/lib/client/fluency";
import { verdict, type Kind } from "@/lib/client/fx";
import { play, preload, stop as stopAudio, ttsUrl } from "@/lib/client/player";
import { recordReply, recordSpeech, wavSeconds } from "@/lib/client/progress";
import { transcribe } from "@/lib/client/recorder";
import HoldButton, { type MicPhase } from "./HoldButton";

const VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";
// Reaction time as if the answer were 12 characters, as the speed round counts it.
const scaled = (ms: number, ja: string) => Math.round((ms * (2000 + 60 * 12)) / (2000 + 60 * ja.length));

// One line of a round, as it went at the first try. said: the learner's words; better: them made
// natural (a question about the learner, only when they needed it).
export type ReplyRun = { r: DrillReply; kind: Kind; ms: number | null; fast: boolean; said: string; better: string };
type Result = { kind: Kind; heard: string; ms: number | null; fast: boolean; peek: boolean; better: string; fix_zh: string };

// 返す: 森先生 says a line, nothing of it on screen (字 shows it, and then the answer no longer counts as
// fast), and the learner answers with the word or grammar point just practised: first from what to say
// in Chinese, then about themselves, where any true answer that uses it and is finished is right. The
// clock runs from the end of her line.
export default function ReplyRound({ ladder, round, onAct, onClose, onDone }: { ladder: Ladder; round: DrillReply[]; onAct: () => void; onClose: () => void; onDone: (runs: ReplyRun[]) => void }) {
  const [pos, setPos] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [mic, setMic] = useState<MicPhase>("idle");
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  // Her line heard to its end (or read): the mic opens and the clock starts.
  const [asked, setAsked] = useState(false);
  const [shown, setShown] = useState(false);
  // Her line wouldn't play by itself (the phone wants a tap first).
  const [tap, setTap] = useState(false);
  const t = useRef({ card: 0, plays: 0, askedAt: 0, live: 0, first: true, hinted: false, next: 0 as ReturnType<typeof setTimeout> | 0, runs: [] as ReplyRun[] }).current;
  const r = round[pos];
  const tier = tierOf(ladder);

  function ask() {
    onAct();
    const card = t.card;
    const mine = ++t.plays;
    setTap(false);
    setAsking(true);
    play(ttsUrl(r.ask, ASK_VOICE)).then(
      () => {
        if (card !== t.card || mine !== t.plays) return;
        setAsking(false);
        heard();
      },
      () => {
        if (card !== t.card || mine !== t.plays) return;
        setAsking(false);
        setTap(true);
      },
    );
  }

  function heard() {
    if (t.askedAt) return;
    t.askedAt = Date.now();
    setAsked(true);
  }

  // A new line: said at once.
  useEffect(() => {
    t.askedAt = 0;
    t.live = 0;
    t.first = true;
    t.hinted = false;
    setAsked(false);
    setShown(false);
    setError("");
    ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  useEffect(() => {
    preload(round.flatMap((x) => [ttsUrl(x.ask, ASK_VOICE), ttsUrl(x.ja, VOICE)]));
    return () => {
      t.card++;
      stopAudio();
      if (t.next) clearTimeout(t.next);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hear = (ja: string) => play(ttsUrl(ja, VOICE)).catch(() => {});

  function read() {
    onAct();
    t.hinted = true;
    setShown(true);
    heard();
  }

  async function onRecorded(wav: Blob) {
    const card = t.card;
    const live = t.live;
    onAct();
    setBusy(true);
    setError("");
    try {
      const flow = await flowOf(wav).catch(() => null);
      const ms = live && t.askedAt && flow?.runs.length ? Math.max(0, Math.round(live + flow.runs[0][0] * 1000 - t.askedAt)) : null;
      const stt = await transcribe(wav, r.own ? undefined : r.ja);
      if (card !== t.card) return;
      recordSpeech(wavSeconds(wav), r.own ? undefined : stt.scores?.pron);
      if (!stt.text) {
        setError("聞き取れませんでした");
        return;
      }
      if (!r.own) return show(judge(stt, replyStep(r)), stt.text, ms);
      const own = await checkOwn(ladder.seed, r, stt.text);
      if (card !== t.card) return;
      show(own.kind, stt.text, ms, false, own.better, own.fix_zh);
    } catch {
      if (card === t.card) setError("聞き取れませんでした");
    } finally {
      setBusy(false);
    }
  }

  function show(kind: Kind, said: string, ms: number | null, peek = false, better = "", fix_zh = "") {
    verdict(kind, peek, false);
    // From hearing alone, at the first try: the only answers that are timed.
    const timed = t.first && kind === "right" && ms !== null && !t.hinted;
    const fast = timed && ms! <= replyFastMs(r, tier);
    if (t.first) {
      t.runs.push({ r, kind, ms: timed ? ms : null, fast, said, better });
      if (!peek) recordReply({ ms: timed ? scaled(ms!, r.ja) : undefined, own: r.own, ok: kind === "right" });
    }
    t.first = false;
    setResult({ kind, heard: said, ms: timed ? ms : null, fast, peek, better, fix_zh });
    const card = t.card;
    const on = (wait: number) => card === t.card && (t.next = setTimeout(next, wait));
    // Her answer (or the learner's own, made natural) is heard; a right one then goes on by itself,
    // unless there is something of theirs to look at.
    if (r.own && !peek && kind === "right" && !better) on(900);
    else if (r.own && !peek && better) hear(better);
    else hear(r.ja).then(() => kind === "right" && on(500));
  }

  function peek() {
    onAct();
    stopAudio();
    heard();
    show("wrong", "", null, true);
  }

  function retry() {
    onAct();
    t.card++;
    stopAudio();
    setResult(null);
    t.askedAt = Date.now();
    t.live = 0;
  }

  function next() {
    t.card++;
    if (t.next) clearTimeout(t.next);
    t.next = 0;
    stopAudio();
    setResult(null);
    if (pos + 1 < round.length) setPos(pos + 1);
    else onDone(t.runs);
  }

  if (!r) return null;
  const at = r.mark ? r.ja.indexOf(r.mark) : -1;
  const model = (
    <p className="dr-ja" onClick={() => hear(r.ja)}>
      {at < 0 ? r.ja : r.ja.slice(0, at)}
      {at >= 0 && <span className="dr-new">{r.mark}</span>}
      {at >= 0 && r.ja.slice(at + r.mark.length)}
    </p>
  );
  const won = result?.kind === "right";

  return (
    <main className="dr dr-play op-reply">
      <div className="dr-top">
        <button className="dr-x" aria-label="閉じる" onClick={onClose}>×</button>
        <div className="dr-lvs" aria-label="返す">
          {Array.from({ length: LEVELS }, (_, k) => (
            <i key={k} className="d">{k + 1}</i>
          ))}
          <i className="d bolt">⚡</i>
          <i className="n">返</i>
        </div>
        <span className="dr-combo-sp" />
      </div>
      <div className="dr-bar" aria-hidden>
        <i style={{ width: `${((pos + (result ? 1 : 0)) / round.length) * 100}%` }} />
      </div>

      <section className={`dr-card re-card${won ? " won" : ""}`} key={pos}>
        <div className="re-who">
          <span className="re-av" aria-hidden>森</span>
          <button className={`re-play${asking ? " on" : ""}${tap ? " tap" : ""}`} aria-label="もう一度聞く" onClick={ask}>
            {asking ? (
              <span className="dr-wave" aria-hidden>
                {[0, 1, 2].map((k) => (
                  <i key={k} style={{ animationDelay: `${[0.2, 0, 0.3][k]}s` }} />
                ))}
              </span>
            ) : (
              "▶"
            )}
          </button>
          {shown || result ? (
            <p className="re-ask">
              {r.ask}
              <small lang="zh-Hans">{r.ask_zh}</small>
            </p>
          ) : (
            <>
              <span className="re-gap" />
              <button className="re-ji" aria-label="文字を見る" onClick={read}>字</button>
            </>
          )}
        </div>
        {!r.own && <b className="re-zh" lang="zh-Hans">{r.zh}</b>}
        <div className="re-tags">
          {r.own && <i>自分のこと</i>}
          <span>{ladder.seed}</span>
        </div>
        {asked && !result && !busy && <div className="dr-clock" style={{ animationDuration: `${replyFastMs(r, tier)}ms` }} aria-hidden />}
      </section>

      <section className={`dr-ans${result ? ` is-${result.kind}` : ""}`}>
        {result ? (
          <>
            <div className="dr-mark" aria-label={won ? "正解" : result.kind === "close" ? "惜しい" : "答え"}>
              {won ? "✓" : result.kind === "close" ? "△" : result.peek ? "答え" : "✕"}
              {won && result.ms !== null && (
                <em>
                  {result.fast ? "⚡ " : ""}
                  {(result.ms / 1000).toFixed(1)}s
                </em>
              )}
            </div>
            {r.own && !result.peek ? (
              <>
                <p className={`dr-ja re-said${result.better || !won ? " was" : ""}`}>{result.heard}</p>
                {result.better ? (
                  <p className="dr-ja re-better" onClick={() => hear(result.better)}>{result.better}</p>
                ) : (
                  !won && model
                )}
                {result.fix_zh && <p className="dr-zh" lang="zh-Hans">{result.fix_zh}</p>}
              </>
            ) : (
              <>
                {model}
                {result.heard && !won && <p className="dr-heard">{result.heard}</p>}
              </>
            )}
          </>
        ) : (
          <div className={`dr-blank${busy ? "" : ` mic-${mic}`}`} aria-live="polite">
            {busy ? (
              <span className="dr-spin dark" role="img" aria-label="判定中" />
            ) : mic === "live" ? (
              <>
                <span className="dr-wave" aria-hidden>
                  {[0, 1, 2, 3, 4].map((k) => (
                    <i key={k} style={{ animationDelay: `${[0.2, 0, 0.35, 0.1, 0.25][k]}s` }} />
                  ))}
                </span>
                <b>話して</b>
              </>
            ) : mic === "starting" ? (
              <b>待って…</b>
            ) : !asked ? (
              <b className="re-listen">聞いて</b>
            ) : (
              <span aria-hidden>？</span>
            )}
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      <div className="dr-dock">
        {result ? (
          <div className="dr-btns">
            {!won && <button className="dr-ghost" onClick={retry}>もう一回</button>}
            <button className="dr-go" onClick={next}>次へ</button>
          </div>
        ) : (
          <div className="dr-btns">
            <button className="dr-ghost" onClick={peek} disabled={busy}>答え</button>
            <div className="dr-mic">
              <HoldButton
                label={busy ? "…" : "● 話す"}
                disabled={busy || !asked}
                onStart={() => {
                  // Her line said again while the answer starts: stopped, so the mic doesn't take it.
                  t.plays++;
                  setAsking(false);
                  stopAudio();
                }}
                onLive={() => {
                  t.live = Date.now();
                  onAct();
                }}
                onPhase={setMic}
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
