import { synthesizeParts, type Part } from "@/lib/azure";

export const maxDuration = 30;

// A voice list as the scenarios write them: "ja-JP-Masaru:DragonHDLatestNeural|ja-JP-KeitaNeural", optionally "@style".
const VOICE = /^(ja-JP|zh-CN)-[\w:]+Neural(@\w+)?(\|(ja-JP|zh-CN)-[\w:]+Neural(@\w+)?)*$/;

// One clip of 摸鱼模式: a few spoken parts with pauses, as one MP3. The phone caches each clip
// and joins them into one long file, so the same sentence is only ever synthesized once.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { parts?: unknown } | null;
  const parts = Array.isArray(body?.parts) ? (body.parts as Part[]) : [];
  const ok =
    parts.length > 0 &&
    parts.length <= 40 &&
    parts.every(
      (p) =>
        typeof p?.voice === "string" &&
        VOICE.test(p.voice) &&
        (p.text === undefined || (typeof p.text === "string" && p.text.length <= 300)) &&
        (p.pauseMs === undefined || (typeof p.pauseMs === "number" && p.pauseMs >= 0 && p.pauseMs <= 8000)),
    ) &&
    parts.reduce((n, p) => n + (p.text?.length ?? 0), 0) <= 2500;
  if (!ok) return new Response("bad request", { status: 400 });
  try {
    const audio = await synthesizeParts(parts);
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error(e);
    return new Response("tts failed", { status: 502 });
  }
}
