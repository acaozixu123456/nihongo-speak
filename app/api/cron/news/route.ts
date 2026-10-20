import { NextResponse } from "next/server";
import { jstDay } from "@/lib/push";
import { refreshNews, warmVoices } from "@/lib/news";
import { storageReady } from "@/lib/store";

export const maxDuration = 300;

// Called by Vercel Cron at 8:30 JST (see vercel.json): this morning's NHKやさしいことばニュース, before the train.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const fromCron = secret ? auth === `Bearer ${secret}` : (request.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (!fromCron) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!storageReady()) return NextResponse.json({ storage: false });
  try {
    const { added, failed, file } = await refreshNews(jstDay());
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const fresh = file.items.filter((a) => added.includes(a.id));
    const voices = host && fresh.length ? await warmVoices(`https://${host}`, fresh) : null;
    return NextResponse.json({ added, failed, kept: file.items.length, voices });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "news failed" }, { status: 502 });
  }
}
