import { NextResponse } from "next/server";
import { makePodcast } from "@/lib/claude";

export const maxDuration = 60;

const str = (s: unknown, n: number): s is string => typeof s === "string" && s.length <= n;

// Haiku writes today's episode from the learner's profile. 摸鱼模式 turns it into audio (see lib/client/moyu.ts).
export async function POST(request: Request) {
  const body = (await request.json()) as { kind: "script"; weak?: unknown; cards?: unknown; scenes?: unknown };
  try {
    if (body.kind === "script") {
      const weak = (Array.isArray(body.weak) ? body.weak : []).slice(0, 3).filter((w) => str(w?.tag, 80) && str(w?.zh, 200));
      const cards = (Array.isArray(body.cards) ? body.cards : []).slice(0, 8).filter((c) => str(c?.ja, 200) && str(c?.zh, 200));
      const scenes = (Array.isArray(body.scenes) ? body.scenes : []).slice(0, 6).filter((s) => str(s, 60));
      return NextResponse.json(
        await makePodcast({
          weak: weak.map((w) => ({
            tag: w.tag,
            zh: w.zh,
            examples: (Array.isArray(w.examples) ? w.examples : [])
              .slice(0, 2)
              .filter((e: { said?: unknown; better?: unknown }) => str(e?.said, 200) && str(e?.better, 200)),
          })),
          cards,
          scenes,
        }),
      );
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "生成失败" }, { status: 502 });
  }
}
