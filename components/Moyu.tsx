"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Podcast as Episode } from "@/lib/claude";
import { BLOCK_LABEL, buildRound, makeEpisode, makeRadio, prepare, pruneCache, todayEpisode, type Clip, type Prepared } from "@/lib/client/moyu";
import { SILENCE } from "@/lib/client/player";
import { markHeard, recordMoyu, recordStuck, todayStats, useProgress, type Progress, type RadioEpisode } from "@/lib/client/progress";
import { setAudioSession } from "@/lib/client/recorder";
import { stepDone } from "@/lib/client/route";

const RATES = [0.9, 1, 1.1];
const RATE_KEY = "nihongo-speak:moyu-rate";

type Phase = "idle" | "loading" | "playing" | "paused";

// 摸鱼模式: start once, then it keeps playing round after round, screen locked or not.
// Earbud controls: next = skip (I know this one), previous = again (kept as a sentence to say later).
export default function Moyu() {
  const p = useProgress();
  const pRef = useRef<Progress>(p);
  pRef.current = p;
  const audio = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [now, setNow] = useState<{ clip: Clip; nth: number; of: number } | null>(null);
  const [rate, setRateState] = useState(1);
  const [error, setError] = useState("");
  const s = useRef({
    round: 0,
    used: new Set<string>(),
    cur: null as Prepared | null,
    next: null as Promise<Prepared> | null,
    idx: -1,
    episode: null as Episode | null,
    podcastQueued: false,
    radio: null as RadioEpisode | null,
    radioAsk: null as Promise<unknown> | null,
    tick: 0,
    pendingSec: 0,
    rate: 1,
  }).current;

  const stats = todayStats(p);
  const minutes = Math.floor((stats.moyuSec ?? 0) / 60);
  const stuck = stats.stuck?.length ?? 0;

  useEffect(() => {
    document.body.classList.add("moyu-on");
    pruneCache();
    try {
      const r = Number(localStorage.getItem(RATE_KEY));
      if (RATES.includes(r)) setRate(r);
    } catch {}
    return () => {
      document.body.classList.remove("moyu-on");
      flush();
      audio.current?.pause();
      if (s.cur) URL.revokeObjectURL(s.cur.url);
      const ms = navigator.mediaSession;
      if (ms) for (const a of ["play", "pause", "previoustrack", "nexttrack"] as MediaSessionAction[]) ms.setActionHandler(a, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setRate(r: number) {
    s.rate = r;
    setRateState(r);
    if (audio.current) audio.current.playbackRate = r;
    try {
      localStorage.setItem(RATE_KEY, String(r));
    } catch {}
  }

  function flush() {
    if (s.pendingSec >= 1) recordMoyu(Math.round(s.pendingSec));
    s.pendingSec = 0;
  }

  async function nextRound(): Promise<Prepared> {
    const r = s.round++;
    // The podcast joins the first round built after its script is ready, once per session.
    const ep = s.episode && !s.podcastQueued ? s.episode : null;
    if (ep) s.podcastQueued = true;
    // Every round after the first opens with a new 趣味电台 episode; wait a little if it's still being written.
    if (r > 0 && !s.radio && s.radioAsk) await Promise.race([s.radioAsk, new Promise((ok) => setTimeout(ok, 30000))]);
    const radio = r > 0 ? s.radio : null;
    if (radio) {
      s.radio = null;
      markHeard(radio.id);
      askRadio();
    }
    return prepare(buildRound(pRef.current, r, s.used, ep, radio));
  }

  function askRadio() {
    if (s.radioAsk) return;
    s.radioAsk = makeRadio()
      .then((ep) => (s.radio = ep), console.warn)
      .finally(() => (s.radioAsk = null));
  }

  function load(prep: Prepared) {
    const a = audio.current;
    if (!a) return URL.revokeObjectURL(prep.url); // left the page while it was loading
    const old = s.cur;
    s.cur = prep;
    s.idx = -1;
    a.src = prep.url;
    a.defaultPlaybackRate = s.rate;
    a.playbackRate = s.rate;
    a.play().catch((e) => setError(e instanceof Error ? e.message : "播放失败"));
    if (old) URL.revokeObjectURL(old.url);
    s.next = nextRound();
    s.next.catch(() => {});
  }

  async function start() {
    const a = audio.current!;
    // iPhone only lets this element play later if it first plays from the tap itself.
    a.src = SILENCE;
    a.play().catch(() => {});
    setAudioSession("playback");
    setError("");
    setPhase("loading");
    setupMediaSession();
    s.episode = todayEpisode();
    if (!s.episode) makeEpisode(pRef.current).then((ep) => (s.episode = ep), console.warn);
    askRadio();
    try {
      load(await (s.next ?? nextRound()));
    } catch (e) {
      s.next = null;
      setError(e instanceof Error ? e.message : "出错了");
      setPhase("idle");
    }
  }

  async function onEnded() {
    flush();
    // A whole round heard is the day's 流す stop done (it keeps playing; the route just ends here).
    stepDone();
    if (!s.next) return;
    setPhase("loading");
    try {
      load(await s.next);
    } catch {
      // One round failed (usually the network): try building another.
      try {
        load(await nextRound());
      } catch (e) {
        s.next = null;
        setError(e instanceof Error ? e.message : "出错了");
        setPhase("paused");
      }
    }
  }

  function onTime() {
    const a = audio.current!;
    const cur = s.cur;
    if (!cur || a.src !== cur.url) return;
    const t = a.currentTime;
    let i = 0;
    while (i + 1 < cur.starts.length && cur.starts[i + 1] <= t) i++;
    if (i !== s.idx) {
      s.idx = i;
      const clip = cur.clips[i];
      const same = cur.clips.filter((c) => c.block === clip.block);
      setNow({ clip, nth: same.indexOf(clip) + 1, of: same.length });
      if (navigator.mediaSession && typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({ title: clip.show, artist: BLOCK_LABEL[clip.block], album: "摸鱼模式" });
      }
    }
    const nowMs = Date.now();
    const dt = (nowMs - s.tick) / 1000;
    s.tick = nowMs;
    if (!a.paused && dt > 0 && dt < 3) s.pendingSec += dt;
    if (s.pendingSec >= 30) flush();
  }

  function seek(i: number) {
    const a = audio.current!;
    const cur = s.cur;
    if (!cur) return;
    if (i >= cur.clips.length) a.currentTime = Math.max(0, cur.total - 0.05);
    else a.currentTime = cur.starts[Math.max(0, i)] + 0.01;
    if (a.paused) a.play().catch(() => {});
  }

  // Again: back to the start of this sentence (or the one before, right after a new one began).
  function again() {
    const cur = s.cur;
    const a = audio.current;
    if (!cur || !a || s.idx < 0) return;
    const i = a.currentTime - cur.starts[s.idx] > 2 ? s.idx : s.idx - 1;
    const clip = cur.clips[Math.max(0, i)];
    if (clip.line) recordStuck(clip.line);
    seek(i);
  }

  function skip() {
    if (s.cur && s.idx >= 0) seek(s.idx + 1);
  }

  function toggle() {
    const a = audio.current!;
    if (phase === "idle") start();
    else if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function setupMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    ms.setActionHandler("play", () => audio.current?.play().catch(() => {}));
    ms.setActionHandler("pause", () => audio.current?.pause());
    ms.setActionHandler("previoustrack", again);
    ms.setActionHandler("nexttrack", skip);
    // Without these, iPhone shows ±10s buttons instead of previous/next.
    for (const a of ["seekbackward", "seekforward"] as MediaSessionAction[]) {
      try {
        ms.setActionHandler(a, null);
      } catch {}
    }
  }

  const playing = phase === "playing";

  return (
    <main className="moyu">
      <Link href="/" className="back">← 今日</Link>
      <header className="page-mast">
        <div>
          <h1>流す</h1>
          <p className="muted">戴上耳机一直听，锁屏不停</p>
        </div>
      </header>

      <div className="moyu-now">
        {now && phase !== "idle" ? (
          <>
            <div className="moyu-block">
              {BLOCK_LABEL[now.clip.block]} · {now.nth} / {now.of}
            </div>
            <div className="moyu-show">{now.clip.show}</div>
            {now.clip.sub && <div className="moyu-sub">{now.clip.sub}</div>}
          </>
        ) : null}
        {phase === "loading" && <p className="moyu-sub">正在准备下一段…</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="moyu-controls">
        <button className="ghost" onClick={again} disabled={phase === "idle"} aria-label="再听一遍">
          ‹ 再听
        </button>
        <button className="moyu-play" onClick={toggle} disabled={phase === "loading"} aria-label={playing ? "暂停" : "播放"}>
          {phase === "idle" ? "▶" : playing ? "❚❚" : "▶"}
        </button>
        <button className="ghost" onClick={skip} disabled={phase === "idle"} aria-label="跳过">
          跳过 ›
        </button>
      </div>

      <div className="moyu-rates">
        {RATES.map((r) => (
          <button key={r} className={`small ${rate === r ? "on" : ""}`} onClick={() => setRate(r)}>
            {r.toFixed(1)}x
          </button>
        ))}
      </div>

      <p className="moyu-foot">
        今天听了 {minutes} 分钟{stuck > 0 && ` · 卡住 ${stuck} 句`}
      </p>

      <audio
        ref={audio}
        playsInline
        preload="auto"
        onEnded={() => s.cur && audio.current?.src === s.cur.url && onEnded()}
        onTimeUpdate={onTime}
        onPlaying={() => {
          if (audio.current) audio.current.playbackRate = s.rate;
          s.tick = Date.now();
          if (s.cur && audio.current?.src === s.cur.url) setPhase("playing");
        }}
        onPause={() => {
          flush();
          if (s.cur && audio.current?.src === s.cur.url && !audio.current.ended) setPhase("paused");
        }}
      />
    </main>
  );
}
