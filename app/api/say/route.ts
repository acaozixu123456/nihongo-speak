import { NextResponse } from "next/server";
import { recognize } from "@/lib/azure";
import { sayCheck, type SayCheck } from "@/lib/claude";
import { piece } from "@/lib/gemini-hear";

export const maxDuration = 60;

// 一句一句讲三遍: one news (or radio) sentence said back. Gemini writes down what was said (alone, without the sentence,
// so it doesn't "hear" what should have been said; Azure when it is slow or fails), then Opus marks which parts of the
// sentence were said.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { audio?: unknown; ja?: unknown };
  const audio = typeof b.audio === "string" ? b.audio : "";
  const ja = typeof b.ja === "string" ? b.ja.trim() : "";
  if (!ja || ja.length > 300 || audio.length < 2000 || audio.length > 3_000_000) return NextResponse.json({ error: "录音不对" }, { status: 400 });
  let said = "";
  const t0 = Date.now();
  // Now and then Gemini takes over half a minute on a clip (seen live: the same recording every time). If it
  // hasn't answered in 6 s, Azure writes it down too and the first non-empty answer is used.
  const buf = Buffer.from(audio, "base64");
  const wav = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const nonEmpty = (p: Promise<string>) => p.then((t) => t.trim() || Promise.reject(new Error("nothing heard")));
  try {
    said = await Promise.any([
      nonEmpty(piece(audio, "audio/wav").then((r) => r.text)),
      nonEmpty(new Promise((ok) => setTimeout(ok, 6000)).then(() => recognize(wav)).then((r) => r.text)),
    ]);
  } catch (e) {
    // Neither wrote anything down: silence when at least one heard nothing, else a failure.
    const errs: unknown[] = e instanceof AggregateError ? e.errors : [e];
    const silent = errs.some((x) => x instanceof Error && x.message === "nothing heard");
    if (!silent) {
      console.error("say:", errs.map(String).join(" / "));
      return NextResponse.json({ error: "没听清，再说一次" }, { status: 502 });
    }
  }
  const t1 = Date.now();
  if (!said) return NextResponse.json({ said, ...plainCheck(ja, said) });
  // Said exactly (punctuation aside): nothing to ask.
  const plain = plainCheck(ja, said);
  if (plain.verdict === "good") return NextResponse.json({ said, ...plain, ms: [t1 - t0, 0] });
  let check: SayCheck;
  try {
    check = await sayCheck({ ja, said });
    if (squash(check.parts.map((p) => p.t).join(" ")) !== squash(ja)) check.parts = plain.parts;
    if (squash(check.mine.map((p) => p.t).join(" ")) !== squash(said)) check.mine = [{ t: said, ok: true }];
  } catch (e) {
    console.error(e);
    check = plain;
  }
  // ms: how long writing down and checking took, to watch the wait.
  return NextResponse.json({ said, ...check, ms: [t1 - t0, Date.now() - t1] });
}

const squash = (t: string) => t.replace(/\s+/g, " ").trim();
// A word as compared: lower case, letters and digits only ("Don't," and "dont" are the same word).
const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

// Without the AI: how much of the sentence was said word for word.
function plainCheck(ja: string, said: string): SayCheck {
  const parts = byWords(ja, said);
  const words = parts.flatMap((p) => p.t.split(" ").filter((w) => bare(w)).map(() => p.ok));
  const got = words.filter(Boolean).length / Math.max(1, words.length);
  return {
    verdict: !said ? "off" : got === 1 ? "good" : got >= 0.7 ? "close" : "off",
    mine: said ? [{ t: said, ok: true }] : [],
    stuck_zh: "",
    better: said,
    better_zh: "",
    parts,
  };
}

// When the AI's parts don't put the sentence back together: the words said in order (longest common
// subsequence), in runs. A word with no letters or digits goes with the run before it.
function byWords(ja: string, said: string): SayCheck["parts"] {
  const a = squash(ja).split(" ");
  const b = said.split(/\s+/).map(bare).filter(Boolean);
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) L[i][j] = bare(a[i]) === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ok: boolean[] = [];
  for (let i = 0, j = 0; i < a.length; ) {
    if (!bare(a[i])) ok.push(ok[ok.length - 1] ?? true), i++;
    else if (j < b.length && bare(a[i]) === b[j]) ok.push(true), i++, j++;
    else if (j < b.length && L[i][j + 1] >= L[i + 1][j]) j++;
    else ok.push(false), i++;
  }
  const parts: SayCheck["parts"] = [];
  a.forEach((w, i) => (parts.length && parts[parts.length - 1].ok === ok[i] ? (parts[parts.length - 1].t += " " + w) : parts.push({ t: w, ok: ok[i] })));
  return parts;
}
