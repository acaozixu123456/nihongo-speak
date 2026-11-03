import "server-only";
import { drillLadder } from "@/lib/claude";
import { aboutNow } from "@/lib/kokoro";
import { getJson, setJson } from "@/lib/kv";
import { jstDay } from "@/lib/push";
import { LEVELS, TIERS, seedKey, type DrillStep, type Ladder } from "@/lib/drill-model";

// A ladder for a word or grammar point, kept a month so もう一度 gets the same one; 新しい文 makes another.
const path = (seed: string, tier = 1) => `drill/ladder/${seedKey(seed)}${tier > 1 ? `@${tier}` : ""}`;

export const readLadder = (seed: string, tier = 1) => getJson<Ladder>(path(seed, tier));

// avoid: the sentences of the ladder it replaces (新しい文), not to be used again.
export async function makeLadder(seed: string, avoid: string[] = [], tier = 1): Promise<Ladder> {
  tier = Math.min(TIERS, Math.max(1, Math.round(tier)));
  const memo = await aboutNow(jstDay()).catch(() => "（メモなし）");
  const context = avoid.length ? `${memo}\n\n前回のはしごの文（同じ文・同じ入れ替え語は使わない）：\n${avoid.map((a) => `- ${a}`).join("\n")}` : memo;
  // A ladder cut off by its length is asked for once more.
  const draft = await drillLadder(seed, context, tier).catch((e: unknown) => {
    if (e instanceof Error && e.message.includes("max_tokens")) return drillLadder(seed, context, tier);
    throw e;
  });
  const steps: DrillStep[] = draft.steps
    .map((s) => ({ ...s, lv: Math.min(LEVELS, Math.max(1, Math.round(s.lv))), cue: s.cue.trim(), cue_zh: s.cue_zh.trim(), ja: s.ja.trim(), kana: s.kana.trim(), zh: s.zh.trim() }))
    .filter((s) => s.ja && s.cue);
  if (steps.length < 8) throw new Error("出题失败，再试一次");
  // Levels in order, whatever order they came in.
  steps.sort((a, b) => a.lv - b.lv);
  steps[0] = { ...steps[0], op: "base" };
  const ladder: Ladder = { seed: draft.seed.trim() || seed, meaning_zh: draft.meaning_zh.trim(), made: Date.now(), tier, steps };
  await setJson(path(seed, tier), ladder, 30);
  // Opened again from its chip by the tidied name: the same ladder.
  if (seedKey(ladder.seed) !== seedKey(seed)) await setJson(path(ladder.seed, tier), ladder, 30);
  return ladder;
}
