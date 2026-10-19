import { NextResponse } from "next/server";
import { radioEasy, radioEasyOne } from "@/lib/claude";

export const maxDuration = 60;

// Easy versions of the hard lines of an episode saved before scripts came with them.
export async function POST(request: Request) {
  const b = (await request.json()) as { lines?: unknown; one?: unknown; before?: unknown };
  // One line, long-pressed: always said again.
  if (typeof b.one === "string") {
    if (!b.one.trim() || b.one.length > 200) return NextResponse.json({ error: "bad request" }, { status: 400 });
    try {
      return NextResponse.json({ easy: await radioEasyOne(b.one, typeof b.before === "string" ? b.before.slice(0, 200) : "") });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
    }
  }
  const lines = b.lines;
  if (!Array.isArray(lines) || !lines.length || lines.length > 60 || !lines.every((l) => typeof l === "string" && l.length <= 200))
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    return NextResponse.json({ easy: await radioEasy(lines as string[]) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
