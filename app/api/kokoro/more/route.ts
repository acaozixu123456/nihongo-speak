import { after, NextResponse } from "next/server";
import { makeSet, warm } from "@/lib/kokoro";
import { jstDay } from "@/lib/push";
import { spend, tooMany } from "@/lib/quota";
import { storageReady } from "@/lib/store";

export const maxDuration = 300;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Another set of 心で答える questions for today, asked for from the page once the day's three laps are
// done. asked: the questions that phone went through today, the set just done first (it may have kept
// an older set than the one saved), left out of the new one. The new set replaces the day's saved one,
// and its lines are made in Tokyo while the phone makes its first lap.
export async function POST(request: Request) {
  if (!storageReady()) return NextResponse.json({ error: "没有存储" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { day?: unknown; asked?: unknown };
  const day = typeof body.day === "string" && DAY.test(body.day) ? body.day : jstDay();
  const asked = Array.isArray(body.asked) ? body.asked.filter((q): q is string => typeof q === "string" && !!q.trim()).map((q) => q.trim().slice(0, 120)).slice(0, 60) : [];
  if (!(await spend("kokoro"))) return tooMany();
  try {
    const set = await makeSet(day, { more: asked });
    after(() => warm(set));
    return NextResponse.json(set);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "出题失败" }, { status: 502 });
  }
}
