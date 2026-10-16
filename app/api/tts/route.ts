import { synthesize } from "@/lib/azure";
import { FLASH, FLASH_LITE, geminiConfigured, geminiVoice, synthesizeGemini } from "@/lib/gemini-tts";
import { synthesizeVertex, vertexConfigured } from "@/lib/vertex-tts";

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
    const audio = await speak(text, voice);
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

// Japanese goes to Gemini, which sounds the most natural; Azure stays as the fallback (no key,
// quota used up everywhere, slow answer) and keeps the Chinese narration.
async function speak(text: string, voice: string): Promise<BodyInit> {
  const gemini = geminiVoice(voice);
  if (gemini && geminiConfigured()) {
    // Each model has its own daily quota (100 on the first paid tier), so Lite picks up after Flash.
    for (const model of [FLASH, FLASH_LITE]) {
      try {
        return new Uint8Array(await synthesizeGemini(text, gemini, 12000, model));
      } catch (e) {
        console.warn(e);
        if (!String(e).includes("Gemini TTS 429")) break;
      }
    }
  }
  // The same voice again through Vertex AI, paid from the Google Cloud credit, before Azure.
  if (gemini && vertexConfigured()) {
    try {
      return new Uint8Array(await synthesizeVertex(text, gemini, 12000));
    } catch (e) {
      console.warn(e);
    }
  }
  return synthesize(text, voice);
}
