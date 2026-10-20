"use client";

import { useEffect, useRef, useState } from "react";
import { BLOCK_LABEL, prepare, pruneCache, type Clip, type Prepared } from "./moyu";
import { SILENCE } from "./player";
import { setAudioSession } from "./recorder";

// Plays rounds of clips, each round joined into one MP3 (lib/client/moyu.ts prepare) so it carries on
// with the screen locked; the next round is made while this one plays. For the NHK news pages.

export type Phase = "idle" | "loading" | "playing" | "paused" | "done";
export const RATES = [0.9, 1, 1.1];
const RATE_KEY = "nihongo-speak:news-rate";

export function useJoined(rounds: Clip[][], o: { album: string; onRoundEnd?: (round: number) => void; onDone?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [round, setRound] = useState(0);
  const [idx, setIdx] = useState(-1);
  const [frac, setFrac] = useState(0);
  const [rate, setRateState] = useState(1);
  const [error, setError] = useState("");
  const s = useRef({ cur: null as Prepared | null, round: 0, next: null as Promise<Prepared> | null, rate: 1, rounds, o }).current;
  s.rounds = rounds;
  s.o = o;

  useEffect(() => {
    pruneCache();
    try {
      const r = Number(localStorage.getItem(RATE_KEY));
      if (RATES.includes(r)) setRate(r);
    } catch {}
    const el = audio.current;
    return () => {
      el?.pause();
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

  const make = (i: number) => (i < s.rounds.length ? prepare(s.rounds[i]) : null);

  function load(prep: Prepared, i: number) {
    const a = audio.current;
    if (!a) return URL.revokeObjectURL(prep.url);
    const old = s.cur;
    s.cur = prep;
    s.round = i;
    setRound(i);
    setIdx(-1);
    a.src = prep.url;
    a.defaultPlaybackRate = s.rate;
    a.playbackRate = s.rate;
    a.play().catch((e) => setError(e instanceof Error ? e.message : "播放失败"));
    if (old) URL.revokeObjectURL(old.url);
    s.next = make(i + 1);
    s.next?.catch(() => {});
  }

  async function start(from = 0) {
    const a = audio.current!;
    // iPhone only lets this element play later if it first plays from the tap itself.
    a.src = SILENCE;
    a.play().catch(() => {});
    setAudioSession("playback");
    setError("");
    setPhase("loading");
    setupMediaSession();
    try {
      load(await make(from)!, from);
    } catch (e) {
      setError(e instanceof Error ? e.message : "出错了");
      setPhase("idle");
    }
  }

  async function onEnded() {
    s.o.onRoundEnd?.(s.round);
    const next = s.next;
    if (!next) {
      setPhase("done");
      s.o.onDone?.();
      return;
    }
    setPhase("loading");
    try {
      load(await next, s.round + 1);
    } catch {
      // That round failed (usually the network): go on with the one after.
      const after = await make(s.round + 2)?.catch(() => null);
      if (after) load(after, s.round + 2);
      else {
        setPhase("done");
        s.o.onDone?.();
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
    const end = cur.starts[i + 1] ?? cur.total;
    setFrac(Math.min(1, (t - cur.starts[i]) / Math.max(0.1, end - cur.starts[i] - 0.4)));
    setIdx((was) => {
      if (was !== i && navigator.mediaSession && typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({ title: cur.clips[i].show, artist: BLOCK_LABEL[cur.clips[i].block], album: s.o.album });
      }
      return i;
    });
  }

  // To clip i of this round (as prepare kept them).
  function seek(i: number) {
    const a = audio.current!;
    const cur = s.cur;
    if (!cur) return;
    if (i >= cur.clips.length) a.currentTime = Math.max(0, cur.total - 0.05);
    else a.currentTime = cur.starts[Math.max(0, i)] + 0.01;
    if (a.paused) a.play().catch(() => {});
  }

  // Back to the start of this sentence (or the one before, right after a new one began).
  function again() {
    const cur = s.cur;
    const a = audio.current;
    if (!cur || !a || idx < 0) return;
    seek(a.currentTime - cur.starts[idx] > 1.5 ? idx : idx - 1);
  }

  function skip() {
    if (s.cur && idx >= 0) seek(idx + 1);
  }

  function toggle() {
    const a = audio.current!;
    if (phase === "idle" || phase === "done") start();
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
    for (const a of ["seekbackward", "seekforward"] as MediaSessionAction[]) {
      try {
        ms.setActionHandler(a, null);
      } catch {}
    }
  }

  const audioProps = {
    ref: audio,
    playsInline: true,
    preload: "auto" as const,
    onEnded: () => s.cur && audio.current?.src === s.cur.url && onEnded(),
    onTimeUpdate: onTime,
    onPlaying: () => {
      if (audio.current) audio.current.playbackRate = s.rate;
      if (s.cur && audio.current?.src === s.cur.url) setPhase("playing");
    },
    onPause: () => {
      if (s.cur && audio.current?.src === s.cur.url && !audio.current.ended) setPhase("paused");
    },
  };

  // The clip now playing, as the round passed in (prepare may have dropped one that failed).
  const clip = s.cur && idx >= 0 ? s.cur.clips[idx] : null;
  const total = s.cur?.total ?? 0;
  return { audioProps, phase, round, idx, clip, frac, rate, setRate, error, start, toggle, seek, again, skip, total, time: () => audio.current?.currentTime ?? 0 };
}
