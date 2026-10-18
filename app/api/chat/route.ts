import { NextResponse } from "next/server";
import type { Scenario } from "@/content/scenarios";
import { resolveTalk } from "@/lib/talk";
import { hint, roleplayReply, type Turn } from "@/lib/claude";

type Body = { scenarioId: string; talk?: Scenario["talk"]; history: Turn[]; mode?: "reply" | "hint"; wantZh?: string };

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  if (!Array.isArray(body.history)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  // A practice talk is a few dozen turns; anything longer is someone filling Haiku's context.
  body.history = body.history.slice(-40).map((t) => ({ role: t.role, text: String(t.text ?? "").slice(0, 1000) }));
  const scenario = resolveTalk(body);
  if (!scenario) return NextResponse.json({ error: "unknown scenario" }, { status: 404 });
  try {
    const result =
      body.mode === "hint"
        ? await hint(scenario, body.history, body.wantZh)
        : await roleplayReply(scenario, body.history);
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
