import { NextResponse } from "next/server";
import { recognize } from "@/lib/azure";
import { sayCheck, type SayCheck } from "@/lib/claude";
import { piece } from "@/lib/gemini-hear";

export const maxDuration = 60;

// 一文ずつ三回話す: one NHK sentence said back. Gemini writes down what was said (alone, without the sentence,
// so it doesn't "hear" what should have been said; Azure when it fails), then Opus marks which parts of the
// sentence were said.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { audio?: unknown; ja?: unknown };
  const audio = typeof b.audio === "string" ? b.audio : "";
  const ja = typeof b.ja === "string" ? b.ja.trim() : "";
  if (!ja || ja.length > 300 || audio.length < 2000 || audio.length > 3_000_000) return NextResponse.json({ error: "录音不对" }, { status: 400 });
  let said = "";
  const t0 = Date.now();
  try {
    said = (await piece(audio, "audio/wav")).text.trim();
  } catch (e) {
    console.warn("say: Gemini failed, Azure instead", e);
    try {
      const buf = Buffer.from(audio, "base64");
      said = (await recognize(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)).text.trim();
    } catch (e2) {
      console.error(e2);
      return NextResponse.json({ error: "没听清，再说一次" }, { status: 502 });
    }
  }
  const t1 = Date.now();
  if (!said) return NextResponse.json({ said, parts: [{ t: ja, ok: false }], miss_zh: "" } satisfies SayCheck & { said: string });
  // Said exactly (punctuation aside): nothing to ask.
  const plain = byChars(ja, said);
  if (plain.every((p) => p.ok)) return NextResponse.json({ said, parts: plain, miss_zh: "", ms: [t1 - t0, 0] });
  let check: SayCheck;
  try {
    check = await sayCheck({ ja, said });
    if (check.parts.map((p) => p.t).join("") !== ja) check = { parts: byChars(ja, said), miss_zh: check.miss_zh };
  } catch (e) {
    console.error(e);
    check = { parts: byChars(ja, said), miss_zh: "" };
  }
  // ms: how long writing down and checking took, to watch the wait.
  return NextResponse.json({ said, ...check, ms: [t1 - t0, Date.now() - t1] });
}

// When the AI's parts don't put the sentence back together: the characters said in order (longest common
// subsequence), in runs. Punctuation goes with the run before it.
const MARK = /[、。，．・「」『』（）！？\s]/;
function byChars(ja: string, said: string): SayCheck["parts"] {
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
  const parts: SayCheck["parts"] = [];
  a.forEach((c, i) => (parts.length && parts[parts.length - 1].ok === ok[i] ? (parts[parts.length - 1].t += c) : parts.push({ t: c, ok: ok[i] })));
  return parts;
}
