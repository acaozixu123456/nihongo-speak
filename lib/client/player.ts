"use client";

import { VOICE_LIBRARY } from "@/lib/voice-library";
import { voiceKey } from "@/lib/voice-key";
import { isRecording, setAudioSession } from "./recorder";

// iOS Safari only lets an <audio> element play without a tap once that same element
// has been played from a tap. So every sound goes through one shared element, and
// unlock() is called at the start of each tap that will later play audio.
let audio: HTMLAudioElement | null = null;
let unlocked = false;
let rate = 1;

// 0.1s of silence.
export const SILENCE =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

function el() {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
  }
  return audio;
}

export function unlock() {
  if (unlocked) return;
  const a = el();
  a.src = SILENCE;
  a.play().then(() => (unlocked = true)).catch(() => {});
}

export function setRate(r: number) {
  rate = r;
  const a = el();
  a.defaultPlaybackRate = r;
  a.playbackRate = r;
}

// Fixed content was recorded ahead of time (scripts/bake-voices.ts) and ships with the site, so
// it keeps its HD voice and plays without Azure. Anything else is synthesized on demand.
export function ttsUrl(text: string, voice: string) {
  const key = voiceKey(text, voice);
  if (VOICE_LIBRARY.has(key)) return `/voice/${key}.mp3`;
  // v=2 skips anything the browser kept from before fallback voices were marked no-store.
  // yomi=1: text with no kana used to be read in Chinese (the server now says its reading instead),
  // so it gets a new address instead of the copy the phone and the CDN kept. yomi=2: that reading
  // often didn't come back, so many such words were still kept read in Chinese. yomi=3: a wrong
  // reading (木炭 as たんざん) could be kept too.
  const kanjiOnly = voice.startsWith("ja-JP") && !/[\u3040-\u30f5\u30f7-\u30fa\u30fd-\u30ff]/.test(text);
  return `/api/tts?${new URLSearchParams({ text, voice, v: "2", ...(kanjiOnly ? { yomi: "3" } : {}) })}`;
}

// Every recording played here (made on demand, or pre-recorded under /voice) is also kept: in memory as a ready blob for instant replays, and in the
// same Cache Storage 趣味电台 fills while it makes an episode, so a sentence heard there (or tapped
// once) plays straight away next time, even after the app was closed.
export const AUDIO_CACHE = "nihongo-speak-moyu-v2";
const ready = new Map<string, Promise<string>>();

const cacheable = (src: string) => src.startsWith("/api/tts") || src.startsWith("/voice/");

async function fetchBlob(src: string): Promise<{ blob: Blob; keep: boolean }> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(AUDIO_CACHE);
    const hit = await cache.match(src);
    if (hit) return { blob: await hit.blob(), keep: true };
  } catch {}
  const res = await fetch(src);
  if (!res.ok) throw new Error("音频加载失败");
  const blob = await res.blob();
  // The server marks a fallback voice no-store: ask again next time instead of keeping it.
  const keep = !res.headers.get("cache-control")?.includes("no-store");
  if (cache && keep) {
    cache.put(src, new Response(blob, { headers: { "Content-Type": "audio/mpeg" } })).catch(() => {});
  }
  return { blob, keep };
}

// A blob: URL holding the recording, fetched once.
function load(src: string): Promise<string> {
  if (!cacheable(src)) return Promise.resolve(src);
  let p = ready.get(src);
  if (!p) {
    p = fetchBlob(src).then(({ blob, keep }) => {
      if (!keep) ready.delete(src);
      return URL.createObjectURL(blob);
    });
    p.catch(() => ready.delete(src));
    ready.set(src, p);
  }
  return p;
}

// Fetch recordings ahead of the tap, a couple at a time so the server isn't asked for a dozen at once.
export function preload(srcs: string[]) {
  const todo = srcs.filter((s) => cacheable(s) && !ready.has(s));
  const next = (): Promise<void> | undefined => {
    const s = todo.shift();
    if (s) return load(s).then(next, next);
  };
  next();
  next();
}

let finish: (() => void) | null = null;
// Bumped by every stop(), so a recording still loading when another tap comes in never starts.
let turn = 0;

// True while a tapped sound is still being fetched (made on demand, it can take a few seconds),
// so the page can say so instead of sitting silent. AudioWait in the root layout shows it.
let waiting = false;
const waiters = new Set<() => void>();
function setWaiting(v: boolean) {
  if (waiting === v) return;
  waiting = v;
  waiters.forEach((f) => f());
}
export const isWaiting = () => waiting;
export function onWaiting(f: () => void) {
  waiters.add(f);
  return () => {
    waiters.delete(f);
  };
}

export function stop() {
  turn++;
  setWaiting(false);
  const a = el();
  a.pause();
  finish?.();
  finish = null;
}

// Resolves when playback ends or is stopped.
export function play(src: string, playbackRate = rate): Promise<void> {
  stop();
  const mine = turn;
  // A recording that never closed properly leaves iPhone in call mode, where sound
  // goes to the quiet earpiece. Playback always switches back to the speaker.
  if (!isRecording()) setAudioSession("playback");
  const a = el();
  return new Promise((resolve, reject) => {
    const done = () => {
      a.onended = a.onerror = a.onplaying = null;
      resolve();
    };
    finish = done;
    const fail = (e: unknown) => {
      finish = null;
      a.onended = a.onerror = a.onplaying = null;
      reject(e);
    };
    // A recording already kept answers at once; only a real wait is shown.
    const slow = setTimeout(() => mine === turn && setWaiting(true), 400);
    const loaded = load(src);
    loaded.finally(() => {
      clearTimeout(slow);
      if (mine === turn) setWaiting(false);
    }).catch(() => {});
    loaded.then((url) => {
      if (mine !== turn) return;
      a.onended = done;
      a.onerror = () => fail(new Error("音频加载失败"));
      // Safari resets playbackRate when the source changes.
      a.onplaying = () => {
        a.playbackRate = playbackRate;
      };
      a.src = url;
      a.defaultPlaybackRate = playbackRate;
      a.playbackRate = playbackRate;
      a.play().catch(fail);
    }, (e) => mine === turn && fail(e));
  });
}
