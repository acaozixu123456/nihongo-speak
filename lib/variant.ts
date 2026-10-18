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
