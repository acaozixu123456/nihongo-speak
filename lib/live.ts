import "server-only";
import type { Scenario } from "@/content/scenarios";
import { roleplaySystem, type Turn } from "@/lib/claude";
import { vertexAccess } from "@/lib/vertex-tts";

// One reply in a phone call from Gemini Live on Vertex AI (billed to the Google Cloud credit):
// it hears the learner's recording itself and answers in its own voice, with no separate speech
// recognition, Claude reply or TTS step. Each reply is a fresh session that is given the call so
// far as text; the connection stays on the server so the access token never reaches the browser.
const LOCATION = "us-central1";
const MODEL = "gemini-3.8-live";

export type LiveEvent =
  | { heard: string } // what the learner said, as Gemini understood it (grows as it streams in)
  | { said: string } // what Gemini is saying
  | { audio: string } // base64 16-bit mono PCM, 24 kHz
  | { done: true }
  | { error: string };

const PHONE_RULES = `

音声通話のルール：
- 必ず日本語だけで話す。
- 学習者はN4〜N3なので、やさしい言葉、短い文で、ふつうの速さより少しゆっくり話す。です・ます中心にして、ございます・かしこまりました・承知いたしました のような硬い敬語は多用しない。
- 1回の発話は1〜2文。`;

// The learner's line as 16 kHz mono 16-bit PCM.
export async function liveTurn(
  talk: Pick<Scenario, "talk">,
  voice: string,
  history: Turn[],
  pcm: Uint8Array,
  emit: (e: LiveEvent) => void,
  timeoutMs = 25000,
) {
  const { project, token } = await vertexAccess();
  const ws = new WebSocket(
    `wss://${LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent` +
      `?access_token=${encodeURIComponent(token)}`,
  );
  ws.binaryType = "arraybuffer";
  const send = (o: unknown) => ws.send(JSON.stringify(o));
  const text = (s: string) => s.replace(/\s+/g, "");

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Gemini Live timed out")), timeoutMs);
    let heard = "";
    let said = "";
    let ready = false;
    const finish = (err?: Error) => {
      clearTimeout(timer);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      if (err) reject(err);
      else resolve();
    };
    ws.onerror = () => finish(new Error("Gemini Live connection failed"));
    ws.onclose = (e) => finish(new Error(`Gemini Live closed ${e.code} ${e.reason}`.trim()));
    ws.onopen = () =>
      send({
        setup: {
          model: `projects/${project}/locations/${LOCATION}/publishers/google/models/${MODEL}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
          realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
          systemInstruction: { parts: [{ text: roleplaySystem(talk) + PHONE_RULES }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });
    ws.onmessage = (e) => {
      const raw = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer);
      const m = JSON.parse(raw);
      if (m.setupComplete && !ready) {
        ready = true;
        if (history.length) {
          send({
            clientContent: {
              turns: history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
              turnComplete: false,
            },
          });
        }
        // The recording is already one whole turn, so its start and end are marked by hand instead
        // of waiting for voice detection to hear a pause.
        send({ realtimeInput: { activityStart: {} } });
        for (let i = 0; i < pcm.length; i += 6400) {
          const data = Buffer.from(pcm.subarray(i, i + 6400)).toString("base64");
          send({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data } } });
        }
        send({ realtimeInput: { activityEnd: {} } });
        return;
      }
      const sc = m.serverContent;
      if (!sc) return;
      if (sc.inputTranscription?.text) emit({ heard: (heard += text(sc.inputTranscription.text)) });
      if (sc.outputTranscription?.text) emit({ said: (said += text(sc.outputTranscription.text)) });
      for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) emit({ audio: p.inlineData.data });
      if (sc.turnComplete) {
        ws.onclose = null;
        finish();
      }
    };
  });
}
