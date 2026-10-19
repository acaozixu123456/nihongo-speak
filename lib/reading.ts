import "server-only";
import { kanaReading } from "@/lib/claude";
import { readingOf } from "@/lib/vertex-tts";

// Readings of Japanese words, asked of Gemini and Haiku together. Either can fail now and then, and
// either can be wrong (Gemini gave 木炭 as たんざん), so a reading only counts when both say it.

const plain = (r: string) => r.replace(/[\s、。！？・]/g, "");
// カタカナ → ひらがな, so 「なまがわき」 and 「ナマガワキ」 are the same reading.
const hira = (r: string) => plain(r).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export type Heard = { a: string | null; b: string | null };

export async function bothReadings(text: string): Promise<Heard> {
  const [a, b] = await Promise.all([readingOf(text), kanaReading(text)].map((p) => p.catch(() => null)));
  return { a, b };
}

// For /api/tts: the agreed reading, or the only one that came back; null when they differ.
export function agreed({ a, b }: Heard, text: string): string | null {
  if (a && b) return hira(a) === hira(b) ? a : (console.warn(`readings differ for ${text}: ${a} / ${b}`), null);
  return a ?? b;
}

const KANJI = /[一-龯々〆ヶ]/;

// The readings the episode's notes show over its words (story.keys, words), checked: the script
// model wrote them in one go with everything else and sometimes gets one wrong (生乾き as
// なまどらき). A reading Gemini and Haiku agree on wins; otherwise the written one stays only if one
// of them says the same; otherwise it's dropped ("") rather than shown wrong.
export async function checkReadings(words: { ja: string; kana: string }[]): Promise<string[]> {
  return Promise.all(
    words.map(async ({ ja, kana }) => {
      if (!KANJI.test(ja)) return kana;
      const { a, b } = await bothReadings(ja);
      if (a && b && hira(a) === hira(b)) return hira(a);
      if ([a, b].some((r) => r && hira(r) === hira(kana))) return kana;
      console.warn(`reading dropped for ${ja}: wrote ${kana}, heard ${a ?? "-"} / ${b ?? "-"}`);
      return "";
    }),
  );
}
