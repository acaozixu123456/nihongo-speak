import { NextResponse } from "next/server";
import { checkReadings } from "@/lib/reading";

// Gemini may take up to 25s on a reading (lib/reading.ts).
export const maxDuration = 60;

const str = (s: unknown, n: number): s is string => typeof s === "string" && s.length <= n;

// The readings over an episode saved before they were checked (story.keys and words), checked now.
export async function POST(request: Request) {
  const b = (await request.json()) as { words?: unknown };
  const words = Array.isArray(b.words) ? b.words : [];
  if (!words.length || words.length > 12 || !words.every((w) => str(w?.ja, 20) && str(w?.kana, 40))) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    return NextResponse.json({ kana: await checkReadings(words as { ja: string; kana: string }[]) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
