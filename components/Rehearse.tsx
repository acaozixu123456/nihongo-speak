"use client";

import Link from "next/link";
import { useState } from "react";
import Call from "./Call";
import { personVoice, type Call as CallDef } from "@/content/calls";
import { HD_MAN, HD_WOMAN_POLITE } from "@/content/voices";
import type { RehearseDebrief, RehearsePlan } from "@/lib/claude";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { dayKey, hasCard, rehearsalToReport, saveRehearsal, toggleCard, useProgress, type Rehearsal } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";

const ROUNDS = 3;
// What the other side does in rounds 2 and 3, on the button that starts them.
const NEXT = ["", "对方会追问", "会出点小麻烦"];

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/rehearse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "出错了");
  return data as T;
}

// One round as a phone-style call: same errand every time, the other side reacts differently.
function roundCall(r: Rehearsal, i: number): CallDef {
  return {
    id: `rehearse-${r.id}`,
    title: "预演",
    titleZh: r.titleZh,
    who: r.who,
    incoming: false,
    person: r.person,
    talk: { ...r.talk, setup: `${r.talk.setup}\n\n今回（${i + 1}回目）の相手の反応：${r.twists[i] ?? ""}（これは相手の行動の説明。このままセリフにしない）` },
  };
}

// 予行演習: a conversation that is really coming up, played out three times with the other side
// reacting differently each time; afterwards, what couldn't be said in real life becomes a saved phrase.
export default function Rehearse() {
  const p = useProgress();
  const hydrated = useHydrated();
  const [ask, setAsk] = useState("");
  const [report, setReport] = useState("");
  const [current, setCurrent] = useState<Rehearsal | null>(null);
  const [round, setRound] = useState(-1); // -1: not in a round
  const [done, setDone] = useState(false);
  const [debrief, setDebrief] = useState<{ r: Rehearsal; d: RehearseDebrief } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pending = hydrated && !debrief ? rehearsalToReport(p) : null;

  async function start() {
    setBusy(true);
    setError("");
    try {
      const plan = await post<RehearsePlan>({ kind: "plan", ask });
      const person = plan.person === "none" ? undefined : plan.person;
      const r: Rehearsal = {
        id: `${Date.now()}`,
        date: dayKey(),
        askZh: ask.trim(),
        titleZh: plan.titleZh,
        who: plan.who,
        person,
        talk: {
          aiRole: plan.aiRole,
          aiVoice: personVoice(person) ?? (plan.gender === "male" ? HD_MAN : HD_WOMAN_POLITE),
          userRole: plan.userRole,
          goalZh: plan.goalZh,
          setup: plan.setup,
          opening: plan.opening,
        },
        twists: plan.twists.slice(0, ROUNDS),
        lines: plan.lines.slice(0, 3),
        rounds: 0,
      };
      saveRehearsal(r);
      setCurrent(r);
      setRound(0);
      setAsk("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "出错了");
    } finally {
      setBusy(false);
    }
  }

  async function sendReport(r: Rehearsal, skip = false) {
    if (skip) {
      saveRehearsal({ ...r, debrief: { date: dayKey(), noteZh: "", missed: [] } });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await post<RehearseDebrief>({ kind: "debrief", ask: r.askZh, report });
      saveRehearsal({ ...r, debrief: { date: dayKey(), ...d } });
      // What couldn't be said goes into フレーズ帳, so 瞬間 and 練習 bring it back.
      for (const m of d.missed) {
        if (!hasCard(p, m.ja)) toggleCard({ ja: m.ja, reading: m.kana, zh: m.zh, voice: r.talk.aiVoice, scenarioId: `rehearse:${r.id}` });
      }
      setDebrief({ r, d });
      setReport("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "出错了");
    } finally {
      setBusy(false);
    }
  }

  if (current && round >= 0) {
    const r = current;
    return (
      <Call
        key={round}
        call={roundCall(r, round)}
        round={{
          round: round + 1,
          total: ROUNDS,
          lines: r.lines,
          next: NEXT[round + 1],
          back: "/rehearse",
          onHangUp: () => {
            const next = { ...r, rounds: Math.max(r.rounds, round + 1) };
            saveRehearsal(next);
            setCurrent(next);
          },
          onNext: () => {
            if (round + 1 < ROUNDS) setRound(round + 1);
            else {
              setRound(-1);
              setDone(true);
            }
          },
        }}
      />
    );
  }

  return (
    <main className="page">
      <Link href="/speak" className="back">← 说</Link>
      <h1 className="ep-head">预演</h1>

      {done && current ? (
        <div className="today rehearse">
          <span className="kicker">演完了</span>
          <span className="today-title">{current.titleZh}</span>
          <span className="today-zh">真说完以后回来，告诉我哪句没说出来，我把它变成下次能用的话。</span>
          <Link href="/speak" className="today-go">返回</Link>
        </div>
      ) : debrief ? (
        <div className="today rehearse">
          <span className="kicker">{debrief.r.titleZh}</span>
          {debrief.d.noteZh && <span className="today-zh">{debrief.d.noteZh}</span>}
          {debrief.d.missed.map((m) => (
            <button
              key={m.ja}
              className="rehearse-line"
              onClick={() => {
                unlock();
                play(ttsUrl(m.ja, debrief.r.talk.aiVoice), 1).catch(() => setError("音频播放失败"));
              }}
            >
              <span className="ja">{m.ja}</span>
              <span className="zh">{m.zh}</span>
            </button>
          ))}
          {debrief.d.missed.length > 0 && <span className="today-zh">已放进フレーズ帳，瞬間 会再考你。</span>}
          <button className="today-go" onClick={() => setDebrief(null)}>准备下一个</button>
        </div>
      ) : pending ? (
        <div className="today rehearse">
          <span className="kicker">上次演过</span>
          <span className="today-title">{pending.titleZh}</span>
          <textarea
            rows={3}
            value={report}
            maxLength={500}
            onChange={(e) => setReport(e.target.value)}
            placeholder="实际说得怎么样？哪句没说出来？中文就行"
          />
          <button className="today-go" onClick={() => sendReport(pending)} disabled={!report.trim() || busy}>
            {busy ? "AI 在看…" : "告诉 AI"}
          </button>
          <button className="link-quiet" onClick={() => sendReport(pending, true)} disabled={busy}>还没说 / 跳过</button>
        </div>
      ) : (
        <div className="today rehearse">
          <span className="kicker">明天要说的话，今天先演三遍</span>
          <textarea
            rows={3}
            value={ask}
            maxLength={300}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="比如：明天跟课长请半天假去医院"
          />
          <button className="today-go" onClick={start} disabled={!ask.trim() || busy}>
            {busy ? "AI 在准备对方…" : "开始"}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
