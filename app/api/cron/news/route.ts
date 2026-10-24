import { NextResponse } from "next/server";
import { jstDay } from "@/lib/push";
import { refreshNews, warmVoices } from "@/lib/news";
import { drawNewsPictures, pictureModels } from "@/lib/pictures";
import { storageReady } from "@/lib/store";

export const maxDuration = 300;

// Called by Vercel Cron at 21:00 JST, soon after NHK puts the day's articles out (~20:10), so they are on the
// phone the night before the train, and again at 8:30 for any it missed (see vercel.json). ?redo=1 makes the
// kept articles of the last days again (after the notes changed). ?warm=N asks again for the voice of the
// articles of the last N days NHK put out (after the voices changed). Then the pictures for the newest day's
// articles, in the time left (lib/pictures.ts); ?pics=only draws them without fetching NHK, ?ids=a,b just
// those articles, ?days=N the newest N days.
export async function GET(request: Request) {
  const t0 = Date.now();
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const fromCron = secret ? auth === `Bearer ${secret}` : (request.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (!fromCron) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!storageReady()) return NextResponse.json({ storage: false });
  const q = new URL(request.url).searchParams;
  const drawPics = (from: number) =>
    drawNewsPictures({ until: from + 250_000, days: Number(q.get("days")) || 1, ids: q.get("ids")?.split(",").filter(Boolean), redraw: q.get("redraw") === "1" }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  if (q.get("pics") === "models") return NextResponse.json(await pictureModels().catch((e) => ({ error: String(e) })));
  if (q.get("pics") === "only") return NextResponse.json({ pics: await drawPics(t0) });
  try {
    const { added, failed, file } = await refreshNews(jstDay(), { redo: new URL(request.url).searchParams.get("redo") === "1" });
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const warm = Number(new URL(request.url).searchParams.get("warm")) || 0;
    const days = [...new Set(file.items.map((a) => a.day))].sort().reverse().slice(0, warm);
    const fresh = file.items.filter((a) => added.includes(a.id) || days.includes(a.day));
    const voices = host && fresh.length ? await warmVoices(`https://${host}`, fresh) : null;
    const pics = await drawPics(t0);
    return NextResponse.json({ added, failed, kept: file.items.length, voices, pics });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "news failed" }, { status: 502 });
  }
}
