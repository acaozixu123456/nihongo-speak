import { NextResponse } from "next/server";
import { diaryFeedback } from "@/lib/claude";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { prompt, text } = (await request.json()) as { prompt?: string; text?: string };
  if (!text?.trim() || text.length > 2000) return NextResponse.json({ error: "没有听到内容" }, { status: 400 });
  try {
    return NextResponse.json(await diaryFeedback(prompt ?? "今日のこと", text.trim()));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "点评失败" }, { status: 502 });
  }
}
