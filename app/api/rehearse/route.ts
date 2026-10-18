import { NextResponse } from "next/server";
import { rehearseDebrief, rehearsePlan } from "@/lib/claude";

export const maxDuration = 30;

type Body = { kind: "plan"; ask: string } | { kind: "debrief"; ask: string; report: string };

const text = (s: unknown, n: number): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= n;

// 予行演習: the role-play for a conversation the learner is about to have, and what to take from how it really went.
export async function POST(request: Request) {
  const b = (await request.json()) as Body;
  if (!text(b.ask, 300)) return NextResponse.json({ error: "先写一下要说什么" }, { status: 400 });
  try {
    if (b.kind === "plan") return NextResponse.json(await rehearsePlan(b.ask.trim()));
    if (b.kind === "debrief") {
      if (!text(b.report, 1000)) return NextResponse.json({ error: "先写一下实际怎么样" }, { status: 400 });
      return NextResponse.json(await rehearseDebrief({ askZh: b.ask.trim(), report: b.report.trim() }));
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
