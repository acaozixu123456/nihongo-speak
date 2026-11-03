import { NextResponse } from "next/server";
import { makeLadder, readLadder } from "@/lib/drill";
import { seedKey } from "@/lib/drill-model";
import { spend, tooMany } from "@/lib/quota";
import { storageReady } from "@/lib/store";

export const maxDuration = 120;

// 型ドリル: the ladder for a word or grammar point the learner typed. fresh: a new one (新しい文).
export async function POST(request: Request) {
  if (!storageReady()) return NextResponse.json({ error: "没有存储" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { seed?: unknown; fresh?: unknown };
  const seed = typeof body.seed === "string" ? body.seed.trim().slice(0, 30) : "";
  if (!seedKey(seed)) return NextResponse.json({ error: "输入一个单词或语法" }, { status: 400 });
  try {
    if (body.fresh !== true) {
      const saved = await readLadder(seed);
      if (saved) return NextResponse.json(saved);
    }
    if (!(await spend("drill"))) return tooMany();
    return NextResponse.json(await makeLadder(seed));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "出题失败" }, { status: 502 });
  }
}
