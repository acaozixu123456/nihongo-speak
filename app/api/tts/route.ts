import { synthesize } from "@/lib/azure";
import { FLASH, FLASH_LITE, geminiConfigured, geminiVoice, synthesizeGemini } from "@/lib/gemini-tts";
import { synthesizeVertex, vertexConfigured } from "@/lib/vertex-tts";
import { burst } from "@/lib/quota";

// "HD|fallback" voice lists as the scenarios write them; Chinese is for 摸鱼模式's narration.
const VOICE = /^(en-US|zh-CN)-[\w:]+Neural(@\w+)?(\|(en-US|zh-CN)-[\w:]+Neural(@\w+)?)*$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const text = url.searchParams.get("text") ?? "";
  const voice = url.searchParams.get("voice") ?? "en-US-AvaNeural";
  if (!text || text.length > 400 || !VOICE.test(voice)) {
    return new Response("bad request", { status: 400 });
  }
  // Lines asked for before come from the CDN and never get here; this caps a script asking for new ones.
  if (!burst("tts", 600, 10 * 60_000)) return new Response("too many", { status: 429 });
  try {
    // ?engine=vertex skips the chain and fails loudly, to check the Vertex AI key on the live site.
    const gemini = geminiVoice(voice);
    const { audio, engine } =
      url.searchParams.get("engine") === "vertex" && gemini
        ? { audio: new Uint8Array(await synthesizeVertex(text, gemini, 12000)), engine: "vertex" }
        : await speak(text, voice);
    // A line that fell back to Azure sounds noticeably worse: don't let the phone keep it, so the next
    // play asks Gemini again. The ?engine= check is never kept either, so it always reaches Vertex.
    const fallback = (engine === "azure" && gemini) || url.searchParams.has("engine");
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "X-TTS-Engine": engine,
        // Same text + voice gives the same audio, so let the phone keep it, and Vercel's CDN too: a line
        // asked for before then comes back in a few dozen ms instead of being synthesized again.
        "Cache-Control": fallback ? "no-store" : "public, max-age=31536000, immutable",
        ...(fallback ? {} : { "CDN-Cache-Control": "max-age=31536000" }),
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("tts failed", { status: 502 });
  }
}

// English goes to Gemini, which sounds the most natural. Vertex AI first: same voice, paid from the
// Google Cloud credit (and once that runs out it fails fast). Then the Gemini API, each model with
// its own daily quota. Azure stays as the last fallback (no key, quota used up everywhere, slow answer)
// and keeps the Chinese narration.
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let giveUp: (e: unknown) => void = () => {};
  let sent = false;
  const second = new Promise<Awaited<typeof first>>((ok, fail) => {
    giveUp = fail;
    timer = setTimeout(() => {
      sent = true;
      synthesizeVertex(text, voice, 15000).then(ok, fail);
    }, 5000);
  });
  // Answered in time: the second try is never sent. Failed before it went out (credit used up,
  // refused): don't wait 5s to try the same thing; fall through.
  first.then(
    () => clearTimeout(timer),
    (e) => {
      clearTimeout(timer);
      if (!sent) giveUp(e);
    },
  );
  second.catch(() => {});
  return Promise.any([first, second]);
}
