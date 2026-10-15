import type { Line, Scenario } from "@/content/scenarios";
import type { Generated } from "@/lib/claude";

// Voices for AI-written scenarios: the role-play partner gets the most natural (HD) voice.
const POOLS = {
  male: ["ja-JP-Masaru:DragonHDLatestNeural|ja-JP-KeitaNeural", "ja-JP-DaichiNeural", "ja-JP-NaokiNeural"],
  female: ["ja-JP-Nanami:DragonHDLatestNeural|ja-JP-MayuNeural", "ja-JP-AoiNeural", "ja-JP-ShioriNeural"],
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
  const lines: Line[] = g.lines.map((l) => ({ ...l, voice: voices.get(l.speaker) ?? fallback }));
  return {
    id,
    title: g.title,
    titleZh: g.titleZh,
    category,
    icon: g.icon,
    level: "N3",
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
