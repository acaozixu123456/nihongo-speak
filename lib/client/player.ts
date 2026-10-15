"use client";

// iOS Safari only lets an <audio> element play without a tap once that same element
// has been played from a tap. So every sound goes through one shared element, and
// unlock() is called at the start of each tap that will later play audio.
let audio: HTMLAudioElement | null = null;
let unlocked = false;
let rate = 1;

// 0.1s of silence.
const SILENCE =
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

export function ttsUrl(text: string, voice: string) {
  return `/api/tts?${new URLSearchParams({ text, voice })}`;
}

let finish: (() => void) | null = null;

export function stop() {
  const a = el();
  a.pause();
  finish?.();
  finish = null;
}

// Resolves when playback ends or is stopped.
export function play(src: string, playbackRate = rate): Promise<void> {
  stop();
  const a = el();
  return new Promise((resolve, reject) => {
    const done = () => {
      a.onended = a.onerror = a.onplaying = null;
      resolve();
    };
    finish = done;
    a.onended = done;
    a.onerror = () => {
      finish = null;
      a.onended = a.onerror = a.onplaying = null;
      reject(new Error("音频加载失败"));
    };
    // Safari resets playbackRate when the source changes.
    a.onplaying = () => {
      a.playbackRate = playbackRate;
    };
    a.src = src;
    a.defaultPlaybackRate = playbackRate;
    a.playbackRate = playbackRate;
    a.play().catch((e) => {
      finish = null;
      reject(e);
    });
  });
}
