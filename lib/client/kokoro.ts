"use client";

import type { KokoroItem, KokoroSet } from "@/lib/kokoro-model";
import { SENSEI_VOICE } from "@/components/Sensei";
import { dayKey } from "./progress";
import type { Clip, Part } from "./moyu";

// 心で答える: the day's six questions heard three times, the help taken away a lap at a time —
// lap 1 the question, its 型 (blanks beeped) and the words; lap 2 the words only; lap 3 the question
// only. After each a silence to answer in your head, then the model answer.

export const LAPS = 3;
const ANSWER = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";
const BEEP = "/beep2.mp3";
const SET_KEY = "nihongo-speak:kokoro";
const STUCK_KEY = "nihongo-speak:kokoro-stuck";

// Time to answer in your head: by the answer's length, a little less each lap.
export function thinkMs(it: KokoroItem, lap: number) {
  const base = Math.min(14000, Math.max(7000, 3000 + it.answer.length * 170));
  return Math.max(5000, base - lap * 1500);
}

export type KClip = Clip & { item: number; step: "ask" | "think" | "answer" };

const say = (voice: string, text: string, pauseMs = 300): Part => ({ voice, text, pauseMs });

function patternParts(lines: string[]): Part[] {
  const out: Part[] = [];
  for (const line of lines) {
    for (const [i, piece] of line.split("＿").entries()) {
      if (i) out.push({ voice: ANSWER, sound: BEEP, pauseMs: 120 });
      if (piece.replace(/[。、]/g, "")) out.push(say(ANSWER, piece, 120));
    }
    out[out.length - 1] = { ...out[out.length - 1], pauseMs: 600 };
  }
  return out;
}

// One lap as clips, three per question (ask, think, answer), so the screen knows which step is on.
export function lapClips(set: KokoroSet, lap: number): KClip[] {
  const out: KClip[] = [];
  set.items.forEach((it, i) => {
    const show = it.q;
    const open = i === 0 && lap > 0 ? [say(SENSEI_VOICE, lap === 1 ? "二周目。今度はことばだけ。" : "最後です。今度は一人で。", 700)] : [];
    const ask: Part[] = [...open, say(SENSEI_VOICE, it.q, 700)];
    if (lap === 0) ask.push(...patternParts(it.pattern));
    if (lap < 2) ask.push(...it.words.map((w, n) => say(ANSWER, w.ja, n === it.words.length - 1 ? 500 : 250)));
    out.push({ block: "quick", show, item: i, step: "ask", parts: ask });
    out.push({ block: "quick", show, item: i, step: "think", parts: [{ voice: "", pauseMs: thinkMs(it, lap) }] });
    const answer: Part[] = lap === 0 ? [say(ANSWER, it.answer, 900), say(ANSWER, it.answer, 1500)] : [say(ANSWER, it.answer, 1500)];
    out.push({ block: "quick", show: it.answer, item: i, step: "answer", parts: answer });
  });
  return out;
}

// ---- The day's set: asked once, kept on the phone ----

export function savedSet(day = dayKey()): KokoroSet | null {
  try {
    const s = JSON.parse(localStorage.getItem(SET_KEY) ?? "null") as KokoroSet | null;
    return s?.day === day ? s : null;
  } catch {
    return null;
  }
}

export async function loadSet(day = dayKey()): Promise<KokoroSet> {
  const res = await fetch(`/api/kokoro?day=${day}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "出题失败");
  try {
    localStorage.setItem(SET_KEY, JSON.stringify(data));
  } catch {}
  return data as KokoroSet;
}

// ---- Questions the learner went back to (⏮): said out loud on the way home ----

type Stuck = { day: string; ids: Record<string, number>; done: string[]; laps: number };

export function readStuck(day = dayKey()): Stuck {
  try {
    const s = JSON.parse(localStorage.getItem(STUCK_KEY) ?? "null") as Stuck | null;
    if (s?.day === day) return s;
  } catch {}
  return { day, ids: {}, done: [], laps: 0 };
}

function writeStuck(s: Stuck) {
  try {
    localStorage.setItem(STUCK_KEY, JSON.stringify(s));
  } catch {}
}

export function markStuck(id: string) {
  const s = readStuck();
  writeStuck({ ...s, ids: { ...s.ids, [id]: (s.ids[id] ?? 0) + 1 } });
}

export function markSaid(id: string) {
  const s = readStuck();
  if (!s.done.includes(id)) writeStuck({ ...s, done: [...s.done, id] });
}

export function markLap(lap: number) {
  const s = readStuck();
  if (lap > s.laps) writeStuck({ ...s, laps: lap });
}
