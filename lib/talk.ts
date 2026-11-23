import { getScenario, type Scenario } from "@/content/scenarios";

const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

// Built-in scenarios are looked up by id; AI-written ones live on the phone,
// so the client sends their role-play settings along.
export function resolveTalk(body: { scenarioId: string; talk?: Scenario["talk"] }): Pick<Scenario, "talk"> | null {
  const builtin = getScenario(body.scenarioId);
  if (builtin) return builtin;
  const t = body.talk;
  const ok = t && [t.aiRole, t.userRole, t.setup, t.goalZh, t.aiVoice].every((v) => typeof v === "string" && v.length < 4000);
  if (!ok) return null;
  // Tasks and the second round's turn go into the partner's instructions: only short plain text is let in.
  const tasks = Array.isArray(t.tasks) && t.tasks.length <= 4 && t.tasks.every((x) => text(x, 60)) ? t.tasks : undefined;
  const twist = t.twist && text(t.twist.zh, 60) && text(t.twist.ja, 400) ? { zh: t.twist.zh, ja: t.twist.ja } : undefined;
  return { talk: { ...t, tasks, twist } };
}
