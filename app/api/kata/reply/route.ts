import { NextResponse } from "next/server";
import { replyCheck } from "@/lib/claude";
import { burst } from "@/lib/quota";

export const maxDuration = 60;

// 型ドリル 返す, a question about the learner themselves: was the word or grammar point used, was the
// sentence finished, and their own sentence made natural when it needed it.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { seed?: unknown; ask?: unknown; said?: unknown; ja?: unknown };
  const str = (x: unknown, n: number) => (typeof x === "string" ? x.trim().slice(0, n) : "");
  const seed = str(b.seed, 30);
  const ask = str(b.ask, 80);
  const said = str(b.said, 300);
  const ja = str(b.ja, 120);
  if (!seed || !ask || !said) return NextResponse.json({ error: "没听清，再说一次" }, { status: 400 });
  if (!burst("kata-reply", 120, 10 * 60_000)) return NextResponse.json({ error: "太频繁了，等一下" }, { status: 429 });
  try {
    return NextResponse.json(await replyCheck({ seed, ask, said, ja }));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "判定失败" }, { status: 502 });
  }
}
