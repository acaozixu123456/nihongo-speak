import { NextResponse } from "next/server";
import { pointExamples } from "@/lib/claude";
import { burst } from "@/lib/quota";

const str = (s: unknown, n: number): s is string => typeof s === "string" && s.length <= n;

// 洗脑连播: a short example sentence (and its translation) for each grammar point in the reel.
export async function POST(request: Request) {
  const b = (await request.json()) as { points?: unknown };
  const points = Array.isArray(b.points) ? b.points.slice(0, 20) : [];
  const ok = points.every(
    (p: { pattern?: unknown; zh?: unknown; seed?: unknown }) =>
      str(p?.pattern, 120) && str(p?.zh, 300) && (p.seed === undefined || str(p.seed, 200)),
  );
  if (!points.length || !ok) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (!burst("example", 60, 10 * 60_000)) return NextResponse.json({ error: "too many" }, { status: 429 });
  try {
    return NextResponse.json({ items: await pointExamples(points) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
