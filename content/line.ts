import type { Line } from "./scenarios";

// One line of a scene: who says it, in which voice, the English and its Chinese.
export const L = (speaker: string, voice: string, ja: string, zh: string): Line => ({ speaker, voice, ja, kana: "", zh });
