import { makeMusic, MUSIC, readMusic, type Music } from "@/lib/radio-music";
import { storageReady } from "@/lib/store";
import { vertexConfigured } from "@/lib/vertex-tts";

export const maxDuration = 120;

// The station jingle or the background loop (lib/radio-music.ts): made the first time it is asked
// for, the same file ever after, so the phone and Vercel's CDN keep it.
export async function GET(_: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(kind in MUSIC)) return new Response("not found", { status: 404 });
  if (!storageReady() || !vertexConfigured()) return new Response("not set up", { status: 503 });
  try {
    const mp3 = (await readMusic(kind as Music)) ?? (await makeMusic(kind as Music));
    return new Response(new Uint8Array(mp3), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "CDN-Cache-Control": "max-age=31536000",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("music failed", { status: 502 });
  }
}
