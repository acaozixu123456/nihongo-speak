// 心で答える: one question with its 型 (pattern lines, ＿ = what the learner fills in), the words it
// needs and a model answer. fits: the answer really contains the 型's fixed parts.
export type KokoroItem = {
  id: string;
  kind: "work" | "life";
  q: string;
  q_zh: string;
  forms: string[];
  pattern: string[];
  words: { ja: string; zh: string }[];
  answer: string;
  answer_zh: string;
  fits: boolean;
};

// earlier: the day's questions before this set (of the sets it replaced, and on a phone of those it
// went through), kept out of the sets that follow.
export type KokoroSet = { day: string; made: number; work: boolean; items: KokoroItem[]; earlier?: string[] };

// The parts of a 型 said as they are: what's left between the blanks and the punctuation.
export const fixedParts = (form: string) =>
  form
    .split(/[＿。、！？\s]/)
    .filter((s) => s.length >= 2);
