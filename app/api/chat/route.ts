import { NextResponse } from "next/server";
import { getScenario } from "@/content/scenarios";
import { hint, roleplayReply, type Turn } from "@/lib/claude";

type Body = { scenarioId: string; history: Turn[]; mode?: "reply" | "hint"; wantZh?: string };

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const scenario = getScenario(body.scenarioId);
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
