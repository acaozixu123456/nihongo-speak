"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { prepare, radioClips, type Prepared } from "@/lib/client/moyu";
import { play, SILENCE, ttsUrl, unlock } from "@/lib/client/player";
import { findEpisode, markHeard, RADIO_VOICE, useProgress } from "@/lib/client/progress";
import { setAudioSession } from "@/lib/client/recorder";
import { useHydrated } from "@/lib/client/hydrated";
import { Star } from "./FeedbackCard";
import { shortDate } from "./ListenHome";
import Nav from "./Nav";

type Tab = "script" | "phrases" | "words" | "grammar";
const TABS: { key: Tab; label: string }[] = [
  { key: "script", label: "文稿" },
  { key: "phrases", label: "重点句" },
  { key: "words", label: "单词" },
  { key: "grammar", label: "语法" },
];
const HOST_NAME = { A: "ハル", B: "ケン" } as const;

type Phase = "idle" | "loading" | "playing" | "paused";

// One 趣味电台 episode: play it straight through (the line being spoken lights up in the transcript),
// then the notes the AI wrote with it: key sentences (already in review), words and grammar.
export default function Episode({ id }: { id: string }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const ep = hydrated ? findEpisode(p, id) : undefined;
  const audio = useRef<HTMLAudioElement>(null);
  const prep = useRef<Prepared | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [at, setAt] = useState(-1);
  const [pos, setPos] = useState(0);
  const [tab, setTab] = useState<Tab>("script");
  const [showZh, setShowZh] = useState(true);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      audio.current?.pause();
      if (prep.current) URL.revokeObjectURL(prep.current.url);
    },
    [],
  );

  if (!hydrated) return <main className="page" />;
  if (!ep) {
    return (
      <main className="page">
        <Link href="/" className="back">← 听</Link>
        <p className="muted">找不到这一期了（只保留最近 50 期）。</p>
        <Nav on="listen" />
      </main>
    );
  }
  const episode = ep;

  async function toggle() {
    const a = audio.current!;
    if (phase === "loading") return;
    if (prep.current) return a.paused ? void a.play().catch(() => {}) : a.pause();
    // iPhone only lets this element play later if it first plays from the tap itself.
    a.src = SILENCE;
    a.play().catch(() => {});
    setAudioSession("playback");
    setError("");
    setPhase("loading");
    try {
      const ready = await prepare(radioClips(episode));
      prep.current = ready;
      a.src = ready.url;
      await a.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "播放失败");
      setPhase("idle");
    }
  }

  function onTime() {
    const a = audio.current!;
    const cur = prep.current;
    if (!cur || a.src !== cur.url) return;
    let i = 0;
    while (i + 1 < cur.starts.length && cur.starts[i + 1] <= a.currentTime) i++;
    setAt(i);
    setPos(a.currentTime / cur.total);
  }

  // Tap a line to jump there (once the audio is ready).
  function seekLine(ja: string) {
    const cur = prep.current;
    const a = audio.current;
    if (!cur || !a) return;
    const i = cur.clips.findIndex((c) => c.show === ja);
    if (i < 0) return;
    a.currentTime = cur.starts[i] + 0.01;
    if (a.paused) a.play().catch(() => {});
  }

  function say(ja: string) {
    audio.current?.pause();
    unlock();
    play(ttsUrl(ja, RADIO_VOICE.A)).catch(() => {});
  }

  const speaking = prep.current && at >= 0 ? prep.current.clips[at]?.show : null;
  const scenarioId = `radio:${ep.id}`;

  return (
    <main className="page">
      <Link href="/" className="back">← 听</Link>
      <div className="kicker">
        趣味电台 · {shortDate(ep.date)}
      </div>
      <h1 className="ep-head">{ep.title_zh}</h1>
      <p className="ep-hook">{ep.hook_zh}</p>

      <div className="player">
        <button className="play" onClick={toggle} aria-label={phase === "playing" ? "暂停" : "播放"}>
          {phase === "loading" ? <span className="spin" /> : phase === "playing" ? "❚❚" : "▶"}
        </button>
        <div className="player-body">
          <div className="player-state">
            {phase === "idle" ? "收听这一期" : phase === "loading" ? "正在准备声音…" : speaking ?? ""}
          </div>
          <div className="track">
            <div style={{ width: `${pos * 100}%` }} />
          </div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="seg">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "script" && (
        <>
          <div className="row spread note-head">
            <span>{ep.lines.length} 句 · 点一句跳过去</span>
            <button className="small ghost" onClick={() => setShowZh(!showZh)}>
              {showZh ? "隐藏中文" : "显示中文"}
            </button>
          </div>
          <div className="script">
            {ep.lines.map((l, i) => (
              <div key={i} className={`sline ${speaking === l.ja ? "now" : ""}`} onClick={() => seekLine(l.ja)}>
                <span className={`who who-${l.who}`}>{HOST_NAME[l.who]}</span>
                <div>
                  <div className="ja">{l.ja}</div>
                  {showZh && <div className="zh">{l.zh}</div>}
                </div>
              </div>
            ))}
          </div>
          <p className="quiz">
            <span>想一想</span>
            {ep.quiz_zh}
          </p>
        </>
      )}

      {tab === "phrases" && (
        <>
          <p className="note-head">这几句已经放进复习，明天开始会让你说出来。</p>
          {ep.phrases.map((ph) => (
            <div key={ph.ja} className="note">
              <div className="note-main" onClick={() => say(ph.ja)}>
                <div className="ja">{ph.ja}</div>
                <div className="zh">{ph.zh}</div>
              </div>
              <Star p={p} ja={ph.ja} zh={ph.zh} voice={RADIO_VOICE.A} scenarioId={scenarioId} />
            </div>
          ))}
        </>
      )}

      {tab === "words" && (
        <>
          <p className="note-head">点单词听发音，想记的点收藏进复习。</p>
          {(ep.words ?? []).map((w) => (
            <div key={w.ja} className="note">
              <div className="note-main" onClick={() => say(w.ja)}>
                <div className="ja">
                  {w.ja}
                  <span className="kana"> {w.kana}</span>
                </div>
                <div className="zh">{w.zh}</div>
              </div>
              <Star p={p} ja={w.ja} reading={w.kana} zh={w.zh} voice={RADIO_VOICE.A} scenarioId={scenarioId} />
            </div>
          ))}
          {!ep.words?.length && <p className="muted">这一期是旧版生成的，没有单词表。</p>}
        </>
      )}

      {tab === "grammar" && (
        <>
          {(ep.grammar ?? []).map((g) => (
            <div key={g.pattern} className="note gram">
              <div className="note-main">
                <div className="gram-pattern">{g.pattern}</div>
                <div className="zh">{g.zh}</div>
                <div className="gram-ex" onClick={() => say(g.ja)}>
                  {g.ja}
                </div>
              </div>
            </div>
          ))}
          {!ep.grammar?.length && <p className="muted">这一期是旧版生成的，没有语法整理。</p>}
        </>
      )}

      <audio
        ref={audio}
        playsInline
        preload="auto"
        onTimeUpdate={onTime}
        onPlaying={() => prep.current && audio.current?.src === prep.current.url && setPhase("playing")}
        onPause={() => prep.current && audio.current?.src === prep.current.url && !audio.current.ended && setPhase("paused")}
        onEnded={() => {
          if (!prep.current || audio.current?.src !== prep.current.url) return;
          setPhase("paused");
          markHeard(episode.id);
        }}
      />
      <Nav on="listen" />
    </main>
  );
}
