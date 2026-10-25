export type Part = { t: string; ok: boolean };

// When the AI's parts don't put the sentence back together: the characters said in order (longest common
// subsequence), in runs. Punctuation goes with the run before it.
const MARK = /[、。，．・「」『』（）！？\s]/;
export function byChars(ja: string, said: string): Part[] {
  const a = [...ja];
  const b = [...said].filter((c) => !MARK.test(c));
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ok: boolean[] = [];
  for (let i = 0, j = 0; i < a.length; ) {
    if (MARK.test(a[i])) ok.push(ok[ok.length - 1] ?? true), i++;
    else if (j < b.length && a[i] === b[j]) ok.push(true), i++, j++;
    else if (j < b.length && L[i][j + 1] >= L[i + 1][j]) j++;
    else ok.push(false), i++;
  }
  const parts: Part[] = [];
  a.forEach((c, i) => (parts.length && parts[parts.length - 1].ok === ok[i] ? (parts[parts.length - 1].t += c) : parts.push({ t: c, ok: ok[i] })));
  return parts;
}
