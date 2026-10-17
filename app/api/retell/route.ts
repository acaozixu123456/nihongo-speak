import { NextResponse } from "next/server";
import { retellEnd, retellFix } from "@/lib/claude";

export const maxDuration = 30;

type Body =
  | { kind: "fix"; topic: string; said: string; known?: string[] }
  | { kind: "end"; topic: string; first: string; last: string; focus?: string };

const text = (s: unknown, n: number): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= n;

// 三回話す: the one point to fix after the first telling, and the wrap-up after the third.
export async function POST(request: Request) {
  const b = (await request.json()) as Body;
  if (!text(b.topic, 200)) return NextResponse.json({ error: "缺少话题" }, { status: 400 });
  try {
    if (b.kind === "fix") {
      if (!text(b.said, 3000)) return NextResponse.json({ error: "没有听到内容" }, { status: 400 });
      const known = Array.isArray(b.known) ? b.known.filter((t) => typeof t === "string").slice(0, 40) : [];
      return NextResponse.json(await retellFix({ topic: b.topic, said: b.said, known }));
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
