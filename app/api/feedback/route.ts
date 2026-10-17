import { NextResponse } from "next/server";
import type { Scenario } from "@/content/scenarios";
import { resolveTalk } from "@/lib/talk";
import { feedback, type Turn } from "@/lib/claude";

export async function POST(request: Request) {
  const body = (await request.json()) as { scenarioId: string; talk?: Scenario["talk"]; history: Turn[]; known?: string[] };
  const scenario = resolveTalk(body);
  if (!scenario) return NextResponse.json({ error: "unknown scenario" }, { status: 404 });
  if (!body.history.some((t) => t.role === "user")) {
    return NextResponse.json({ error: "还没说话呢" }, { status: 400 });
  }
  try {
    const known = Array.isArray(body.known) ? body.known.filter((t) => typeof t === "string").slice(0, 40) : [];
    return NextResponse.json(await feedback(scenario, body.history.slice(-40), known));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
