import { synthesize } from "@/lib/azure";

// "HD|fallback" voice lists as the scenarios write them; Chinese is for 摸鱼模式's narration.
const VOICE = /^(ja-JP|zh-CN)-[\w:]+Neural(@\w+)?(\|(ja-JP|zh-CN)-[\w:]+Neural(@\w+)?)*$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const text = url.searchParams.get("text") ?? "";
  const voice = url.searchParams.get("voice") ?? "ja-JP-NanamiNeural";
  if (!text || text.length > 400 || !VOICE.test(voice)) {
    return new Response("bad request", { status: 400 });
  }
  try {
    const audio = await synthesize(text, voice);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        // Same text + voice gives the same audio, so let the phone keep it.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("tts failed", { status: 502 });
  }
}
