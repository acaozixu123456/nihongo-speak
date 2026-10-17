"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { calls, people } from "@/content/calls";
import type { RetellEnd, RetellFix } from "@/lib/claude";
import { play, stop as stopAudio, ttsUrl, unlock } from "@/lib/client/player";
import {
  dayKey,
  knownTags,
  RADIO_VOICE,
  recordPoints,
  recordRetell,
  recordSpeech,
  useProgress,
  wavSeconds,
  type Progress,
} from "@/lib/client/progress";
import { Recorder, transcribeLong } from "@/lib/client/recorder";
import { stepDone, todaysEpisode, useOnRoute } from "@/lib/client/route";
import { useHydrated } from "@/lib/client/hydrated";
import { Star } from "./FeedbackCard";

// 三回話す: tell today's radio story three times, each time to a different person (so there is nothing
// new to add, only saying it better), with the one thing to fix shown between the first and second time.
// Built on the 4/3/2 research: the same content repeated is what lasts (de Jong & Perfetti 2011); time
// pressure itself matters little, so the times only shrink a bit; one delayed correction lets accuracy
// grow with fluency (Tran & Saito); three times, not six, or it turns into reciting (Suzuki & Hanzawa).
// Easier to start: keywords and ready-made opening lines on screen, no score while speaking, and a
// listener who reacts. The first telling of each day is always a new story, so its speed across days
// is the honest measure of progress.

const SECONDS = [90, 75, 60];
const LISTENERS = ["yamada", "yui", "sato"];
const REACTIONS: Record<string, string[]> = {
  yamada: ["へえ、そうなんだ。面白いね。", "なるほどね、知らなかったよ。"],
  yui: ["えー、うそ！知らなかった！", "まじで？めっちゃ面白いじゃん！"],
  sato: ["マジですか、それ初めて聞きました。", "へえー、なんか得した気分です。"],
};

type Topic = { title: string; about: string; keys: { ja: string; kana?: string }[]; starters: string[] };

const LIFE_TOPICS = ["今天上班（或今天一天）做了什么", "这个周末做了什么，或打算做什么", "最近吃过的好吃的东西", "最近让你吃惊或开心的一件事"];

// Today's episode when there is one; otherwise something from the learner's own day.
function topicFor(p: Progress): Topic {
  const ep = todaysEpisode(p);
  if (ep) {
    const main = ep.lines.filter((l) => l.part === "main").map((l) => l.ja);
    return {
      title: ep.title_zh,
      about: `${ep.title_zh}\n${(main.length ? main : ep.lines.map((l) => l.ja)).join("").slice(0, 600)}`,
      keys: (ep.words ?? []).slice(0, 3).map((w) => ({ ja: w.ja, kana: w.kana })),
      starters: ["今日ラジオで、〜って話を聞いたんですけど。", "びっくりしたのは、〜ってことです。", "だから、〜らしいですよ。"],
    };
  }
  const day = Number(dayKey().replace(/-/g, ""));
  const t = LIFE_TOPICS[day % LIFE_TOPICS.length];
  return { title: t, about: t, keys: [], starters: ["実は、〜んですよ。", "それで、〜。", "結局、〜って感じでした。"] };
}

const voiceOf = (person: string) => calls.find((c) => c.person === person)?.talk.aiVoice ?? RADIO_VOICE.B;
const nameOf = (person: string) => people.find((x) => x.id === person)?.name ?? person;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;
const chars = (s: string) => s.replace(/[\s、。，,.!！?？「」…]/g, "").length;

type Take = { text: string; sec: number; cpm: number };
type Phase = "ready" | "starting" | "talk" | "between" | "end";

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/retell", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "AI 出错了");
  return data as T;
}

