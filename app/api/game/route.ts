import { NextResponse } from "next/server";
import { makeGame, type GameItem } from "@/lib/game";

export const maxDuration = 120;

const str = (s: unknown, n: number): s is string => typeof s === "string" && s.length <= n;

// 练一练: the phone sends the items to practise (an episode's, and/or ones due again), each with its level.
export async function POST(request: Request) {
  const b = (await request.json()) as { topic?: unknown; items?: unknown };
  const items = (Array.isArray(b.items) ? b.items : [])
    .slice(0, 12)
    .filter((x) => str(x?.ja, 300) && str(x?.zh, 300) && str(x?.kind, 20) && (x.note === undefined || str(x.note, 200)))
    .map((x): GameItem => ({ ja: x.ja, zh: x.zh, kind: x.kind, note: x.note, level: Math.max(0, Math.min(5, Number(x.level) || 0)) }));
  if (!items.length) return NextResponse.json({ error: "没有可以练的内容" }, { status: 400 });
  try {
    return NextResponse.json(await makeGame({ topic: str(b.topic, 80) ? b.topic : undefined, items }));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
