import { NextResponse } from "next/server";
import { generateScenario, type Photo } from "@/lib/claude";
import { buildScenario } from "@/lib/voices";

export const maxDuration = 120;

const TYPES: Photo["mediaType"][] = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request: Request) {
  const { topic, category, photo } = (await request.json()) as { topic?: string; category?: string; photo?: string };
  const text = (topic ?? "").trim();
  // The photo comes as a data URL, already shrunk on the phone.
  const m = typeof photo === "string" ? /^data:(image\/[a-z]+);base64,(.+)$/.exec(photo) : null;
  const img = m && TYPES.includes(m[1] as Photo["mediaType"]) && m[2].length < 4_000_000
    ? { mediaType: m[1] as Photo["mediaType"], data: m[2] }
    : undefined;
  if ((!text && !img) || text.length > 500) return NextResponse.json({ error: "说一句发生了什么，或者拍张照片" }, { status: 400 });
  try {
    const cat = category === "work" ? "work" : "life";
    const generated = await generateScenario(text, cat, img);
    return NextResponse.json({ ...buildScenario(generated, cat, `ai-${Date.now().toString(36)}`), createdAt: Date.now() });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "生成失败" }, { status: 502 });
  }
}
