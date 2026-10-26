import { NextResponse } from "next/server";
import { recognize, synthesize } from "@/lib/azure";
import { retellHelp, retellHelpLines } from "@/lib/claude";
import { helpFromAudio, piece, type Help } from "@/lib/gemini-hear";
import { withAdded } from "@/lib/help-prompt";
import { byChars } from "@/lib/say-match";
import { synthesizeVertex, vertexConfigured } from "@/lib/vertex-tts";

export const maxDuration = 30;

// 森先生 stepping in when the learner is stuck mid-telling. The phone sends its last seconds (asked for
// already at the start of a silence, so the answer is ready by the time she should speak) and gets back
// what she says with her voice in the same answer: no second round trip before she can speak.
// Story (三回話す): Gemini listening to the clip races Azure writing it down + Haiku; the first answer wins.
// Sentence (NHK 一文ずつ): the sentence is known, so no AI writes anything: where the learner got to is
// found in it, and she says that clause up to its next break.
// hear: only write down one phrase (sent while the learner is still telling). said: what they said, already
// written down that way, so only her line is left to write.
type Body = { audio?: string; topic?: string; keys?: string[]; before?: string; sentence?: string; hear?: boolean; said?: string };

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

  if (b.hear) {
    if (audio.length < 2000) return NextResponse.json({ text: "" });
    try {
      return NextResponse.json({ text: (await recognize(wav())).text, ms: Date.now() - t0 });
    } catch (e) {
      console.error("help hear:", e);
      return NextResponse.json({ error: "没听清" }, { status: 502 });
    }
  }

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
  // Already written down: her line streamed as NDJSON, the first line (say + its voice) as soon as Haiku
  // has written it, then the whole sentence (next + zh + its voice).
  if (typeof b.said === "string") return streamHelp(str(b.said, 600), ctx, t0);
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
    const why = e instanceof AggregateError ? e.errors.map(String).join(" / ") : String(e);
    console.error("help:", why);
    // why: the first words of each failure, to tell a timeout from a refusal without the logs.
    return NextResponse.json({ error: "先生没听清", why: why.slice(0, 400) }, { status: 502 });
  }
  const t1 = Date.now();
  const [a, rest] = await Promise.all([voice(help.say).catch(() => ""), guesses(help.say, help.sure, help.options, help.said)]);
  return NextResponse.json({ said: help.said, say: help.say, by: help.by, audio: a, ...rest, ms: [t1 - t0, Date.now() - t1] });
}

// Her guesses at what the learner meant, each voiced (Azure, all at once: whichever they pick plays at
// once). The first is also next/zh/added for what reads only those.
async function guesses(say: string, sure: boolean, raw: { ja: string; zh: string }[], said = "") {
  const opts = withAdded(say, raw, said);
  const voiced = await Promise.all(opts.map(async (o) => ({ ...o, audio: await voice(o.ja).catch(() => "") })));
  const first = voiced[0];
  return { sure: sure || voiced.length < 2, opts: voiced, next: first?.ja ?? "", zh: first?.zh ?? "", added: first?.added ?? "" };
}

function streamHelp(said: string, ctx: { topic: string; keys: string[]; before: string }, t0: number) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(out) {
      const send = (o: object) => out.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      let say = "";
      let sure = true;
      const raw: { ja: string; zh: string }[] = [];
      let first: Promise<void> | null = null;
      try {
        for await (const { key, value } of retellHelpLines(said, ctx)) {
          if (key === "say" && value && !say) {
            say = value;
            first = voice(value)
              .catch(() => "")
              .then((audio) => send({ said, say: value, audio, ms: Date.now() - t0 }));
          } else if (key === "sure") sure = !/^no/i.test(value);
          else if (key === "opt") {
            const [ja, zh = ""] = value.split(/\s*[|｜]\s*/);
            if (ja) raw.push({ ja, zh });
          }
        }
        if (!say) throw new Error("no SAY line");
        const rest = await guesses(say, sure, raw, said);
        await first;
        send({ ...rest, ms: Date.now() - t0 });
      } catch (e) {
        console.error("help stream:", e);
        send({ error: "先生没听清" });
      }
      out.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
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
