import type { Scenario } from "@/content/scenarios";
import type { Turn } from "@/lib/claude";
import { geminiVoice } from "@/lib/gemini-tts";
import { liveTurn, type LiveEvent } from "@/lib/live";
import { resolveTalk } from "@/lib/talk";
import { vertexConfigured } from "@/lib/vertex-tts";

// Up to 25s before the answer starts, then as long as it takes to say it (it streams in real time).
export const maxDuration = 90;

type Body = { scenarioId: string; talk?: Scenario["talk"]; history: Turn[]; audio: string };

// A phone-call reply from Gemini Live (lib/live.ts), streamed back as one JSON event per line
// so the phone can start playing before the whole answer is in. On an error line with no audio,
// the call falls back to speech recognition + Claude + TTS.
export async function POST(request: Request) {
  if (!vertexConfigured()) return Response.json({ error: "not configured" }, { status: 503 });
  const body = (await request.json()) as Body;
  const scenario = resolveTalk(body);
  const voice = scenario && geminiVoice(scenario.talk.aiVoice);
  if (!scenario || !voice) return Response.json({ error: "unknown scenario" }, { status: 404 });
  const pcm = Buffer.from(body.audio ?? "", "base64");
  if (pcm.length < 3200 || pcm.length > 2_000_000) return Response.json({ error: "bad audio" }, { status: 400 });
  const history = (body.history ?? []).slice(-30);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: LiveEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await liveTurn(scenario, voice, history, pcm, emit);
        emit({ done: true });
      } catch (e) {
        console.error(e);
        emit({ error: e instanceof Error ? e.message : "live failed" });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
