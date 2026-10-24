// Chinese with the English it quotes taken out: a line still holding `min` English words or more was
// (partly) written in English. A stray brand name or grammar term is tolerated below that.
const QUOTED = /「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"|‘[^’]*’|'[^']*'/g;
export const inEnglish = (s: string, min = 5) => (s.replace(QUOTED, "").match(/[A-Za-z]{2,}/g)?.length ?? 0) >= min;

const CJK = /[一-鿿]/;

// Haiku sometimes puts the exercise instructions ("复习题：用…表达…请翻译成英语") in zh instead of a sentence.
export function variantOk(v: { zh: string; ja: string }) {
  const zh = v.zh.trim();
  return (
    zh.length > 0 &&
    zh.length <= 60 &&
    !inEnglish(zh, 3) &&
    !/复习题|翻译成|翻成英|句型|这句话|英语说|用「|用“|用"/.test(zh) &&
    /[A-Za-z]/.test(v.ja) &&
    !CJK.test(v.ja) &&
    v.ja.length <= 160
  );
}

// A saved card's Chinese is what 复习 shows to recall the English from, so it must be a plain
// translation: not a note about the learner's mistake ("换个更自然的说法：…", "想说的是…，不是…").
export function zhIsTranslation(zh: string | undefined) {
  const t = (zh ?? "").trim();
  return t.length > 0 && t.length <= 80 && CJK.test(t) && !inEnglish(t, 3) && !/换个|说法|想说的|应该说|下一遍|意思是|说成|这样说/.test(t);
}

// The Chinese fields of an AI answer (named zh, *_zh or *Zh) that came back in English, by path.
export function englishZh(v: unknown, path = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => englishZh(x, `${path}[${i}]`));
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) =>
    typeof x === "string"
      ? (k === "zh" || k.endsWith("_zh") || k.endsWith("Zh")) && x.trim() && (inEnglish(x) || !CJK.test(x))
        ? [`${path}.${k}`]
        : []
      : englishZh(x, `${path}.${k}`),
  );
}

// Words in a line of English, for lengths and speaking speed.
export const wordCount = (s: string) => s.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
