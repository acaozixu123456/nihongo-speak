// 汉字助记, kept small on purpose: only kanji whose shape really is a picture of the thing get a line drawing
// next to them (形→義). It is a memory aid, not the character's history, and says so on screen; other kanji
// get nothing (no made-up stories).

export type Mnemonic = { k: string; zh: string; d: string };

// Line drawings on a 40×40 grid.
export const MNEMONICS: Mnemonic[] = [
  { k: "山", zh: "山", d: "M4 34 L12 16 L17 26 L20 6 L24 26 L29 16 L36 34 Z" },
  { k: "川", zh: "河", d: "M11 5 C7 16 13 25 8 36 M20 5 C16 16 22 25 17 36 M29 5 C25 16 31 25 26 36" },
  { k: "木", zh: "树", d: "M20 4 V36 M7 15 L20 21 L33 15 M20 26 L10 36 M20 26 L30 36" },
  { k: "日", zh: "太阳", d: "M20 6 A14 14 0 1 0 20.01 6 M12 20 H28" },
  { k: "月", zh: "月亮", d: "M24 4 A16 16 0 1 0 24 36 A12 12 0 1 1 24 4 Z" },
  { k: "口", zh: "嘴", d: "M6 20 Q20 4 34 20 Q20 36 6 20 Z" },
  { k: "目", zh: "眼睛", d: "M4 20 Q20 6 36 20 Q20 34 4 20 Z M20 14 A6 6 0 1 0 20.01 14" },
  { k: "人", zh: "人", d: "M20 6 A4 4 0 1 0 20.01 6 M20 14 L17 25 L10 36 M17 25 L27 36 M19 18 L28 23" },
  { k: "火", zh: "火", d: "M20 4 C31 16 31 25 25 32 C27 23 22 20 20 14 C18 22 12 24 15 32 C8 26 10 14 20 4 Z M8 12 L11 16 M32 12 L29 16" },
  { k: "雨", zh: "雨", d: "M5 14 Q20 2 35 14 Z M11 19 V24 M11 29 V34 M20 19 V24 M20 29 V34 M29 19 V24 M29 29 V34" },
  { k: "田", zh: "田地", d: "M6 6 H34 V34 H6 Z M20 6 V34 M6 20 H34" },
  { k: "門", zh: "门", d: "M6 6 V36 M6 6 H16 V18 H6 M34 6 V36 M34 6 H24 V18 H34" },
];

export const mnemonicsIn = (word: string) => MNEMONICS.filter((m) => word.includes(m.k));
