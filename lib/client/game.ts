// Scenario groups (work, life, the learner's own) and how far each scenario has got.
// Pure helpers over Progress; nothing here changes how practice is recorded.

import type { Scenario } from "@/content/scenarios";
import { allScenarios, stepsDone, type Progress } from "./progress";

export type BuildingId = "work" | "life" | "custom";

export const BUILDINGS: Record<BuildingId, { label: string }> = {
  work: { label: "工作" },
  life: { label: "生活" },
  custom: { label: "我的" },
};

export function buildingOf(s: Scenario, p: Progress): BuildingId {
  return p.custom.some((c) => c.id === s.id) ? "custom" : s.category;
}

export function buildingScenarios(p: Progress, b: BuildingId): Scenario[] {
  return allScenarios(p).filter((s) => buildingOf(s, p) === b);
}

// One per step finished: listen, shadow, talk.
export function stars(p: Progress, s: Scenario) {
  return Object.values(stepsDone(p, s)).filter(Boolean).length;
}

// The character the learner talks to in a scenario.
export function npc(s: Scenario) {
  const line = s.lines.find((l) => l.voice === s.talk.aiVoice) ?? s.lines[0];
  return { name: line?.speaker ?? s.title, line: line?.ja ?? s.talk.opening.ja };
}
