import { readNewsImage } from "@/lib/news";
import { storageReady } from "@/lib/store";

const ID = /^[a-z0-9]{1,40}$/i;

// NHK's picture for a kept article. Like /api/news, only for this app's own pages and kept by the phone
// alone (not the CDN), and gone with the article after 14 days.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== "same-origin" && site !== "same-site") return new Response("forbidden", { status: 403 });
  const { id } = await params;
  if (!ID.test(id) || !storageReady()) return new Response("not found", { status: 404 });
  const body = await readNewsImage(id);
  if (!body) return new Response("not found", { status: 404 });
  return new Response(body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=604800, immutable", "X-Robots-Tag": "noindex" },
  });
}
