import { readPicture } from "@/lib/pictures";
import { storageReady } from "@/lib/store";

const KEY = /^[a-z0-9]{1,40}$/i;

// The pictures drawn for the news (lib/pictures.ts): /api/pic/w/<key> a word's, /api/pic/s/<article>/<n> a
// sentence's. Our own drawings, so the CDN may keep them; a picture never changes under its address.
export async function GET(_: Request, { params }: { params: Promise<{ p: string[] }> }) {
  const { p } = await params;
  if (!storageReady()) return new Response("not found", { status: 404 });
  const [kind, id, n] = p;
  const ok = (kind === "w" && KEY.test(id ?? "") && p.length === 2) || (kind === "s" && KEY.test(id ?? "") && /^\d{1,3}$/.test(n ?? "") && p.length === 3);
  if (!ok) return new Response("not found", { status: 404 });
  const body = await readPicture(kind as "w" | "s", id, Number(n));
  if (!body) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const png = new Uint8Array(body)[0] === 0x89;
  return new Response(body, {
    headers: { "Content-Type": png ? "image/png" : "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Robots-Tag": "noindex" },
  });
}
