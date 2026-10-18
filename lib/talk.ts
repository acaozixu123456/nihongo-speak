import { getScenario, type Scenario } from "@/content/scenarios";

// Built-in scenarios are looked up by id; AI-written ones live on the phone,
// so the client sends their role-play settings along.
export function resolveTalk(body: { scenarioId: string; talk?: Scenario["talk"] }): Pick<Scenario, "talk"> | null {
  const builtin = getScenario(body.scenarioId);
  if (builtin) return builtin;
  const t = body.talk;
  const ok = t && [t.aiRole, t.userRole, t.setup, t.goalZh, t.aiVoice].every((v) => typeof v === "string" && v.length < 4000);
  return ok ? { talk: t } : null;
}
