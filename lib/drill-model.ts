// 型ドリル: a word or grammar point the learner typed, built into a ladder of sentences. Each step
// changes one thing in the step before it (sub: swap a word, form: change the form, add: say more),
// four levels from a two-word phrase up to a sentence said at work.
// The other kinds of card build a sentence without the one before it: build (its words without the
// particles, to put in order and join), fix (a sentence said wrong, as Chinese speakers often do),
// join (two or three short sentences made one with the cue), put (a sentence put inside the cue's frame),
// finish (the start of a sentence, the rest from its Chinese). parts: what the card shows for them; mark:
// the part being practised (it must be in what was said), and its reading.
export type DrillOp = "base" | "sub" | "form" | "add" | "build" | "fix" | "join" | "put" | "finish";
export type DrillStep = {
  lv: number;
  op: DrillOp;
  cue: string;
  cue_zh: string;
  ja: string;
  kana: string;
  zh: string;
  parts?: string[];
  mark?: string;
  mark_kana?: string;
};
// A card that changes the sentence before it, so that sentence is shown above it.
export const CHAINED: DrillOp[] = ["base", "sub", "form", "add"];
// tier: 1 the first ladder; 2 and 3 the 升级 ones (中級, 会話) for something already said fast.
export type Ladder = { seed: string; meaning_zh: string; made: number; tier?: number; steps: DrillStep[] };

export const LEVELS = 4;
export const TIERS = 3;
export const TIER_NAME = ["", "基本", "中級", "会話"];
export const tierOf = (l: Ladder) => Math.min(TIERS, Math.max(1, l.tier ?? 1));

// What a word or grammar point is kept under: no spaces, ～ and 〜 the same, a leading 〜 left off (たら is 〜たら).
export const seedKey = (s: string) => s.trim().replace(/\s+/g, "").replace(/[~～]/g, "〜").replace(/^〜+/, "").slice(0, 30);
