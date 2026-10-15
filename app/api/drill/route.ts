import { NextResponse } from "next/server";
import { makeDrill } from "@/lib/claude";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { tag, zh, examples } = (await request.json()) as {
    tag?: string;
    zh?: string;
    examples?: { said: string; better: string }[];
  };
  if (!tag) return NextResponse.json({ error: "缺少要练的语法点" }, { status: 400 });
  try {
    return NextResponse.json(await makeDrill({ tag, zh: zh ?? "", examples: (examples ?? []).slice(0, 4) }));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "生成失败" }, { status: 502 });
  }
}
