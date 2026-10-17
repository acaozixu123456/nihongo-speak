"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { calls, type Call as CallDef } from "@/content/calls";
import type { Feedback, Turn } from "@/lib/claude";
import { play, stop, ttsUrl, unlock } from "@/lib/client/player";
import { liveReply, stopLive, unlockLive } from "@/lib/client/live";
import { transcribe } from "@/lib/client/recorder";
import { recordFeedback, recordSpeech, recordTalkTurn, wavSeconds } from "@/lib/client/progress";
import FeedbackCard from "./FeedbackCard";
import HoldButton from "./HoldButton";
import Nav from "./Nav";

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
      <Link href="/speak" className="back">← 说</Link>
      <header className="page-mast">
        <div>
          <h1>打电话</h1>
          <p className="muted">只有声音，默认不显示文字。听不清就说「もう一度お願いします」。</p>
        </div>
      </header>
      <div className="list">
        {calls.map((c) => (
          <Link key={c.id} href={`/call/${c.id}`} className="row-link">
            <span className="glyph">{c.incoming ? "受" : "電"}</span>
            <span className="row-text">
              {c.titleZh}
              <small>
                {c.who}
              </small>
            </span>
            <span className="chev" aria-hidden>›</span>
          </Link>
        ))}
      </div>
      <Nav on="speak" />
    </main>
  );
}

// One phone call: the other side is a voice; subtitles cost a tap and are counted.
export default function Call({ call }: { call: CallDef }) {
  const { talk } = call;
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

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(
    () => () => {
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
      console.warn("Gemini Live failed, falling back", e);
      // A refused request (no key, credit used up) won't get better in this call; a missed reply might.
      if (e instanceof Error && e.message.startsWith("live ")) liveOn.current = false;
      setBusy("");
      setSpeaking(false);
      return false;
    }
  }

  async function hangUp() {
    stop();
    stopLive();
    setEndedAt(Date.now());
    setPhase("ended");
    if (!said) return;
    setBusy("feedback");
    try {
      setFeedback(await post<Feedback>("/api/feedback", { scenarioId, talk, history: history(messages) }));
      recordFeedback(scenarioId);
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
      {phase !== "live" && <Link href="/call" className="back">← 打电话</Link>}
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
              disabled={!last || !!busy}
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
          {busy === "feedback" && <p className="muted judge-wait">正在点评这通电话…</p>}
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
          <button className="primary next-cta" onClick={pickUp}>再打一次</button>
        </>
      )}

      {error && <p className="error" style={{ textAlign: "center" }}>{error}</p>}
    </main>
  );
}
