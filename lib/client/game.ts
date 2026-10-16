// The RPG-town layer: job titles for levels, buildings, stars and rhythm grades.
// Pure helpers over Progress; nothing here changes how practice is recorded.

import type { Scenario } from "@/content/scenarios";
import { allScenarios, stepsDone, type Progress } from "./progress";

// A promotion every level, like climbing a Japanese company ladder.
const TITLES = ["新人社員", "一般社員", "主任", "係長", "課長代理", "課長", "次長", "部長", "本部長", "役員", "社長"];
export const jobTitle = (lv: number) => TITLES[Math.min(lv - 1, TITLES.length - 1)];

// The station opens once the learner is past the first two levels.
export const STATION_LEVEL = 3;

export type BuildingId = "work" | "life" | "custom";

export const BUILDINGS: Record<BuildingId, { name: string; ja: string; icon: string; sub: string }> = {
  work: { name: "会社", ja: "株式会社ニホン", icon: "🏢", sub: "职场 · 每层是一个场景" },
  life: { name: "まち", ja: "ひまわり町", icon: "🏘️", sub: "生活 · 每家店是一个场景" },
  custom: { name: "我的", ja: "私の場面", icon: "📸", sub: "从你自己的经历生成的场景" },
};

export function buildingOf(s: Scenario, p: Progress): BuildingId {
  return p.custom.some((c) => c.id === s.id) ? "custom" : s.category;
}

export function buildingScenarios(p: Progress, b: BuildingId): Scenario[] {
  return allScenarios(p).filter((s) => buildingOf(s, p) === b);
}

// One star per step finished: listen, shadow, talk.
export function stars(p: Progress, s: Scenario) {
  return Object.values(stepsDone(p, s)).filter(Boolean).length;
}

export const starText = (n: number, of = 3) => "★".repeat(n) + "☆".repeat(of - n);

export function buildingStars(p: Progress, b: BuildingId) {
  const list = buildingScenarios(p, b);
  return { got: list.reduce((a, s) => a + stars(p, s), 0), of: list.length * 3 };
}

// Shadowing scored like a rhythm game.
export type Grade = "PERFECT" | "GREAT" | "GOOD" | "MISS";
export const GRADES: Grade[] = ["PERFECT", "GREAT", "GOOD", "MISS"];
export function grade(score: number): Grade {
  return score >= 90 ? "PERFECT" : score >= 80 ? "GREAT" : score >= 60 ? "GOOD" : "MISS";
}

// The sky follows the clock: morning, day, evening, night.
export function timeOfDay(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 10) return { key: "morning", label: "朝" };
  if (h >= 10 && h < 16) return { key: "day", label: "昼" };
  if (h >= 16 && h < 19) return { key: "evening", label: "夕方" };
  return { key: "night", label: "夜" };
}

// The character the learner talks to in a scenario, and a sprite for them.
export function npc(s: Scenario) {
  const line = s.lines.find((l) => l.voice === s.talk.aiVoice) ?? s.lines[0];
  const female = /Nanami|Mayu|Aoi|Shiori/.test(s.talk.aiVoice.split("|")[0]);
  return { name: line?.speaker ?? s.title, sprite: female ? "👩‍💼" : "👨‍💼", line: line?.ja ?? s.talk.opening.ja };
}
