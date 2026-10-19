import "server-only";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { vertexAccess } from "@/lib/vertex-tts";

// ゆるっと日本ラジオ's own music (a station jingle and a background loop for the talk) and the
// 三回話す pause music, made once by Lyria 3 Pro (about 8 cents each, from the Google Cloud credit) and kept in Blob for good.

export const MUSIC = {
  jingle:
    "A short bright instrumental radio station jingle for a cheerful Japanese morning talk show. Japanese city pop, bouncy slap bass, clean electric piano, tight drums, brass stab, a catchy 4-note melodic hook, ends after about 6 seconds on a clear final chord and then silence. No vocals.",
  bed:
    "A calm, warm instrumental lo-fi city pop loop to play quietly under two people talking on a radio show. Soft Rhodes electric piano chords, mellow round bass, light brushed drums, 84 BPM, steady from start to end, no lead melody, no build-ups, no breaks, no vocals.",
  // Under the ~18s wait between two tellings of 三回話す (lib/client/bgm.ts). Made for a resting
  // mind: slow (about 60 BPM, near a resting heartbeat), soft, wordless, without a melody to follow
  // or anything sudden, so it settles the learner without pulling attention from the Japanese.
  pause:
    "A calm, gentle ambient instrumental piece to relax the mind during a short rest. Soft felt piano playing slow, sparse, sustained major-key chords over a warm, airy synth pad, about 60 BPM, lots of space between notes, no drums, no beat, no bass line, no lead melody, no vocals, no build-ups, no sudden changes, the same soft level from start to end.",
} as const;
export type Music = keyof typeof MUSIC;

const path = (kind: Music) => `radio/${kind}.mp3`;

export async function readMusic(kind: Music) {
  const res = await get(path(kind), { access: "private", useCache: false }).catch((e: unknown) => {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  });
  if (!res || res.statusCode !== 200) return null;
  return Buffer.from(await new Response(res.stream).arrayBuffer());
}

export async function makeMusic(kind: Music) {
  const { project, token } = await vertexAccess();
  const res = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/lyria-3-pro-preview:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: MUSIC[kind] }] }],
        generationConfig: { responseModalities: ["AUDIO", "TEXT"] },
      }),
      signal: AbortSignal.timeout(110000),
    },
  );
  if (!res.ok) throw new Error(`Lyria ${res.status}: ${(await res.text()).slice(0, 300)}`);
  type Part = { inlineData?: { data: string } };
  const reply = (await res.json()) as { candidates?: { content?: { parts?: Part[] } }[] };
  const data = reply.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (!data) throw new Error("Lyria 没有返回音乐");
  const mp3 = Buffer.from(data, "base64");
  await put(path(kind), mp3, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "audio/mpeg" });
  return mp3;
}
