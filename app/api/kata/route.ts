import { NextResponse } from "next/server";
import { makeLadder, readLadder } from "@/lib/drill";
import { TIERS, seedKey } from "@/lib/drill-model";
import { spend, tooMany } from "@/lib/quota";
import { storageReady } from "@/lib/store";

export const maxDuration = 300;

// 型ドリル: the ladder for a word or grammar point the learner typed. fresh: a new one (新しい文).
// tier: 2 and 3 are the 升级 ladders (中級, 会話), each kept on its own.
export async function POST(request: Request) {
  if (!storageReady()) return NextResponse.json({ error: "没有存储" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { seed?: unknown; fresh?: unknown; tier?: unknown };
  const seed = typeof body.seed === "string" ? body.seed.trim().slice(0, 30) : "";
  const tier = typeof body.tier === "number" && body.tier >= 1 && body.tier <= TIERS ? Math.round(body.tier) : 1;
  if (!seedKey(seed)) return NextResponse.json({ error: "输入一个单词或语法" }, { status: 400 });
  try {
    const saved = await readLadder(seed, tier);
    if (saved && body.fresh !== true) return NextResponse.json(saved);
    if (!(await spend("drill"))) return tooMany();
    return NextResponse.json(await makeLadder(seed, saved?.steps.map((s) => s.ja) ?? [], tier));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "出题失败" }, { status: 502 });
  }
}
