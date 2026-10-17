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
  return `/api/tts?${new URLSearchParams({ text, voice, v: "2" })}`;
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
