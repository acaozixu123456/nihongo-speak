import { NextResponse } from "next/server";
import { explainSelection } from "@/lib/claude";

const str = (s: unknown, n: number): s is string => typeof s === "string" && s.length <= n;

// 问 AI, on any page: whatever the learner selected, explained in its line's context.
export async function POST(request: Request) {
  const b = (await request.json()) as { pick?: unknown; line?: unknown; before?: unknown; topic?: unknown };
  if (!str(b.pick, 300) || !b.pick.trim() || !str(b.line, 400) || !str(b.topic, 80)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await explainSelection({ pick: b.pick.trim(), line: b.line, before: str(b.before, 400) ? b.before : undefined, topic: b.topic }),
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
