"use client";

import { useEffect, useRef, useState } from "react";
import { BLOCK_LABEL, prepare, pruneCache, type Clip, type Prepared } from "./moyu";
import { SILENCE } from "./player";
import { setAudioSession } from "./recorder";

// Plays rounds of clips, each round joined into one MP3 (lib/client/moyu.ts prepare) so it carries on
// with the screen locked; the next round is made while this one plays. For the NHK news pages.

export type Phase = "idle" | "loading" | "playing" | "paused" | "done";
export const RATES = [0.8, 1, 1.2, 1.4];
const RATE_KEY = "nihongo-speak:news-rate";
// Loop: off, the sentence playing, or the whole round (the article) again and again. voices: the round again
// in the next voice; six: each sentence in all six voices; talk: the same with a beep and time to say it
// after each. The page does those three (here they end like off).
export type Loop = "off" | "one" | "all" | "voices" | "six" | "talk";
export const LOOPS: Loop[] = ["off", "one", "all", "voices", "six", "talk"];
const LOOP_KEY = "nihongo-speak:news-loop";

// onRoundEnd may hold the next round back until it settles (a question between rounds).
// idx, seek: the clip's place in the round as passed in, even when prepare dropped one that failed.
// paceOf: how much faster (or slower) a round goes on top of the speed the learner picked.
export function useJoined(rounds: Clip[][], o: { album: string; loopable?: boolean; paceOf?: (round: number) => number; onRoundEnd?: (round: number) => void | Promise<void>; onDone?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [round, setRound] = useState(0);
  const [idx, setIdx] = useState(-1);
  const [frac, setFrac] = useState(0);
  const [rate, setRateState] = useState(1);
  const [loop, setLoopState] = useState<Loop>("off");
  const [error, setError] = useState("");
  const s = useRef({ cur: null as Prepared | null, round: 0, next: null as Promise<Prepared> | null, rate: 1, loop: "off" as Loop, hold: -1, rounds, o }).current;
  s.rounds = rounds;
  s.o = o;

  useEffect(() => {
    pruneCache();
    try {
      const r = Number(localStorage.getItem(RATE_KEY));
      if (RATES.includes(r)) setRate(r);
      const l = localStorage.getItem(LOOP_KEY) as Loop | null;
      if (o.loopable && l && LOOPS.includes(l)) setLoop(l);
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

  // The speed the audio plays at: the learner's, times this round's pace.
  const speed = () => Math.min(1.6, Math.max(0.6, s.rate * (s.o.paceOf?.(s.round) ?? 1)));

  function setRate(r: number) {
    s.rate = r;
    setRateState(r);
    if (audio.current) audio.current.playbackRate = speed();
    try {
      localStorage.setItem(RATE_KEY, String(r));
    } catch {}
  }

  function setLoop(l: Loop) {
    s.loop = l;
    s.hold = s.cur ? curIdx() : -1;
    setLoopState(l);
    try {
      localStorage.setItem(LOOP_KEY, l);
    } catch {}
  }

  // The kept clip the audio is in now.
  function curIdx() {
    const cur = s.cur;
    const a = audio.current;
    if (!cur || !a) return -1;
    let i = 0;
    while (i + 1 < cur.starts.length && cur.starts[i + 1] <= a.currentTime) i++;
    return i;
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
    s.hold = -1;
    a.src = prep.url;
    a.defaultPlaybackRate = speed();
    a.playbackRate = speed();
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
    const a = audio.current;
    if (a && s.cur && (s.loop === "one" || s.loop === "all")) {
      // Again from the start of the sentence held, or of the round.
      a.currentTime = s.loop === "one" && s.hold >= 0 ? s.cur.starts[s.hold] + 0.01 : 0;
      a.play().catch(() => {});
      return;
    }
    const hold = s.o.onRoundEnd?.(s.round);
    const next = s.next;
    if (hold) {
      setPhase("loading");
      await hold;
    }
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
    // 1文 loop: the moment the next sentence starts, back to the start of the one held.
    if (s.loop === "one") {
      if (s.hold < 0) s.hold = i;
      else if (i === s.hold + 1 && t - cur.starts[i] < 0.6) {
        a.currentTime = cur.starts[s.hold] + 0.01;
        return;
      }
    }
    const end = cur.starts[i + 1] ?? cur.total;
    setFrac(Math.min(1, (t - cur.starts[i]) / Math.max(0.1, end - cur.starts[i] - 0.4)));
    setIdx((was) => {
      if (was !== i && navigator.mediaSession && typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({ title: cur.clips[i].show, artist: BLOCK_LABEL[cur.clips[i].block], album: s.o.album });
      }
      return i;
    });
  }

  // Where clip k as prepare kept it was in the round passed in.
  const origOf = (k: number) => (s.cur && k >= 0 ? s.rounds[s.round]?.indexOf(s.cur.clips[k]) ?? k : -1);

  // To kept clip k of this round.
  function seekKept(k: number) {
    const a = audio.current!;
    const cur = s.cur;
    if (!cur) return;
    s.hold = Math.min(Math.max(0, k), cur.clips.length - 1);
    if (k >= cur.clips.length) a.currentTime = Math.max(0, cur.total - 0.05);
    else a.currentTime = cur.starts[Math.max(0, k)] + 0.01;
    if (a.paused) a.play().catch(() => {});
  }

  // To clip i of the round passed in (the next one kept, if that one failed).
  function seek(i: number) {
    const cur = s.cur;
    if (!cur) return;
    let k = 0;
    while (k < cur.clips.length && origOf(k) < i) k++;
    seekKept(k);
  }

  // Back to the start of this sentence (or the one before, right after a new one began).
  function again() {
    const cur = s.cur;
    const a = audio.current;
    if (!cur || !a || idx < 0) return;
    seekKept(a.currentTime - cur.starts[idx] > 1.5 ? idx : idx - 1);
  }

  function skip() {
    if (s.cur && idx >= 0) seekKept(idx + 1);
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
      if (audio.current) audio.current.playbackRate = speed();
      if (s.cur && audio.current?.src === s.cur.url) setPhase("playing");
    },
    onPause: () => {
      if (s.cur && audio.current?.src === s.cur.url && !audio.current.ended) setPhase("paused");
    },
  };

  // The clip now playing, as the round passed in (prepare may have dropped one that failed).
  const clip = s.cur && idx >= 0 ? s.cur.clips[idx] : null;
  const total = s.cur?.total ?? 0;
  return { audioProps, phase, round, idx: origOf(idx), clip, frac, rate, setRate, loop, setLoop, error, start, toggle, seek, again, skip, total, time: () => audio.current?.currentTime ?? 0 };
}
