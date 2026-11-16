import "server-only";
import { recognizeAzure, type RecognitionResult } from "@/lib/azure";
import { piece } from "@/lib/gemini-hear";

export type { RecognitionResult } from "@/lib/azure";

// Speech to text for every short recording (/api/stt, /api/say, /api/help). The Azure trial ended on
// 2026-11-16 (both keys answer 401), so Gemini on Vertex AI (Google Cloud credit) writes down what was
// said, word for word, as 三回話す already does. It gives the reading too, which the 型ドリル judge uses
// where Azure's pronunciation scores used to tell 分かります from わかります. No scores any more: every
// screen treats them as optional. Azure is still tried if Gemini fails, in case it is paid for again.
export async function recognize(wav: ArrayBuffer, referenceText?: string): Promise<RecognitionResult> {
  try {
    // A short answer comes back in 1-3 s; a try that hangs gets a second one alongside it after 5 s.
    const r = await piece(Buffer.from(wav).toString("base64"), "audio/wav", 20000, 5000);
    const text = r.text.trim();
    return text ? { text, kana: r.kana.trim() } : { text: "" };
  } catch (e) {
    console.warn("STT, Gemini failed:", e);
    return recognizeAzure(wav, referenceText);
  }
}
