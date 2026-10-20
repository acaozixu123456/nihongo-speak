"use client";

import { useEffect, useRef, useState } from "react";
import type { Scenario } from "@/content/scenarios";
import type { Feedback, Hint, Turn } from "@/lib/claude";
import { play, stop, ttsUrl, unlock } from "@/lib/client/player";
import { transcribe } from "@/lib/client/recorder";
import Link from "next/link";
import {
  knownTags,
  recordFeedback,
  recordPoints,
  recordSpeech,
  recordTalkTurn,
  useProgress,
  wavSeconds,
} from "@/lib/client/progress";
import HoldButton from "./HoldButton";
import TurnNote from "./TurnNote";
import FeedbackCard, { Star } from "./FeedbackCard";
import Note from "./Note";

type Message = Turn & { zh?: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "出错了");
  return data as T;
}

export default function Talk({ scenario, active }: { scenario: Scenario; active: boolean }) {
  const { talk } = scenario;
  const [messages, setMessages] = useState<Message[]>([]);
  const [shownZh, setShownZh] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"" | "stt" | "ai" | "hint" | "feedback">("");
  const [finished, setFinished] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [hintOpen, setHintOpen] = useState(false);
  const [wantZh, setWantZh] = useState("");
  const [hint, setHint] = useState<Hint | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const progress = useProgress();
  const card = { p: progress, voice: talk.aiVoice, scenarioId: scenario.id };

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, hint, feedback]);

  // A reply that comes back after the page was left (or the tab switched) is not read out.
  const here = useRef(active);
  here.current = active;
  useEffect(
    () => () => {
      here.current = false;
      stop();
    },
    [],
  );

  const history = (list: Message[]): Turn[] => list.map(({ role, text }) => ({ role, text }));
  const say = (text: string) => (here.current ? play(ttsUrl(text, talk.aiVoice), 1).catch(() => {}) : undefined);

  function start() {
    unlock();
    const first: Message = { role: "assistant", text: talk.opening.ja, zh: talk.opening.zh };
    setMessages([first]);
    setFinished(false);
    setFeedback(null);
    setHint(null);
    setShownZh(new Set());
    say(first.text);
  }

  async function send(text: string) {
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next);
    setHint(null);
    setHintOpen(false);
    setBusy("ai");
    try {
      const reply = await post<{ ja: string; zh: string; finished: boolean }>("/api/chat", {
        scenarioId: scenario.id,
        talk,
        history: history(next),
      });
      setMessages([...next, { role: "assistant", text: reply.ja, zh: reply.zh }]);
      setFinished(reply.finished);
      recordTalkTurn();
      say(reply.ja);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 出错了");
    } finally {
      setBusy("");
    }
  }

  async function onRecorded(wav: Blob) {
    setError("");
    setBusy("stt");
    try {
      const { text } = await transcribe(wav);
      setBusy("");
      if (!text) {
        setError("没听清，再说一次试试");
        return;
      }
      recordSpeech(wavSeconds(wav));
      await send(text);
    } catch (e) {
      setBusy("");
      setError(e instanceof Error ? e.message : "语音识别失败");
    }
  }

  async function getHint() {
    setError("");
    setBusy("hint");
    try {
      setHint(
        await post<Hint>("/api/chat", {
          scenarioId: scenario.id,
          talk,
          history: history(messages),
          mode: "hint",
          wantZh: wantZh.trim() || undefined,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取提示失败");
    } finally {
      setBusy("");
    }
  }

  async function getFeedback() {
    setError("");
    setBusy("feedback");
    try {
      const f = await post<Feedback>("/api/feedback", { scenarioId: scenario.id, talk, history: history(messages), known: knownTags(progress) });
      setFeedback(f);
      recordFeedback(scenario.id);
      if (f.point.tag) recordPoints([{ ...f.point, ok: false }], f.fix.better ? [f.fix] : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "点评失败");
    } finally {
      setBusy("");
    }
  }

  function toggleZh(i: number) {
    setShownZh((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const userTurns = messages.filter((m) => m.role === "user").length;

  return (
    <div>
      <div className="card goal-win">
        <div className="label">这次的目标</div>
        <div>{talk.goalZh}</div>
        <div className="small-text" style={{ marginTop: 4 }}>对方：{talk.aiRole}</div>
        <div className="small-text">你：{talk.userRole}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={start} disabled={!!busy}>
            {messages.length ? "重新开始" : "开始对话"}
          </button>
          {userTurns > 0 && (
            <button onClick={getFeedback} disabled={!!busy}>先生に見てもらう</button>
          )}
        </div>
      </div>

      {messages.map((m, i) =>
        m.role === "assistant" ? (
          <div key={i} className="bubble ai">
            <div className="ja">{m.text}</div>
            {shownZh.has(i) && <div className="zh">{m.zh}</div>}
            <div className="row" style={{ marginTop: 6 }}>
              <button className="small" onClick={() => { unlock(); say(m.text); }}>もう一度</button>
              <button className="small" onClick={() => toggleZh(i)}>{shownZh.has(i) ? "隐藏中文" : "中文"}</button>
              {m.zh && <Star {...card} ja={m.text} zh={m.zh} />}
            </div>
          </div>
        ) : (
          <div key={i}>
            <div className="bubble me">{m.text}</div>
            <TurnNote
              scenarioId={scenario.id}
              talk={talk}
              history={history(messages.slice(0, i + 1))}
              voice={talk.aiVoice}
            />
          </div>
        ),
      )}

      {busy === "stt" && <p className="muted">识别中…</p>}
      {busy === "ai" && <p className="muted">对方正在回答…</p>}
      {finished && !feedback && (
        <div className="card">
          对话告一段落。点「结束并点评」看看哪里可以说得更自然。
        </div>
      )}

      {hintOpen && (
        <div className="card">
          <strong>提示</strong>
          <p className="muted">想说什么可以先用中文写下来；不写的话就给你几种可以接的话。</p>
          <input value={wantZh} onChange={(e) => setWantZh(e.target.value)} placeholder="想说的中文（可不填）" />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={getHint} disabled={!!busy}>
              {busy === "hint" ? "思考中…" : "给我提示"}
            </button>
            <button onClick={() => setHintOpen(false)}>关闭</button>
          </div>
          {hint?.suggestions.map((s, i) => (
            <div key={i} style={{ marginTop: 10 }}>
              <div className="ja">{s.ja}</div>
              <div className="zh">{s.zh}</div>
              <button className="small" onClick={() => { unlock(); say(s.ja); }}>聞く</button>
            </div>
          ))}
        </div>
      )}

      {busy === "feedback" && <Note wait ja="まとめています…" zh="在看你刚才的对话…" />}
      {feedback && (
        <FeedbackCard feedback={feedback} voice={talk.aiVoice} scenarioId={scenario.id}>
          <Link href="/scenes" className="btn primary" style={{ flex: 1 }}>場面へ</Link>
          <button onClick={start}>再来一次</button>
        </FeedbackCard>
      )}

      {error && <p className="error">{error}</p>}
      <div ref={bottom} />

      {active && messages.length > 0 && !feedback && (
        <div className="dock">
          <div className="dock-inner">
            {typing ? (
              <form
                className="row"
                style={{ flexWrap: "nowrap" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!draft.trim() || busy) return;
                  unlock();
                  send(draft.trim());
                  setDraft("");
                }}
              >
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="用日语输入" />
                <button className="primary" type="submit" disabled={!!busy}>送る</button>
                <button type="button" onClick={() => setTyping(false)}>语音</button>
              </form>
            ) : (
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <button onClick={() => setHintOpen(!hintOpen)} disabled={!!busy}>求助</button>
                <div style={{ flex: 1 }}>
                  <HoldButton disabled={!!busy} onRecorded={onRecorded} onError={setError} />
                </div>
                <button onClick={() => setTyping(true)}>打字</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
