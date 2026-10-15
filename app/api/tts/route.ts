import { synthesize } from "@/lib/azure";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const text = url.searchParams.get("text") ?? "";
  const voice = url.searchParams.get("voice") ?? "ja-JP-NanamiNeural";
  if (!text || text.length > 400 || !/^ja-JP-\w+Neural(@\w+)?$/.test(voice)) {
    return new Response("bad request", { status: 400 });
  }
  try {
    const audio = await synthesize(text, voice);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        // Same text + voice always gives the same audio, so let the phone keep it.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("tts failed", { status: 502 });
  }
}
