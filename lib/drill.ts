import "server-only";
import { drillLadder, drillReplies, type ReplyDraft } from "@/lib/claude";
import { aboutNow } from "@/lib/kokoro";
import { getJson, setJson } from "@/lib/kv";
import { jstDay } from "@/lib/push";
import { CHAINED, LEVELS, REPLY_GIVEN, REPLY_OWN, TIERS, seedKey, type DrillReply, type DrillStep, type Ladder } from "@/lib/drill-model";
import { kindOf } from "@/content/drill-path";

// A ladder for a word or grammar point, kept a month so もう一度 gets the same one; 新しい文 makes another.
const path = (seed: string, tier = 1) => `drill/ladder/${seedKey(seed)}${tier > 1 ? `@${tier}` : ""}`;

export const readLadder = (seed: string, tier = 1) => getJson<Ladder>(path(seed, tier));

// A card that builds its sentence (not one change from the one before) keeps what it shows and the part
// practised only when they make sense: a mark not in the sentence is dropped (nothing extra is asked
// for), a fix that is the sentence itself is no fix, tiles are kept to what the card can show.
function tidy(s: DrillStep & { parts?: string[]; mark?: string; mark_kana?: string }): DrillStep | null {
  if (CHAINED.includes(s.op)) return { lv: s.lv, op: s.op, cue: s.cue, cue_zh: s.cue_zh, ja: s.ja, kana: s.kana, zh: s.zh };
  const parts = (s.parts ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 6);
  const mark = s.mark?.trim() ?? "";
  const ok = mark && s.ja.includes(mark);
  if (s.op === "fix" && (!parts[0] || parts[0] === s.ja)) return null;
  if (!parts.length) parts.push(s.cue);
  return { lv: s.lv, op: s.op, cue: s.cue, cue_zh: s.cue_zh, ja: s.ja, kana: s.kana, zh: s.zh, parts, ...(ok ? { mark, mark_kana: s.mark_kana?.trim() ?? "" } : {}) };
}

// 返す: the lines kept are the ones that can be played and judged (a line to hear, an answer, and for an
// answer given in Chinese that Chinese), none a sentence of the ladder; then dealt into rounds of three
// answered from the Chinese and three about the learner, as many rounds as there are lines for (two).
const flat = (x: string) => x.replace(/[\s。、！？!?「」]/g, "");
export function replyRounds(draft: ReplyDraft[] | undefined, steps: DrillStep[]): DrillReply[][] {
  const taken = new Set(steps.map((x) => flat(x.ja)));
  const ok: DrillReply[] = [];
  for (const r of draft ?? []) {
    const x: DrillReply = { own: !!r.own, ask: r.ask.trim(), ask_zh: r.ask_zh.trim(), zh: r.own ? "" : r.zh.trim(), ja: r.ja.trim(), kana: r.kana.trim(), mark: r.mark.trim(), mark_kana: r.mark_kana.trim() };
    if (!x.ask || !x.ja || (!x.own && !x.zh) || taken.has(flat(x.ja))) continue;
    if (!x.ja.includes(x.mark)) x.mark = x.mark_kana = "";
    taken.add(flat(x.ja));
    ok.push(x);
  }
  const given = ok.filter((x) => !x.own);
  const own = ok.filter((x) => x.own);
  const rounds: DrillReply[][] = [];
  for (let k = 0; k < 2; k++) {
    const g = given.slice(k * REPLY_GIVEN, (k + 1) * REPLY_GIVEN);
    const o = own.slice(k * REPLY_OWN, (k + 1) * REPLY_OWN);
    // A round needs its three from the Chinese; the ones about the learner may come up short.
    if (g.length === REPLY_GIVEN) rounds.push([...g, ...o]);
  }
  return rounds;
}

// avoid: the sentences of the ladder it replaces (新しい文), not to be used again.
export async function makeLadder(seed: string, avoid: string[] = [], tier = 1): Promise<Ladder> {
  tier = Math.min(TIERS, Math.max(1, Math.round(tier)));
  const memo = await aboutNow(jstDay()).catch(() => "（メモなし）");
  const context = avoid.length ? `${memo}\n\n前回のはしごの文（同じ文・同じ入れ替え語は使わない）：\n${avoid.map((a) => `- ${a}`).join("\n")}` : memo;
  // A ladder cut off by its length is asked for once more.
  const kind = kindOf(seed);
  const draft = await drillLadder(seed, context, tier, kind).catch((e: unknown) => {
    if (e instanceof Error && e.message.includes("max_tokens")) return drillLadder(seed, context, tier, kind);
    throw e;
  });
  const steps: DrillStep[] = draft.steps
    .map((s) => tidy({ ...s, lv: Math.min(LEVELS, Math.max(1, Math.round(s.lv))), cue: s.cue.trim(), cue_zh: s.cue_zh.trim(), ja: s.ja.trim(), kana: s.kana.trim(), zh: s.zh.trim() }))
    .filter((s): s is DrillStep => !!s && !!s.ja && !!s.cue);
  if (steps.length < 8) throw new Error("出题失败，再试一次");
  // Levels in order, whatever order they came in.
  steps.sort((a, b) => a.lv - b.lv);
  if (CHAINED.includes(steps[0].op)) steps[0] = { ...steps[0], op: "base" };
  const replies = replyRounds(draft.replies, steps);
  const ladder: Ladder = { seed: draft.seed.trim() || seed, meaning_zh: draft.meaning_zh.trim(), made: Date.now(), tier, steps, ...(replies.length ? { replies } : {}) };
  await keep(seed, ladder);
  return ladder;
}

async function keep(seed: string, ladder: Ladder) {
  const tier = ladder.tier ?? 1;
  await setJson(path(seed, tier), ladder, 30);
  // Opened again from its chip by the tidied name: the same ladder.
  if (seedKey(ladder.seed) !== seedKey(seed)) await setJson(path(ladder.seed, tier), ladder, 30);
}

// A ladder made before 返す (or whose lines didn't make a round) gets its rounds now, and is kept with them.
export async function addReplies(seed: string, ladder: Ladder): Promise<Ladder> {
  if (ladder.replies?.length) return ladder;
  const memo = await aboutNow(jstDay()).catch(() => "（メモなし）");
  const replies = replyRounds(await drillReplies(ladder.seed, ladder.tier ?? 1, ladder.steps.map((x) => x.ja), memo), ladder.steps);
  if (!replies.length) throw new Error("出题失败，再试一次");
  // Read again: a 新しい文 made meanwhile is the one to keep.
  const now = await readLadder(seed, ladder.tier ?? 1);
  if (now && now.made !== ladder.made) return now;
  const next = { ...ladder, replies };
  await keep(seed, next);
  return next;
}
