import { NextResponse } from "next/server";
import { fullCheck } from "@/lib/claude";
import { hearClips } from "@/lib/gemini-hear";

export const maxDuration = 60;

// 全文モード: the whole article said from its Chinese. The client cuts the recording at its silences (MP3 pieces,
// as in 三回話す); Gemini writes each piece down on its own, then Opus scores the telling by meaning. Gemini on
// Vertex is sometimes slow for half a minute and more (seen 2026-10-24), so the client also sends Azure's
// transcript, used when Gemini hasn't finished in 8 s.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { title?: unknown; sentences?: unknown; clips?: unknown; azure?: unknown };
  const clips = Array.isArray(b.clips) ? b.clips.filter((c): c is string => typeof c === "string") : [];
  const sentences = Array.isArray(b.sentences)
    ? b.sentences.filter((s): s is { ja: string; zh: string } => !!s && typeof s.ja === "string" && typeof s.zh === "string").slice(0, 30)
    : [];
  const title = typeof b.title === "string" ? b.title.slice(0, 200) : "";
  if (!sentences.length || !clips.length || clips.length > 60 || clips.reduce((n, c) => n + c.length, 0) > 3_500_000) {
    return NextResponse.json({ error: "录音不对" }, { status: 400 });
  }
  const t0 = Date.now();
  const azure = typeof b.azure === "string" ? b.azure.trim().slice(0, 4000) : "";
  const gemini = hearClips(clips).then((t) => t.filter(Boolean).join("、"));
  let said: string | null = await Promise.race([gemini.catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), 8000))]);
  if (said === null) said = azure || (await gemini.catch((e) => (console.error(e), null)));
  if (said === null) return NextResponse.json({ error: "没听清，再说一次" }, { status: 502 });
  if (!said) return NextResponse.json({ error: "没听到声音，再说一次" }, { status: 422 });
  const t1 = Date.now();
  try {
    const check = await fullCheck({ title, sentences: sentences.map((s) => ({ ja: s.ja.slice(0, 300), zh: s.zh.slice(0, 300) })), said });
    const score = Math.max(0, Math.min(100, Math.round(check.score)));
    // ms: how long writing down and scoring took, to watch the wait.
    return NextResponse.json({ said, ...check, score, ms: [t1 - t0, Date.now() - t1] });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "AI 出错了，再试一次" }, { status: 502 });
  }
}
