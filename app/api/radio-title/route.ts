import { NextResponse } from "next/server";
import { radioTitleJa } from "@/lib/claude";

const str = (s: unknown, n: number): s is string => typeof s === "string" && s.length <= n;

// A Japanese title for an episode that was saved with only a Chinese one.
export async function POST(request: Request) {
  const b = (await request.json()) as { zh?: unknown; opening?: unknown };
  if (!str(b.zh, 60) || !b.zh.trim() || !str(b.opening, 400)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    return NextResponse.json({ ja: await radioTitleJa(b.zh.trim(), b.opening) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
