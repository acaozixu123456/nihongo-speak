// 私の一言: a sentence the learner really said (or wanted to say) in their own day, taken apart so it is
// understood, drilled through its 型, and said again from a situation on days 1, 3 and 7 until it sticks.
export type HitoPart = { ja: string; zh: string; note_zh: string };
export type HitoVersion = { to: string; ja: string; zh: string };
export type HitoDraft = {
  ja: string;
  kana: string;
  zh: string;
  fix_zh: string;
  parts: HitoPart[];
  versions: HitoVersion[];
  kata: string;
  kata_zh: string;
  scene_zh: string;
  reply_ja: string;
  reply_zh: string;
};
// step: how many recalls in a row came right; due: the day it is asked again.
export type Hito = HitoDraft & { id: string; typed: string; added: number; step: number; due: string; last?: string };

// Days to the next recall after the n-th right one in a row: day 1, day 3, day 7, then two weeks, a month.
export const GAPS = [1, 2, 4, 7, 16, 30];
// Right on days 1, 3 and 7: it has stuck.
export const STUCK = 3;

export const hitoKey = (s: string) => s.normalize("NFKC").replace(/[\s。、，,.!！?？「」]/g, "").slice(0, 80);
