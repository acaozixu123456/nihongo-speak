import { NextResponse } from "next/server";
import { retellEnd, retellFix, retellKana } from "@/lib/claude";

export const maxDuration = 30;

type Body =
  | { kind: "fix"; topic: string; said: string; known?: string[]; carry?: { focus_zh: string; better: string } }
  | { kind: "end"; topic: string; first: string; last: string; focus?: string }
  | { kind: "kana"; texts: string[] };

const text = (s: unknown, n: number): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= n;

// 三回話す: the one point to fix after the first telling, the wrap-up after the third, and the
// readings that speed is counted from.
export async function POST(request: Request) {
  const b = (await request.json()) as Body;
  if (b.kind === "kana") {
    const texts = Array.isArray(b.texts) ? b.texts.filter((t) => text(t, 3000)).slice(0, 4) : [];
    if (!texts.length) return NextResponse.json({ error: "没有内容" }, { status: 400 });
    try {
      return NextResponse.json({ kana: await retellKana(texts) });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
    }
  }
  // An episode topic is its title plus the start of its main corner (up to ~620 characters, see Retell.tsx epTopic).
  if (!text(b.topic, 1000)) return NextResponse.json({ error: "缺少话题" }, { status: 400 });
  try {
    if (b.kind === "fix") {
      if (!text(b.said, 3000)) return NextResponse.json({ error: "没有听到内容" }, { status: 400 });
      const known = Array.isArray(b.known) ? b.known.filter((t) => typeof t === "string").slice(0, 40) : [];
      const carry = b.carry && text(b.carry.focus_zh, 300) && typeof b.carry.better === "string" ? { focus_zh: b.carry.focus_zh, better: b.carry.better.slice(0, 300) } : undefined;
      return NextResponse.json(await retellFix({ topic: b.topic, said: b.said, known, carry }));
    }
    if (b.kind === "end") {
      if (!text(b.first, 3000) || !text(b.last, 3000)) return NextResponse.json({ error: "没有听到内容" }, { status: 400 });
      return NextResponse.json(await retellEnd({ topic: b.topic, first: b.first, last: b.last, focus: typeof b.focus === "string" ? b.focus.slice(0, 300) : "" }));
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
