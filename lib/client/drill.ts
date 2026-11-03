"use client";

import { ANSWER_VOICE, ASK_VOICE, HINT_VOICE, OPENERS, PATTERNS } from "@/content/kokoro-patterns";
import type { Drill, DrillItem } from "@/lib/drill-model";
import { dayKey } from "./progress";
import type { Clip, Part } from "./moyu";

// 型ドリル: the pattern drills of FSI-style courses (瞬間作文), on the learner's own sentences. One 型
// a round, a dozen sentences, twice through: each heard in Chinese, said out loud in Japanese at
// once, then the model heard (and in the first pass said again after it). The second pass is in
// another order with less time, so the 型 has to come by itself.

export const PASSES = 2;
const KEY = "nihongo-speak:drill";

export type DClip = Clip & { item: number; pass: number; step: "cue" | "say" | "model" };

// Time to say it: by its length, a second less in the second pass.
export function sayMs(it: DrillItem, pass: number) {
  const base = Math.min(7500, Math.max(3500, 2000 + it.ja.length * 130));
  return Math.max(3000, base - pass * 1000);
}

const part = (voice: string, text: string, pauseMs = 0, pauseFor?: number): Part => ({ voice, text, pauseMs, pauseFor });

// The order of the second pass: every fifth one from the end, so neighbours don't stay neighbours.
export function order(n: number, pass: number) {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (!pass) return idx;
  const out: number[] = [];
  const step = n % 5 ? 5 : 7;
  for (let k = 0, i = n - 1; k < n; k++, i = (i + step) % n) out.push(i);
  return new Set(out).size === n ? out : idx.reverse();
}

export function drillClips(d: Drill): DClip[] {
  const out: DClip[] = [];
  for (let pass = 0; pass < PASSES; pass++) {
    order(d.items.length, pass).forEach((i, k) => {
      const it = d.items[i];
      const open = pass > 0 && k === 0 ? [part(ASK_VOICE, OPENERS[0], 700)] : [];
      out.push({ block: "quick", show: it.zh, item: i, pass, step: "cue", parts: [...open, part(HINT_VOICE, it.zh, 100)] });
      out.push({ block: "quick", show: it.zh, item: i, pass, step: "say", parts: [{ voice: "", pauseMs: sayMs(it, pass) }] });
      // First pass: time after the model to say it again, about as long as it took.
      const model = pass === 0 ? part(ANSWER_VOICE, it.ja, 700, 1.1) : part(ANSWER_VOICE, it.ja, 900);
      out.push({ block: "quick", show: it.ja, item: i, pass, step: "model", parts: [model] });
    });
  }
  return out;
}

// ---- Which 型: the one drilled least, not today's again ----

type Done = Record<string, { n: number; last: string }>;

function readDone(): Done {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "null") as Done | null) ?? {};
  } catch {
    return {};
  }
}

export function nextForm(skip: string[] = []): string {
  const done = readDone();
  const today = dayKey();
  const pool = PATTERNS.filter((p) => !skip.includes(p.id) && done[p.id]?.last !== today);
  const list = pool.length ? pool : PATTERNS.filter((p) => !skip.includes(p.id));
  const by = (id: string) => done[id] ?? { n: 0, last: "" };
  return [...(list.length ? list : PATTERNS)].sort((a, b) => by(a.id).n - by(b.id).n || (by(a.id).last < by(b.id).last ? -1 : by(a.id).last > by(b.id).last ? 1 : 0))[0].id;
}

// The 型 being drilled today, kept so the page opens on it again.
const CUR = "nihongo-speak:drill-now";
export function currentForm(): string {
  try {
    const c = JSON.parse(localStorage.getItem(CUR) ?? "null") as { day: string; form: string } | null;
    if (c?.day === dayKey() && PATTERNS.some((p) => p.id === c.form)) return c.form;
  } catch {}
  return nextForm();
}
export function keepForm(form: string) {
  try {
    localStorage.setItem(CUR, JSON.stringify({ day: dayKey(), form }));
  } catch {}
}

export function markDone(form: string) {
  const done = readDone();
  done[form] = { n: (done[form]?.n ?? 0) + 1, last: dayKey() };
  try {
    localStorage.setItem(KEY, JSON.stringify(done));
  } catch {}
}

export const timesDone = (form: string) => readDone()[form]?.n ?? 0;

export async function loadDrill(form: string, day = dayKey()): Promise<Drill> {
  const res = await fetch(`/api/kata?form=${form}&day=${day}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "出题失败");
  return data as Drill;
}
