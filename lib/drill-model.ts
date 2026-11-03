// 型ドリル: one 型 (from 心で答える's list) and a dozen sentences in it, easy ones first. Each
// sentence is heard in Chinese and said out loud in Japanese at once.
export type DrillItem = { ja: string; zh: string };
export type Drill = { day: string; made: number; form: string; pattern: string; zh: string; items: DrillItem[] };

export const DRILL_SIZE = 12;
