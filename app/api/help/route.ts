import { NextResponse } from "next/server";
import { recognize, synthesize } from "@/lib/azure";
import { retellHelp } from "@/lib/claude";
import { helpFromAudio, piece, type Help } from "@/lib/gemini-hear";
import { byChars } from "@/lib/say-match";
import { synthesizeVertex, vertexConfigured } from "@/lib/vertex-tts";

export const maxDuration = 30;

// 森先生 stepping in when the learner is stuck mid-telling. The phone sends its last seconds (asked for
// already at the start of a silence, so the answer is ready by the time she should speak) and gets back
// what she says with her voice in the same answer: no second round trip before she can speak.
// Story (三回話す): Gemini listening to the clip races Azure writing it down + Haiku; the first answer wins.
// Sentence (NHK 一文ずつ): the sentence is known, so no AI writes anything: where the learner got to is
// found in it, and she says that clause up to its next break.
type Body = { audio?: string; topic?: string; keys?: string[]; before?: string; sentence?: string };

// Her voice for these lines: Azure's (fast, ~0.5 s) rather than her usual Gemini one (~4 s), else Gemini.
const VOICE = "ja-JP-MayuNeural";
async function voice(text: string): Promise<string> {
  try {
    return Buffer.from(await synthesize(text, VOICE)).toString("base64");
  } catch (e) {
    if (!vertexConfigured()) throw e;
    return Buffer.from(await synthesizeVertex(text, "Gacrux", 8000)).toString("base64");
  }
}

const str = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");
const nonEmpty = (p: Promise<string>) => p.then((t) => t.trim() || Promise.reject(new Error("nothing heard")));

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Body;
  const audio = str(b.audio, 1_200_000);
  const t0 = Date.now();
  const wav = () => {
    const buf = Buffer.from(audio, "base64");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };

  if (b.sentence) {
    const ja = str(b.sentence, 300);
    let said = "";
    if (audio.length > 2000) {
      said = await Promise.any([nonEmpty(piece(audio, "audio/wav").then((r) => r.text)), nonEmpty(recognize(wav()).then((r) => r.text))]).catch(() => "");
    }
    const say = clauseAfter(ja, said);
    const t1 = Date.now();
    try {
      return NextResponse.json({ said, say, audio: await voice(say), ms: [t1 - t0, Date.now() - t1] });
    } catch (e) {
      console.error("help voice:", e);
      return NextResponse.json({ said, say, ms: [t1 - t0, Date.now() - t1] });
    }
  }

  const ctx = { topic: str(b.topic, 300), keys: (Array.isArray(b.keys) ? b.keys : []).map((k) => str(k, 30)).slice(0, 6), before: str(b.before, 400) };
  if (!ctx.topic) return NextResponse.json({ error: "缺少话题" }, { status: 400 });
  let help: Help & { by: string };
  try {
    help =
      audio.length > 2000
        ? await Promise.any([
            helpFromAudio(audio, ctx).then((h) => ({ ...h, by: "gemini" })),
            recognize(wav()).then((r) => retellHelp(r.text, ctx)).then((h) => ({ ...h, by: "azure+haiku" })),
          ])
        : { ...(await retellHelp("", ctx)), by: "haiku" };
  } catch (e) {
    console.error("help:", e instanceof AggregateError ? e.errors.map(String).join(" / ") : e);
    return NextResponse.json({ error: "先生没听清" }, { status: 502 });
  }
  const t1 = Date.now();
  // Both lines voiced at once: the second is needed only if the learner stays stuck, but then at once.
  const [a, n] = await Promise.all([voice(help.say).catch(() => ""), voice(help.next).catch(() => "")]);
  return NextResponse.json({ ...help, audio: { say: a, next: n }, ms: [t1 - t0, Date.now() - t1] });
}

// The clause the learner is in, from its start up to its next break (、 or 。), at least a few characters
// past where they stopped; the whole first clause when nothing was caught.
function clauseAfter(ja: string, said: string): string {
  let upto = 0;
  if (said) {
    let at = 0;
    for (const p of byChars(ja, said)) {
      at += p.t.length;
      if (p.ok) upto = at;
    }
  }
  const start = Math.max(0, ja.lastIndexOf("、", Math.max(0, upto - 1)) + 1, ja.lastIndexOf("。", Math.max(0, upto - 1)) + 1);
  const breakAt = (from: number) => {
    const m = ja.slice(from).search(/[、。]/);
    return m < 0 ? ja.length : from + m + 1;
  };
  let end = breakAt(Math.min(ja.length, upto + 3));
  if (end >= ja.length && upto >= ja.length - 1) end = ja.length;
  const out = ja.slice(start, end).trim();
  return out || ja.slice(0, breakAt(0));
}
