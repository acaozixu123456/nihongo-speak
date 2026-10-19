import { NextResponse } from "next/server";
import { jstDay } from "@/lib/push";
import { readState, storageReady } from "@/lib/store";
import { readTeacher, teach } from "@/lib/teacher";

export const maxDuration = 300;

// Called by Vercel Cron at 3:00 JST (see vercel.json). Nothing new practised since the last plan: no call.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const fromCron = secret ? auth === `Bearer ${secret}` : (request.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (!fromCron) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!storageReady()) return NextResponse.json({ fresh: false, storage: false });

  const [{ progress }, last] = await Promise.all([readState(), readTeacher()]);
  const force = new URL(request.url).searchParams.has("force");
  if (last && last.made > progress.updatedAt && !force) return NextResponse.json({ fresh: false, day: last.day });
  try {
    const t = await teach(progress, jstDay(), last);
    return NextResponse.json({ fresh: true, teacher: t });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "teacher failed" }, { status: 502 });
  }
}
