"use client";

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

// Tells `f` when a sound starts and stops playing (so background music can dip under voices).
export function onSound(f: (playing: boolean) => void) {
  const a = el();
  const on = () => f(a.src !== SILENCE);
  const off = () => f(false);
  a.addEventListener("playing", on);
  a.addEventListener("pause", off);
  a.addEventListener("ended", off);
  return () => {
    a.removeEventListener("playing", on);
    a.removeEventListener("pause", off);
    a.removeEventListener("ended", off);
  };
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

export { ttsUrl } from "@/lib/tts-url";

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

// How far the sound now playing has got (seconds into it, its length), for text that follows along.
export function progress() {
  const a = el();
  return { at: a.currentTime, of: Number.isFinite(a.duration) ? a.duration : 0 };
}

// The thing just tapped (a ▶, a sentence, a 聞く button) shows the wait on itself: data-audio="wait"
// while its sound is fetched (a spinner, see globals.css), "play" once it sounds. Found from the tap,
// so no page has to wire it up: the nearest element React gave an onClick, else the nearest button.
let tapped: { at: number; el: HTMLElement } | null = null;
let owner: HTMLElement | null = null;
let ownerPos = "";

function clickable(t: EventTarget | null): HTMLElement | null {
  for (let n = t instanceof Element ? t : null; n && n !== document.body; n = n.parentElement) {
    if (n.matches("button, [role=button], a[href]")) return n as HTMLElement;
    const k = Object.keys(n).find((k) => k.startsWith("__reactProps$"));
    if (k && typeof (n as unknown as Record<string, { onClick?: unknown }>)[k]?.onClick === "function") return n as HTMLElement;
  }
  return null;
}

if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (e) => {
      const n = clickable(e.target);
      // A whole stage or sheet isn't marked; the small note at the top says it instead.
      const r = n?.getBoundingClientRect();
      tapped = n && r && r.width * r.height < innerWidth * innerHeight * 0.3 ? { at: Date.now(), el: n } : null;
    },
    true,
  );
}

function mark(state: "wait" | "play" | null) {
  const n = owner;
  if (!n) return;
  n.querySelector(":scope > .aw-spin")?.remove();
  if (!state) {
    delete n.dataset.audio;
    delete n.dataset.audioSmall;
    n.style.position = ownerPos;
    owner = null;
    return;
  }
  n.dataset.audio = state;
  delete n.dataset.audioSmall;
  if (state === "wait") {
    const r = n.getBoundingClientRect();
    const css = getComputedStyle(n);
    const s = document.createElement("span");
    s.className = "aw-spin";
    // A button gives its whole face to the spinner, drawn in its own text colour; a sentence keeps
    // its words and gets the spinner at its right edge.
    if (r.height < 64 && n.matches("button, [role=button], a[href]")) {
      s.style.setProperty("--aw", css.color);
      n.dataset.audioSmall = "";
    }
    if (css.position === "static") n.style.position = "relative";
    s.setAttribute("aria-hidden", "true");
    n.appendChild(s);
  }
}

export function stop() {
  turn++;
  setWaiting(false);
  mark(null);
  const a = el();
  a.pause();
  finish?.();
  finish = null;
}

// Resolves when playback ends or is stopped.
export function play(src: string, playbackRate = rate): Promise<void> {
  // Each tap marks the first sound it starts, and only one started soon after it.
  const t = tapped && Date.now() - tapped.at < 3000 && tapped.el.isConnected ? tapped.el : null;
  tapped = null;
  stop();
  const mine = turn;
  if (t) {
    owner = t;
    ownerPos = t.style.position;
    mark("wait");
  }
  // A recording that never closed properly leaves iPhone in call mode, where sound
  // goes to the quiet earpiece. Playback always switches back to the speaker.
  if (!isRecording()) setAudioSession("playback");
  const a = el();
  return new Promise((resolve, reject) => {
    const done = () => {
      a.onended = a.onerror = a.onplaying = null;
      if (mine === turn) mark(null);
      resolve();
    };
    finish = done;
    const fail = (e: unknown) => {
      finish = null;
      a.onended = a.onerror = a.onplaying = null;
      if (mine === turn) mark(null);
      reject(e);
    };
    // A recording already kept answers at once; only a real wait is shown.
    // The note at the top is only for a sound nothing on the page is marked for.
    const slow = setTimeout(() => mine === turn && !owner && setWaiting(true), 400);
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
        if (mine === turn) mark("play");
      };
      a.src = url;
      a.defaultPlaybackRate = playbackRate;
      a.playbackRate = playbackRate;
      a.play().catch(fail);
    }, (e) => mine === turn && fail(e));
  });
}
