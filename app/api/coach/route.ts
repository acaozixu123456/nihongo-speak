import { NextResponse } from "next/server";
import type { Scenario } from "@/content/scenarios";
import { resolveTalk } from "@/lib/talk";
import { checkTurn, coachShadow, makeVariant, type Turn } from "@/lib/claude";

export const maxDuration = 30;

type Body =
  | { kind: "shadow"; ja: string; kana?: string; said: string; scores?: Parameters<typeof coachShadow>[0]["scores"] }
  | { kind: "turn"; scenarioId: string; talk?: Scenario["talk"]; history: Turn[]; known?: string[] }
  | { kind: "variant"; ja: string; zh: string };

const short = (s: unknown, n = 500): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= n;

// Quick Haiku feedback for 模仿说话, each line of a conversation, and review variants.
export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  try {
    if (body.kind === "shadow") {
      if (!short(body.ja) || !short(body.said)) return NextResponse.json({ error: "没有听到内容" }, { status: 400 });
      return NextResponse.json(await coachShadow(body));
    }
    if (body.kind === "turn") {
      const scenario = resolveTalk(body);
      if (!scenario || !Array.isArray(body.history) || !body.history.length) {
        return NextResponse.json({ error: "unknown scenario" }, { status: 400 });
      }
      const known = Array.isArray(body.known) ? body.known.filter((t) => typeof t === "string").slice(0, 40) : [];
      return NextResponse.json(await checkTurn(scenario, body.history.slice(-12), known));
    }
    if (body.kind === "variant") {
      if (!short(body.ja) || !short(body.zh)) return NextResponse.json({ error: "缺少句子" }, { status: 400 });
      return NextResponse.json(await makeVariant(body));
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
