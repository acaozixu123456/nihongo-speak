import { NextResponse } from "next/server";
import { judgeAnswer, judgeFreeAnswer } from "@/lib/claude";

export const maxDuration = 30;

export async function POST(request: Request) {
  const { zh, ja, where, said, known, q, form } = (await request.json()) as {
    zh?: string;
    ja?: string;
    where?: string;
    said?: string;
    known?: string[];
    q?: string;
    form?: string;
  };
  if (!zh || !ja || !said?.trim() || said.length > 500) return NextResponse.json({ error: "没有听到内容" }, { status: 400 });
  try {
    const tags = Array.isArray(known) ? known.filter((t) => typeof t === "string").slice(0, 40) : [];
    // A question answered in the learner's own words (心で答える): judged on the answer, not on the model's content.
    if (typeof q === "string" && q.trim()) {
      return NextResponse.json(await judgeFreeAnswer({ q: q.slice(0, 200), form: typeof form === "string" ? form.slice(0, 200) : "", ja, said: said.trim(), known: tags }));
    }
    return NextResponse.json(await judgeAnswer({ zh, ja, where, said: said.trim(), known: tags }));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "点评失败" }, { status: 502 });
  }
}
