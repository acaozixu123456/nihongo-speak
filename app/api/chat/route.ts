import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Scenario } from "@/content/scenarios";
import { resolveTalk } from "@/lib/talk";
import { hint, roleplayReply, scenePlan, type Turn } from "@/lib/claude";
import { getJson, kvReady, setJson } from "@/lib/kv";

type Body = {
  scenarioId: string;
  talk?: Scenario["talk"];
  history: Turn[];
  mode?: "reply" | "hint" | "plan";
  wantZh?: string;
  // Which telling of the scene this is: from the second on, its twist comes in.
  round?: number;
  // The task still open that a hint should help with (its number, from 0).
  todo?: number;
  // The tasks already ticked on the phone (from 0).
  done?: number[];
};

type Plan = Awaited<ReturnType<typeof scenePlan>>;

// A scene from before scenes had tasks gets them once; every later talk reads the kept copy.
async function plan(s: Pick<Scenario, "talk">): Promise<Plan> {
  const { tasks, twist } = s.talk;
  if (tasks?.length && twist) return { tasks, twist };
  const key = `scene/plan/${createHash("sha256").update(JSON.stringify([s.talk.setup, s.talk.aiRole, s.talk.userRole, s.talk.goalZh])).digest("hex").slice(0, 24)}`;
  const kept = kvReady() ? await getJson<Plan>(key).catch(() => null) : null;
  if (kept) return kept;
  const made = await scenePlan(s);
  if (kvReady()) await setJson(key, made).catch((e) => console.warn("scene plan not kept:", e));
  return made;
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  if (!Array.isArray(body.history)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  // A practice talk is a few dozen turns; anything longer is someone filling Haiku's context.
  body.history = body.history.slice(-40).map((t) => ({ role: t.role === "user" ? "user" : "assistant", text: String(t.text ?? "").slice(0, 1000) }));
  const scenario = resolveTalk(body);
  if (!scenario) return NextResponse.json({ error: "unknown scenario" }, { status: 404 });
  const round = body.round === 2 || body.round === 3 ? body.round : body.round && body.round > 3 ? 3 : 1;
  try {
    if (body.mode === "plan") return NextResponse.json(await plan(scenario));
    if (body.mode === "hint") {
      const todo = typeof body.todo === "number" ? scenario.talk.tasks?.[body.todo] : undefined;
      const wantZh = typeof body.wantZh === "string" ? body.wantZh.slice(0, 200) : undefined;
      return NextResponse.json(await hint(scenario, body.history, { wantZh, todo, round }));
    }
    const ticked = Array.isArray(body.done) ? body.done.filter((i) => typeof i === "number").slice(0, 8) : [];
    return NextResponse.json(await roleplayReply(scenario, body.history, round, ticked));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
