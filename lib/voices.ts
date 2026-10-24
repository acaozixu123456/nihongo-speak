import type { Line, Scenario } from "@/content/scenarios";
import type { Generated } from "@/lib/claude";
import { HD_MAN, HD_WOMAN, MAN_2, MAN_3, WOMAN_2, WOMAN_3 } from "@/content/voices";

// Voices for AI-written scenarios: the role-play partner gets the most natural (HD) voice.
const POOLS = {
  male: [HD_MAN, MAN_2, MAN_3],
  female: [HD_WOMAN, WOMAN_2, WOMAN_3],
};

export function buildScenario(g: Generated, category: "work" | "life", id: string): Scenario {
  const used = { male: 0, female: 0 };
  const voices = new Map<string, string>();
  const order = [...g.characters].sort((a) => (a.name === g.talk.aiCharacter ? -1 : 0));
  for (const c of order) {
    const pool = POOLS[c.gender];
    voices.set(c.name, pool[used[c.gender]++ % pool.length]);
  }
  const fallback = POOLS.female[1];
  const lines: Line[] = g.lines.map((l) => ({ ...l, kana: "", voice: voices.get(l.speaker) ?? fallback }));
  return {
    id,
    title: g.title,
    titleZh: g.titleZh,
    category,
    icon: g.icon,
    level: "A2-B1",
    summaryZh: g.summaryZh,
    lines,
    talk: {
      aiRole: g.talk.aiRole,
      aiVoice: voices.get(g.talk.aiCharacter) ?? POOLS.female[0],
      userRole: g.talk.userRole,
      goalZh: g.talk.goalZh,
      setup: g.talk.setup,
      opening: g.talk.opening,
    },
  };
}
