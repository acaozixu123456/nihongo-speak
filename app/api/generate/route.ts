import { NextResponse } from "next/server";
import { generateScenario } from "@/lib/claude";
import { buildScenario } from "@/lib/voices";

export const maxDuration = 120;

export async function POST(request: Request) {
  const { topic, category } = (await request.json()) as { topic?: string; category?: string };
  if (!topic?.trim() || topic.length > 200) return NextResponse.json({ error: "请写一句想练的场景" }, { status: 400 });
  try {
    const cat = category === "work" ? "work" : "life";
    const generated = await generateScenario(topic.trim(), cat);
    return NextResponse.json({ ...buildScenario(generated, cat, `ai-${Date.now().toString(36)}`), createdAt: Date.now() });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "生成失败" }, { status: 502 });
  }
}
