"use client";

import Link from "next/link";
import { heardToday, stepDone } from "@/lib/client/route";
import { useEffect, useRef, useState } from "react";
import { calls, callTalk, type Call as CallDef, type Prime, type TodayTopic } from "@/content/calls";
import type { Feedback, Turn } from "@/lib/claude";
import { play, stop, ttsUrl, unlock } from "@/lib/client/player";
import { LiveStopped, liveReply, stopLive, unlockLive } from "@/lib/client/live";
import { transcribe } from "@/lib/client/recorder";
import { knownTags, memories, primePoint, recordFeedback, recordPoints, recordSpeech, recordTalkTurn, remember, useProgress, wavSeconds } from "@/lib/client/progress";
import FeedbackCard from "./FeedbackCard";
import { SenseiLine } from "./Sensei";
import HoldButton from "./HoldButton";

// audio: Gemini Live's own recording of the line, for 再听一遍.
type Message = Turn & { zh?: string; audio?: string };
type Phase = "ready" | "live" | "ended";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "出错了");
  return data as T;
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function CallList() {
  return (
    <main>
      <Link href="/" className="back">← 今日</Link>
      <header className="page-mast">
        <div>
          <h1>電話</h1>
          <p className="muted">只有声音，默认不显示文字。听不清就说「もう一度お願いします」。</p>
        </div>
      </header>
      {/* Grouped by direction instead of a 電/受 badge on every row. */}
      {[
        { ja: "かける", zh: "我打出去", list: calls.filter((c) => !c.incoming) },
        { ja: "かかってくる", zh: "别人打来", list: calls.filter((c) => c.incoming) },
      ].map((g) => (
        <section key={g.ja}>
          <h2 className="pl-head">
            {g.ja}
            <small>{g.zh}</small>
          </h2>
          <div className="pl-grid">
            {g.list.map((c) => (
              <Link key={c.id} href={`/call/${c.id}`} className="pl two">
                <div className="pl-text">
                  <b>{c.title}</b>
                  <span>
                    {c.who} · {c.titleZh}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

// When the call is one round of 予行演習: the useful lines to show before it, and what comes after it.
export type RoundProps = {
  round: number;
  total: number;
  lines: { ja: string; zh: string }[];
  next?: string; // what the other side will do in the next round, on its button
  back: string;
  onHangUp: () => void;
  onNext: () => void;
};

// One phone call: the other side is a voice; subtitles cost a tap and are counted.
export default function Call({ call, round }: { call: CallDef; round?: RoundProps }) {
  const p = useProgress();
  // The character's personality, what they remember from earlier calls, and the learner's shakiest point
  // (which they slip into their own lines) go along with every request. Picked when the call starts.
  const [prime, setPrime] = useState<Prime | null>(null);
  const [today, setToday] = useState<TodayTopic | null>(null);
  const talk = callTalk(call, call.person ? memories(p, call.person) : [], prime, today);
  const scenarioId = `call:${call.id}`;
  const [phase, setPhase] = useState<Phase>("ready");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState<"" | "stt" | "ai" | "feedback">("");
  const [speaking, setSpeaking] = useState(false);
  const [subs, setSubs] = useState(false);
  const [peeks, setPeeks] = useState(0);
  const [replays, setReplays] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [endedAt, setEndedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState("");
  // Replies come from Gemini Live until it fails once in a call; then the old chain takes over.
  const liveOn = useRef(true);
  // False once the call is hung up or the page left: answers still on their way are dropped.
  const open = useRef(false);

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(
    () => () => {
      open.current = false;
      stop();
      stopLive();
    },
    [],
  );

  const history = (list: Message[]): Turn[] => list.map(({ role, text }) => ({ role, text }));
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  const said = messages.filter((m) => m.role === "user").length;

  async function say(text: string) {
    setSpeaking(true);
    try {
      await play(ttsUrl(text, talk.aiVoice), 1);
    } catch {
      setError("音频播放失败");
    } finally {
      setSpeaking(false);
    }
  }

  function pickUp() {
    unlock();
    unlockLive();
    liveOn.current = true;
    open.current = true;
    setPrime(primePoint(p));
    // The episode heard today, with a few of its key sentences to give a reason to use.
    const ep = heardToday(p);
    setToday(ep ? { title: ep.title_ja ?? ep.title_zh, phrases: ep.phrases.slice(0, 3).map((x) => x.ja) } : null);
    const first: Message = { role: "assistant", text: talk.opening.ja, zh: talk.opening.zh };
    setMessages([first]);
    setPhase("live");
    setStartedAt(Date.now());
    setNow(Date.now());
    setFeedback(null);
    setPeeks(0);
    setReplays(0);
    setSubs(false);
    setError("");
    say(first.text);
  }

  async function onRecorded(wav: Blob) {
    setError("");
    stop();
    stopLive();
    if (liveOn.current && (await replyLive(wav))) return;
    setBusy("stt");
    try {
      const { text } = await transcribe(wav);
      if (!open.current) return;
      if (!text) {
        setBusy("");
        setError("没听清，再说一次");
        return;
      }
      recordSpeech(wavSeconds(wav));
      const next = [...messages, { role: "user" as const, text }];
      setMessages(next);
      setBusy("ai");
      const reply = await post<{ ja: string; zh: string; finished: boolean }>("/api/chat", { scenarioId, talk, history: history(next) });
      if (!open.current) return;
      setMessages([...next, { role: "assistant", text: reply.ja, zh: reply.zh }]);
      recordTalkTurn();
      setBusy("");
      say(reply.ja);
    } catch (e) {
      setBusy("");
      setError(e instanceof Error ? e.message : "出错了");
    }
  }

  // Gemini Live hears the recording and answers in its own voice in one step. False when it
  // failed, so the caller falls back to speech recognition + Claude + TTS.
  async function replyLive(wav: Blob) {
    setBusy("ai");
    try {
      const r = await liveReply({ scenarioId, talk, history: history(messages) }, wav, () => {
        setBusy("");
        setSpeaking(true);
      });
      recordSpeech(wavSeconds(wav));
      recordTalkTurn();
      setMessages([
        ...messages,
        { role: "user", text: r.heard || "（聞き取れませんでした）" },
        { role: "assistant", text: r.said, audio: URL.createObjectURL(r.audio) },
      ]);
      await r.played.catch(() => setError("音频播放失败"));
      setSpeaking(false);
      return true;
    } catch (e) {
      // Hung up or left while the answer was coming: nothing more to do.
      if (e instanceof LiveStopped || !open.current) {
        setSpeaking(false);
        return true;
      }
      console.warn("Gemini Live failed, falling back", e);
      // A refused request (no key, credit used up) won't get better in this call; a missed reply might.
      if (e instanceof Error && e.message.startsWith("live ")) liveOn.current = false;
      setBusy("");
      setSpeaking(false);
      return false;
    }
  }

  async function hangUp() {
    open.current = false;
    stop();
    stopLive();
    setEndedAt(Date.now());
    setPhase("ended");
    if (round) round.onHangUp();
    else stepDone();
    if (!said) return;
    setBusy("feedback");
    try {
      const f = await post<Feedback>("/api/feedback", { scenarioId, talk, history: history(messages), known: knownTags(p) });
      setFeedback(f);
      recordFeedback(scenarioId);
      if (f.point.tag) recordPoints([{ ...f.point, ok: false }], f.fix.better ? [f.fix] : []);
      if (call.person) remember(call.person, f.memory_ja);
    } catch (e) {
      setError(e instanceof Error ? e.message : "点评失败");
    } finally {
      setBusy("");
    }
  }

  const status =
    phase === "ready"
      ? call.incoming
        ? "来电"
        : "准备拨打"
      : phase === "live"
        ? `通话中 ${clock((now - startedAt) / 1000)}`
        : `已挂断 · ${clock((endedAt - startedAt) / 1000)}`;
  const turn = busy === "stt" ? "正在听你说…" : busy === "ai" ? "对方在想…" : speaking ? "对方在说…" : "轮到你了";

  return (
    <main className="call">
      {phase !== "live" && <Link href={round?.back ?? "/call"} className="back">← {round ? "予行演習" : "打电话"}</Link>}
      <header className="call-head">
        <div className="call-avatar" aria-hidden>{call.incoming ? "受" : "電"}</div>
        <div className="call-who">{call.who}</div>
        <div className="call-state">{status}</div>
      </header>

      {phase === "ready" && (
        <>
          <div className="card goal-win">
            <div className="label">你的目标</div>
            <div>{talk.goalZh}</div>
            <div className="small-text" style={{ marginTop: 6 }}>你是：{talk.userRole}</div>
          </div>
          {round && (
            <div className="card">
              <div className="label">第 {round.round} 遍 / {round.total} · 可能用到</div>
              {round.lines.map((l) => (
                <div key={l.ja} style={{ marginTop: 6 }}>
                  <div className="ja" style={{ fontSize: 16 }}>{l.ja}</div>
                  <div className="zh">{l.zh}</div>
                </div>
              ))}
            </div>
          )}
          <p className="muted" style={{ textAlign: "center" }}>接通后只有声音。点下面的按钮说话，说完再点一下就发给对方。</p>
          <button className="primary call-go" onClick={pickUp}>
            {call.incoming ? "接听" : "拨打"}
          </button>
        </>
      )}

      {phase === "live" && (
        <>
          <div className={`call-pulse ${speaking ? "on" : ""}`}>{turn}</div>
          <div className="row" style={{ justifyContent: "center" }}>
            <button
              onClick={() => {
                if (!last) return;
                unlock();
                setReplays((n) => n + 1);
                if (last.audio) {
                  setSpeaking(true);
                  play(last.audio, 1)
                    .catch(() => setError("音频播放失败"))
                    .finally(() => setSpeaking(false));
                } else say(last.text);
              }}
              disabled={!last || !!busy || speaking}
            >
              再听一遍
            </button>
            <button
              className={subs ? "on" : ""}
              onClick={() => {
                if (!subs) setPeeks((n) => n + 1);
                setSubs(!subs);
              }}
            >
              字幕
            </button>
          </div>
          {subs && last && (
            <div className="card" style={{ textAlign: "center" }}>
              <div className="ja">{last.text}</div>
              <div className="zh">{last.zh}</div>
            </div>
          )}
          <p className="small-text" style={{ textAlign: "center" }}>
            你说了 {said} 句 · 重听 {replays} 次 · 看字幕 {peeks} 次
          </p>
          <div className="dock">
            <div className="dock-inner">
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <button className="hangup" onClick={hangUp}>挂断</button>
                <div style={{ flex: 1 }}>
                  <HoldButton label={busy === "stt" ? "识别中…" : "点一下说话"} disabled={!!busy} onRecorded={onRecorded} onError={setError} />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {phase === "ended" && (
        <>
          <div className="card">
            <div className="kpis">
              <div className="kpi">
                <b>{said}</b>
                <span>你说了几句</span>
              </div>
              <div className="kpi">
                <b>{replays}</b>
                <span>重听</span>
              </div>
              <div className="kpi">
                <b>{peeks}</b>
                <span>看字幕</span>
              </div>
            </div>
          </div>
          {busy === "feedback" && <SenseiLine wait ja="うん、うん。電話、聞いていましたよ…" zh="我在听这通电话…" />}
          {feedback && <FeedbackCard feedback={feedback} voice={talk.aiVoice} scenarioId={scenarioId} />}
          <h2>通话记录</h2>
          <div className="card">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "call-line me" : "call-line"}>
                <span className="small-text">{m.role === "user" ? "你" : call.who}</span>
                <div className="ja" style={{ fontSize: 16 }}>{m.text}</div>
                {m.zh && <div className="zh">{m.zh}</div>}
              </div>
            ))}
          </div>
          {round ? (
            round.round < round.total ? (
              <button className="primary next-cta" onClick={round.onNext}>第 {round.round + 1} 遍{round.next ? ` · ${round.next}` : ""}</button>
            ) : (
              <button className="primary next-cta" onClick={round.onNext}>終わり</button>
            )
          ) : (
            <button className="primary next-cta" onClick={pickUp}>もう一度かける</button>
          )}
        </>
      )}

      {error && <p className="error" style={{ textAlign: "center" }}>{error}</p>}
    </main>
  );
}
