// Haiku sometimes puts the exercise instructions ("复习题：用…表达…请翻译成日语") in zh instead of a sentence.
const KANA = /[\u3040-\u30ff]/;
export function variantOk(v: { zh: string; ja: string }) {
  const zh = v.zh.trim();
  return (
    zh.length > 0 &&
    zh.length <= 60 &&
    !KANA.test(zh) &&
    !/复习题|翻译成|翻成日|句型|这句话|日语说|用「|用“|用"/.test(zh) &&
    KANA.test(v.ja) &&
    v.ja.length <= 70
  );
}

// Chinese with the Japanese it quotes taken out: a line still holding kana was (partly) written
// in Japanese. `min` kana are tolerated, for a stray particle in an explanation.
// Grammar named with a 〜 (〜てしまう) counts as quoted too.
export const inJapanese = (s: string, min = 5) =>
  (s.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"|〜[ぁ-んァ-ヶー]*/g, "").match(/[ぁ-んァ-ヶ]/g)?.length ?? 0) >= min;

// The Chinese fields of an AI answer (named zh, *_zh or *Zh) that came back in Japanese, by path.
export function japaneseZh(v: unknown, path = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => japaneseZh(x, `${path}[${i}]`));
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) =>
    typeof x === "string" ? ((k === "zh" || k.endsWith("_zh") || k.endsWith("Zh")) && inJapanese(x) ? [`${path}.${k}`] : []) : japaneseZh(x, `${path}.${k}`),
  );
}
