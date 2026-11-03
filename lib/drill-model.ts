// 型ドリル: a word or grammar point the learner typed, built into a ladder of sentences. Each step
// changes one thing in the step before it (sub: swap a word, form: change the form, add: say more),
// four levels from a two-word phrase up to a sentence said at work.
export type DrillOp = "base" | "sub" | "form" | "add";
export type DrillStep = { lv: number; op: DrillOp; cue: string; cue_zh: string; ja: string; kana: string; zh: string };
export type Ladder = { seed: string; meaning_zh: string; made: number; steps: DrillStep[] };

export const LEVELS = 4;

// What a word or grammar point is kept under: no spaces, ～ and 〜 the same.
export const seedKey = (s: string) => s.trim().replace(/\s+/g, "").replace(/[~～]/g, "〜").slice(0, 30);
