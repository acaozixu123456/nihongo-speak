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
  // 森先生 (components/Sensei.tsx): not an Azure voice, so Azure falls back to the next one in her list.
  Mori: "Gacrux",
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
    // Only the data chunk is sound: Gemini puts another chunk after it, which played as a loud
    // burst of noise at the end of every sentence.
    const size = bytes.readUInt32LE(at + 4);
    body = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
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
  // Copied, since the encoder may reuse its output buffer between calls.
  const add = (b: ArrayBufferView) => parts.push(Buffer.from(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
  for (let i = 0; i < samples.length; i += 1152 * 10) add(enc.encodeBuffer(samples.subarray(i, i + 1152 * 10)));
  add(enc.flush());
  return Buffer.concat(parts);
}

const API = "https://generativelanguage.googleapis.com/v1beta";

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

// Only the sentence is sent: a style instruction in front of it gets read out loud. Every voice here
// is Japanese, and saying so matters: a word written only in kanji (邪魔, 確認) was read in Chinese.
export const request = (text: string, voice: string) => ({
  contents: [{ parts: [{ text }] }],
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: { languageCode: "ja-JP", voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
  },
});

export type Reply = { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };

export function audio(reply: Reply, voice: string) {
  const b64 = reply.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) throw new Error(`Gemini TTS returned no audio for ${voice}`);
  return mp3(pcm(Buffer.from(b64, "base64")));
}

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { "x-goog-api-key": apiKey(), "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    const daily = body.includes("per_day") ? " (daily quota)" : "";
    throw new Error(`Gemini TTS ${res.status}${daily} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function synthesizeGemini(text: string, voice: string, timeoutMs = 15000, model = FLASH) {
  const reply = await call(`models/${model}:generateContent`, {
    method: "POST",
    body: JSON.stringify(request(text, voice)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return audio(reply, voice);
}

// The Batch API costs half and doesn't count against the 100-a-day quota, but answers within
// minutes rather than seconds, so it is for scripts/bake-voices.ts only. Resolves to one MP3 per
// key; a sentence that failed is missing from the map.
export async function synthesizeGeminiBatch(items: { key: string; text: string; voice: string }[], model = FLASH) {
  const created = await call(`models/${model}:batchGenerateContent`, {
    method: "POST",
    body: JSON.stringify({
      batch: {
        display_name: "nihongo-speak voices",
        input_config: {
          requests: { requests: items.map((i) => ({ request: request(i.text, i.voice), metadata: { key: i.key } })) },
        },
      },
    }),
  });
  type Batch = {
    done?: boolean;
    metadata?: { state?: string };
    response?: { inlinedResponses?: { inlinedResponses?: { response?: Reply; error?: unknown; metadata?: { key?: string } }[] } };
  };
  let batch: Batch = created;
  while (!batch.done) {
    await new Promise((r) => setTimeout(r, 30000));
    batch = await call(created.name);
  }
  if (batch.metadata?.state !== "BATCH_STATE_SUCCEEDED") throw new Error(`Gemini batch ended ${batch.metadata?.state}`);
  const voices = new Map(items.map((i) => [i.key, i.voice]));
  const out = new Map<string, Buffer>();
  for (const r of batch.response?.inlinedResponses?.inlinedResponses ?? []) {
    const key = r.metadata?.key;
    if (!key || !r.response) continue;
    try {
      out.set(key, await audio(r.response, voices.get(key) ?? ""));
    } catch (e) {
      console.error(String(e));
    }
  }
  return out;
}
