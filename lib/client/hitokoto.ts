"use client";

import { addDays, dayKey } from "@/lib/progress-model";
import { GAPS, STUCK, hitoKey, type Hito, type HitoDraft } from "@/lib/hitokoto-model";

// 私の一言 on the phone: the sentences kept, each with when it is asked again.
const KEY = "nihongo-speak:hitokoto";

export function readHito(): Hito[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Hito[];
    return Array.isArray(list) ? list.filter((h) => h && typeof h.ja === "string" && Array.isArray(h.parts)) : [];
  } catch {
    return [];
  }
}

function writeHito(list: Hito[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
  } catch {}
}

export async function explainHito(text: string): Promise<HitoDraft> {
  const res = await fetch("/api/hitokoto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "出错了");
  return data as HitoDraft;
}

// Kept (or found again if it was kept already). First asked again tomorrow.
export function addHito(typed: string, d: HitoDraft): Hito {
  const list = readHito();
  const old = list.find((h) => hitoKey(h.ja) === hitoKey(d.ja) || hitoKey(h.typed) === hitoKey(typed));
  if (old) return old;
  const h: Hito = { ...d, id: Date.now().toString(36), typed, added: Date.now(), step: 0, due: addDays(dayKey(), 1) };
  writeHito([h, ...list]);
  return h;
}

export const findHito = (id: string) => readHito().find((h) => h.id === id);

export const isDue = (h: Hito, today = dayKey()) => h.due <= today;
export const isStuck = (h: Hito) => h.step >= STUCK;
export const dueHito = (list = readHito(), today = dayKey()) => list.filter((h) => isDue(h, today));

// A recall, the first try of the day only: right moves it on (1, 3, 7 days...), anything else starts it
// over from tomorrow. Practised before it was due (from its page): today doesn't count.
export function recallHito(id: string, right: boolean) {
  const today = dayKey();
  const list = readHito();
  const h = list.find((x) => x.id === id);
  if (!h || h.last === today || !isDue(h, today)) return;
  const step = right ? h.step + 1 : 0;
  const next: Hito = { ...h, step, last: today, due: addDays(today, GAPS[Math.min(GAPS.length - 1, step)] ?? 30) };
  writeHito(list.map((x) => (x.id === id ? next : x)));
}

export function removeHito(id: string) {
  writeHito(readHito().filter((h) => h.id !== id));
}