export default function Retell() {
  const p = useProgress();
  const hydrated = useHydrated();
  const onRoute = useOnRoute();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [left, setLeft] = useState(SECONDS[0]);
  const [takes, setTakes] = useState<(Take | null)[]>([null, null, null]);
  const [fix, setFix] = useState<RetellFix | null>(null);
  const [end, setEnd] = useState<RetellEnd | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<Recorder | null>(null);
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);
  const known = useRef<string[]>([]);
  // The first telling on an earlier day, to compare with today's first.
  const before = useRef<number | null>(null);

  useEffect(() => {
    if (!hydrated || topic) return;
    setTopic(topicFor(p));
    known.current = knownTags(p);
    const past = (p.retells ?? []).filter((r) => r.date !== dayKey());
    before.current = past.length ? past[past.length - 1].cpm[0] : null;
  }, [hydrated, p, topic]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      stopAudio();
      rec.current?.stop().catch(() => {});
    },
    [],
  );

  const listener = LISTENERS[round];

  async function begin() {
    unlock();
    stopAudio();
    setError("");
    setPhase("starting");
    const r = new Recorder();
    try {
      await r.start();
    } catch {
      setPhase(round === 0 ? "ready" : "between");
      setError("麦克风打不开，请允许使用麦克风");
      return;
    }
    rec.current = r;
    startedAt.current = Date.now();
    setLeft(SECONDS[round]);
    setPhase("talk");
    timer.current = window.setInterval(() => {
      const l = SECONDS[round] - (Date.now() - startedAt.current) / 1000;
      setLeft(l);
      if (l <= 0) finish();
    }, 250);
  }

  async function finish() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    const n = round;
    setPhase("between");
    setBusy("listen");
    let wav: Blob;
    try {
      wav = await r.stop();
    } catch {
      setBusy("");
      setError("录音出错了，这一遍再说一次");
      return;
    }
    const sec = wavSeconds(wav);
    // The listener reacts at once, like a person would, while the recording is being read.
    const who = LISTENERS[n];
    const lines = REACTIONS[who];
    play(ttsUrl(lines[Math.floor(Math.random() * lines.length)], voiceOf(who)), 1).catch(() => {});
    let text = "";
    try {
      text = await transcribeLong(wav);
    } catch {}
    if (sec < 8 || chars(text) < 5) {
      setBusy("");
      setError("这一遍没听清，或者太短了。不要紧，再说一次这一遍。");
      return;
    }
    recordSpeech(sec);
    const take = { text, sec, cpm: Math.round((chars(text) / sec) * 60) };
    const next = takes.map((t, i) => (i === n ? take : t));
    setTakes(next);
    if (n === 0) {
      setBusy("fix");
      try {
        const f = await post<RetellFix>({ kind: "fix", topic: topic!.about, said: text, known: known.current });
        setFix(f);
        if (f.point.tag) recordPoints([{ tag: f.point.tag, zh: f.point.zh, ok: false }], f.fix.better ? [f.fix] : []);
      } catch {
        // The tellings still work without the one point.
      }
      setBusy("");
      setRound(1);
      return;
    }
    if (n === 1) {
      setBusy("");
      setRound(2);
      return;
    }
    // Third time: done.
    const cpm = next.map((t) => t?.cpm ?? 0);
    recordRetell({ date: dayKey(), topic: topic!.title, cpm });
    setPhase("end");
    stepDone();
    setBusy("end");
    try {
      const e = await post<RetellEnd>({ kind: "end", topic: topic!.about, first: next[0]!.text, last: text, focus: fix?.focus_zh });
      setEnd(e);
      if (fix?.point.tag && e.used) recordPoints([{ tag: fix.point.tag, zh: fix.point.zh, ok: true }], []);
    } catch {}
    setBusy("");
  }

  function hear(ja: string) {
    unlock();
    play(ttsUrl(ja, RADIO_VOICE.A), 1).catch(() => {});
  }

  if (!hydrated || !topic) return <main className="page" />;

  const back = !onRoute && (
    <Link href="/" className="back">
      ← 今日
    </Link>
  );

  // ---- The end: three numbers, what got better, and the story said naturally ----
  if (phase === "end") {
    const cpm = takes.map((t) => t?.cpm ?? 0);
    const top = Math.max(...cpm, 1);
    const gain = cpm[0] ? Math.round(((cpm[2] - cpm[0]) / cpm[0]) * 100) : 0;
    return (
      <main className="page">
        {back}
        <h1 className="ep-head">三回話す</h1>
        <div className="today retell-end">
          <span className="kicker">每分钟说出的字数</span>
          <div className="retell-bars">
            {cpm.map((c, i) => (
              <div key={i}>
                <i style={{ height: `${Math.max(8, (c / top) * 100)}%` }} className={i === 2 ? "now" : ""} />
                <b>{c}</b>
                <span>{nameOf(LISTENERS[i])}</span>
              </div>
            ))}
          </div>
          <span className="today-zh">
            {gain > 0 ? `第三遍比第一遍快了 ${gain}%。` : "三遍速度差不多，说明第一遍就已经比较顺了。"}
            {before.current ? ` 第一遍：上次 ${before.current} → 今天 ${cpm[0]}。` : ""}
          </span>
        </div>
        {busy === "end" && <p className="muted judge-wait">AI 在听你的第三遍…</p>}
        {end && (
          <>
            <p className="focus-one">{end.praise_zh}</p>
            {fix?.focus_zh && (
              <p className="small-text">
                {end.used ? "✓" : "△"} 这次要注意的：{fix.focus_zh}
              </p>
            )}
            <span className="kicker" style={{ marginTop: 18 }}>你讲的，说得更自然一点</span>
            <div className="card">
              {end.natural.map((x, i) => (
                <div key={i} className="note">
                  <div className="note-main" onClick={() => hear(x.ja)}>
                    <div className="ja">{x.ja}</div>
                    <div className="zh">{x.zh}</div>
                  </div>
                  <Star p={p} ja={x.ja} zh={x.zh} voice={RADIO_VOICE.A} scenarioId="retell" />
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    );
  }

  const take0 = takes[0];
  const talking = phase === "talk";

  return (
    <main className="page">
      {!talking && back}
      <h1 className="ep-head">三回話す</h1>
      <div className="today retell">
        <span className="kicker">
          第 {round + 1} 遍 · 讲给{nameOf(listener)}
        </span>
        <span className="today-title">
          <span className="retell-topic">{topic.title}</span>
          {talking && <span className={`today-big ${left < 10 ? "hurry" : ""}`}>{clock(left)}</span>}
        </span>
        {topic.keys.length > 0 && (
          <div className="retell-keys">
            {topic.keys.map((k) => (
              <span key={k.ja}>
                {k.ja}
                {k.kana && k.kana !== k.ja && <small>{k.kana}</small>}
              </span>
            ))}
          </div>
        )}
        <div className="retell-starters">
          {topic.starters.map((s) => (
            <div key={s}>{s}</div>
          ))}
        </div>
        {round > 0 && fix?.focus_zh && <span className="retell-focus">只注意：{fix.focus_zh}</span>}
        {talking ? (
          <button className="today-go retell-stop" onClick={finish}>
            <span className="rec-dot" /> 说完了
          </button>
        ) : (
          <button className="today-go retell-go" onClick={begin} disabled={phase === "starting" || !!busy}>
            {phase === "starting" ? "准备…" : busy ? "…" : round === 0 ? "开始讲" : `讲给${nameOf(listener)}`}
          </button>
        )}
      </div>

      {round === 0 && !talking && !error && (
        <p className="muted retell-note">
          不打分。用上面的开头句起个头，卡住了就说「えっと」接着讲。同一件事讲三遍给三个人，一遍比一遍顺。
        </p>
      )}

      {round === 1 && !talking && (
        <div className="retell-fix">
          {busy ? (
            <p className="muted judge-wait">AI 在听你的第一遍…</p>
          ) : fix ? (
            <>
              <span className="kicker">下一遍只改这一件事</span>
              <p className="focus-one">{fix.focus_zh}</p>
              {fix.fix.better && (
                <div onClick={() => hear(fix.fix.better)}>
                  {fix.fix.you_said && <div className="muted">你说：{fix.fix.you_said}</div>}
                  <div className="ja">→ {fix.fix.better} ▶</div>
                </div>
              )}
            </>
          ) : take0 ? (
            <p className="muted">讲得不错，内容不用改，再讲一遍给下一个人。</p>
          ) : null}
        </div>
      )}
      {round === 2 && !talking && <p className="muted retell-note">最后一遍，时间短一点，挑最想说的讲。</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
