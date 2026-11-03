import "server-only";
import { drillLadder } from "@/lib/claude";
import { aboutNow } from "@/lib/kokoro";
import { getJson, setJson } from "@/lib/kv";
import { jstDay } from "@/lib/push";
import { LEVELS, seedKey, type DrillStep, type Ladder } from "@/lib/drill-model";

// A ladder for a word or grammar point, kept a month so もう一度 gets the same one; 新しい文 makes another.
const path = (seed: string) => `drill/ladder/${seedKey(seed)}`;

export const readLadder = (seed: string) => getJson<Ladder>(path(seed));

export async function makeLadder(seed: string): Promise<Ladder> {
  const draft = await drillLadder(seed, await aboutNow(jstDay()).catch(() => "（メモなし）"));
  const steps: DrillStep[] = draft.steps
    .map((s) => ({ ...s, lv: Math.min(LEVELS, Math.max(1, Math.round(s.lv))), cue: s.cue.trim(), cue_zh: s.cue_zh.trim(), ja: s.ja.trim(), kana: s.kana.trim(), zh: s.zh.trim() }))
    .filter((s) => s.ja && s.cue);
  if (steps.length < 8) throw new Error("出题失败，再试一次");
  // Levels in order, whatever order they came in.
  steps.sort((a, b) => a.lv - b.lv);
  steps[0] = { ...steps[0], op: "base" };
  const ladder: Ladder = { seed: draft.seed.trim() || seed, meaning_zh: draft.meaning_zh.trim(), made: Date.now(), steps };
  await setJson(path(seed), ladder, 30);
  return ladder;
}
