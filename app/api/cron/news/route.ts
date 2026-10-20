import { NextResponse } from "next/server";
import { jstDay } from "@/lib/push";
import { refreshNews, warmVoices } from "@/lib/news";
import { storageReady } from "@/lib/store";

export const maxDuration = 300;

// Called by Vercel Cron at 21:00 JST, soon after NHK puts the day's articles out (~20:10), so they are on the
// phone the night before the train, and again at 8:30 for any it missed (see vercel.json). ?redo=1 makes the
// kept articles of the last days again (after the notes changed).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const fromCron = secret ? auth === `Bearer ${secret}` : (request.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (!fromCron) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!storageReady()) return NextResponse.json({ storage: false });
  try {
    const { added, failed, file } = await refreshNews(jstDay(), { redo: new URL(request.url).searchParams.get("redo") === "1" });
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const fresh = file.items.filter((a) => added.includes(a.id));
    const voices = host && fresh.length ? await warmVoices(`https://${host}`, fresh) : null;
    return NextResponse.json({ added, failed, kept: file.items.length, voices });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "news failed" }, { status: 502 });
  }
}
