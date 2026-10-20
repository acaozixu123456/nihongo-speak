import { NextResponse } from "next/server";
import { readNews } from "@/lib/news";
import { storageReady } from "@/lib/store";

// The kept NHKやさしいことばニュース articles, newest first. Only for this app: not cached by the CDN or
// indexed (NHK's text is studied here, not published).
export async function GET(request: Request) {
  // Only this app's own pages (the browser marks a same-site fetch); not anyone with the address.
  const site = request.headers.get("sec-fetch-site");
  if (site !== "same-origin" && site !== "same-site") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!storageReady()) return NextResponse.json({ made: 0, items: [] });
  try {
    const file = await readNews();
    return NextResponse.json(file, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "news unavailable" }, { status: 502 });
  }
}
