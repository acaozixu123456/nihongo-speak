import { after, NextResponse } from "next/server";
import { makeSet, readSet, warm } from "@/lib/kokoro";
import { jstDay } from "@/lib/push";
import { storageReady } from "@/lib/store";

export const maxDuration = 300;

// Called by Vercel Cron at 8:00 JST, after the Drive routine (7:30 on weekdays) had its chance: writes
// the day's 心で答える questions if nobody has yet, so they are ready when the learner opens the page.
// A set already written has its lines asked for again: each deploy starts the CDN empty, so this puts
// them back in Tokyo (call it by hand after a daytime deploy); lines still cached cost nothing.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const fromCron = secret ? auth === `Bearer ${secret}` : (request.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (!fromCron) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!storageReady()) return NextResponse.json({ storage: false });
  const day = jstDay();
  try {
    const saved = await readSet(day);
    if (saved) {
      after(() => warm(saved));
      return NextResponse.json({ fresh: false, day });
    }
    const set = await makeSet(day);
    after(() => warm(set));
    return NextResponse.json({ fresh: true, items: set.items.length });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "kokoro failed" }, { status: 502 });
  }
}
