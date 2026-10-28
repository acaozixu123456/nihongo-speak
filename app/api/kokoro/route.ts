import { after, NextResponse } from "next/server";
import { makeSet, readSet, saveNotes, warm } from "@/lib/kokoro";
import { jstDay } from "@/lib/push";
import { spend, tooMany } from "@/lib/quota";
import { storageReady } from "@/lib/store";

export const maxDuration = 300;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The day's 心で答える questions: the saved set, or written now (about 30-60 s) when there is none yet.
export async function GET(request: Request) {
  if (!storageReady()) return NextResponse.json({ error: "没有存储" }, { status: 503 });
  const day = new URL(request.url).searchParams.get("day") ?? jstDay();
  if (!DAY.test(day)) return NextResponse.json({ error: "bad day" }, { status: 400 });
  try {
    const saved = await readSet(day);
    if (saved) return NextResponse.json(saved);
    if (!(await spend("kokoro"))) return tooMany();
    return NextResponse.json(await makeSet(day));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "出题失败" }, { status: 502 });
  }
}

// The weekday-morning routine that reads the learner's Google Drive sends what they worked on as a
// few short Japanese notes; the day's set is then written again with them. Same gate as the crons.
// try: true makes a trial set from these notes (none is fine) without keeping anything, for testing.
export async function POST(request: Request) {
  if (!(request.headers.get("user-agent") ?? "").includes("vercel-cron")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!storageReady()) return NextResponse.json({ error: "没有存储" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { notes?: unknown; day?: unknown; try?: unknown };
  const notes = Array.isArray(body.notes) ? body.notes.filter((n): n is string => typeof n === "string" && !!n.trim()).map((n) => n.trim().slice(0, 160)).slice(0, 8) : [];
  const day = typeof body.day === "string" && DAY.test(body.day) ? body.day : jstDay();
  const trial = body.try === true;
  if (!notes.length && !trial) return NextResponse.json({ error: "no notes" }, { status: 400 });
  try {
    if (!trial) await saveNotes(day, notes);
    if (!(await spend("kokoro"))) return tooMany();
    const set = await makeSet(day, trial ? { try: notes } : {});
    if (!trial) after(() => warm(set));
    return NextResponse.json(set);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "出题失败" }, { status: 502 });
  }
}
