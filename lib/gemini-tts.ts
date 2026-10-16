// Japanese speech from Gemini TTS, encoded as the same MP3 Azure gives us (24 kHz, 48 kbit/s,
// mono) so 摸鱼模式 can keep joining clips frame by frame. No "server-only" here because
// scripts/bake-voices.ts uses it too.
export const FLASH = "gemini-3.8-flash-tts";
// Same voices, its own daily quota; scripts/bake-voices.ts --lite uses it.
export const FLASH_LITE = "gemini-3.8-flash-lite-tts";

// The scenarios name Azure voices; each one maps to a Gemini voice of the same gender and feel.
const VOICES: Record<string, string> = {
  Masaru: "Charon",
  Keita: "Achird",
  Daichi: "Iapetus",
  Naoki: "Orus",
  Nanami: "Sulafat",
  Mayu: "Leda",
  Aoi: "Aoede",
  Shiori: "Despina",
};

// "ja-JP-Masaru:DragonHDLatestNeural|ja-JP-KeitaNeural" → "Charon". Null for voices with no match.
export function geminiVoice(voiceId: string) {
  const name = /^ja-JP-([A-Za-z]+)/.exec(voiceId.split("|")[0])?.[1]?.replace(/Neural$/, "");
  return (name && VOICES[name]) || null;
}

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

// Gemini answers with 16-bit mono PCM at 24 kHz, either bare or wrapped in a WAV header.
function pcm(bytes: Buffer) {
  let body = bytes;
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF") {
    const at = bytes.indexOf("data", 12, "latin1");
    if (at < 0) throw new Error("Gemini TTS: WAV without data");
    body = bytes.subarray(at + 8);
  }
  const copy = new Uint8Array(body.length - (body.length % 2));
  copy.set(body.subarray(0, copy.length));
  return new Int16Array(copy.buffer);
}

// Loaded as ESM on purpose: the package's CommonJS build exports nothing, and the bake script runs
// this file as CommonJS.
async function mp3(samples: Int16Array) {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const enc = new Mp3Encoder(1, 24000, 48);
  const parts: Buffer[] = [];
  // lamejs hands back Int8Arrays despite its types.
  const add = (b: ArrayBufferView) => parts.push(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
  for (let i = 0; i < samples.length; i += 1152 * 10) add(enc.encodeBuffer(samples.subarray(i, i + 1152 * 10)));
  add(enc.flush());
  return Buffer.concat(parts);
}

// Only the sentence is sent: a style instruction in front of it gets read out loud.
export async function synthesizeGemini(text: string, voice: string, timeoutMs = 15000, model = FLASH) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text();
    const daily = body.includes("per_day") ? " (daily quota)" : "";
    throw new Error(`Gemini TTS ${res.status}${daily} for ${voice} on ${model}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) throw new Error(`Gemini TTS returned no audio for ${voice}`);
  return mp3(pcm(Buffer.from(b64, "base64")));
}
