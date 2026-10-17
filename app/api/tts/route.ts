import { synthesize } from "@/lib/azure";
import { FLASH, FLASH_LITE, geminiConfigured, geminiVoice, synthesizeGemini } from "@/lib/gemini-tts";
import { readingOf, synthesizeVertex, vertexConfigured } from "@/lib/vertex-tts";
import { kanaReading } from "@/lib/claude";

// "HD|fallback" voice lists as the scenarios write them; Chinese is for 摸鱼模式's narration.
// Has kanji but no kana at all, e.g. 主食 or 確認.
const KANJI_ONLY = /^(?=.*[\u4e00-\u9fff])[^\u3040-\u30ff]+$/;

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
    const { audio, engine, said } =
      url.searchParams.get("engine") === "vertex" && gemini
        ? { audio: new Uint8Array(await synthesizeVertex(text, gemini, 12000)), engine: "vertex" }
        : await speak(text, voice);
    // A Japanese line that fell back to Azure sounds noticeably worse: don't let the phone keep it,
    // so the next play asks Gemini again.
    // The ?engine= check is never kept either, so it always reaches Vertex.
    const fallback = (engine === "azure" && gemini) || url.searchParams.has("engine");
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "X-TTS-Engine": engine,
        // What Gemini was given when it wasn't the text itself (a kanji word's reading), to check it.
        ...(said && said !== text ? { "X-TTS-Said": encodeURIComponent(said) } : {}),
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

// Japanese goes to Gemini, which sounds the most natural. Vertex AI first: same voice, paid from the
// Google Cloud credit (and once that runs out it fails fast). Then the Gemini API, each model with
// its own daily quota (100 on the first paid tier). Azure stays as the last fallback (no key, quota
// used up everywhere, slow answer) and keeps the Chinese narration.
async function speak(text: string, voice: string): Promise<{ audio: BodyInit; engine: string; said?: string }> {
  // Kanji with no kana would come out in Chinese: Gemini says the reading instead. Without a
  // reading it goes to Azure, which reads kanji in Japanese, rather than to Gemini as it is.
  let gemini = geminiVoice(voice);
  let said = text;
  if (gemini && KANJI_ONLY.test(text)) {
    const kana = await reading(text);
    if (kana) said = kana;
    else gemini = null;
  }
  if (gemini && vertexConfigured()) {
    try {
      return { audio: new Uint8Array(await hedgedVertex(said, gemini)), engine: "vertex", said };
    } catch (e) {
      console.warn(e);
    }
  }
  if (gemini && geminiConfigured()) {
    for (const model of [FLASH, FLASH_LITE]) {
      try {
        return { audio: new Uint8Array(await synthesizeGemini(said, gemini, 12000, model)), engine: "gemini", said };
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

// Gemini's reading and Haiku's, asked together. Either can fail now and then, and either can be
// wrong (Gemini gave 木炭 as たんざん), so when both answer they must agree; when they don't,
// null sends the word to Azure, which reads kanji in Japanese.
async function reading(text: string): Promise<string | null> {
  const plain = (r: string | null) => r?.replace(/[\s、。！？・]/g, "") || null;
  const [a, b] = await Promise.all([readingOf(text), kanaReading(text)].map((p) => p.catch(() => null)));
  if (a && b) return plain(a) === plain(b) ? a : (console.warn(`readings differ for ${text}: ${a} / ${b}`), null);
  return a ?? b;
}
