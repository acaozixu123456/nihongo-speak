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
    // ?engine=vertex skips the chain and fails loudly, to check the Vertex AI key on the live site.
    const gemini = geminiVoice(voice);
    const { audio, engine } =
      url.searchParams.get("engine") === "vertex" && gemini
        ? { audio: new Uint8Array(await synthesizeVertex(text, gemini, 12000)), engine: "vertex" }
        : await speak(text, voice);
    // A Japanese line that fell back to Azure sounds noticeably worse: don't let the phone keep it,
    // so the next play asks Gemini again.
    const fallback = engine === "azure" && gemini;
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "X-TTS-Engine": engine,
        // Same text + voice gives the same audio, so let the phone keep it.
        "Cache-Control": fallback ? "no-store" : "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("tts failed", { status: 502 });
  }
}

// Japanese goes to Gemini, which sounds the most natural. Vertex AI first: same voice, paid from the
// Google Cloud credit (and once that runs out it fails fast). Then the Gemini API, each model with
// its own daily quota (100 on the first paid tier). Azure stays as the last fallback (no key, quota
// used up everywhere, slow answer) and keeps the Chinese narration.
async function speak(text: string, voice: string): Promise<{ audio: BodyInit; engine: string }> {
  const gemini = geminiVoice(voice);
  if (gemini && vertexConfigured()) {
    try {
      return { audio: new Uint8Array(await hedgedVertex(text, gemini)), engine: "vertex" };
    } catch (e) {
      console.warn(e);
    }
  }
  if (gemini && geminiConfigured()) {
    for (const model of [FLASH, FLASH_LITE]) {
      try {
        return { audio: new Uint8Array(await synthesizeGemini(text, gemini, 12000, model)), engine: "gemini" };
      } catch (e) {
        console.warn(e);
        if (!String(e).includes("Gemini TTS 429")) break;
      }
    }
  }
  return { audio: await synthesize(text, voice), engine: "azure" };
}

// Now and then a Vertex request hangs for the whole timeout (about 1 in 6 when a phone asks for a
// dozen lines at once), which used to drop that line to Azure. If the first try hasn't answered in
// 5s, a second one starts alongside it and whichever finishes first wins.
async function hedgedVertex(text: string, voice: string) {
  const first = synthesizeVertex(text, voice, 15000);
  const second = new Promise<Awaited<typeof first>>((ok, fail) =>
    setTimeout(() => synthesizeVertex(text, voice, 15000).then(ok, fail), 5000),
  );
  first.catch(() => {});
  second.catch(() => {});
  return Promise.any([first, second]);
}
