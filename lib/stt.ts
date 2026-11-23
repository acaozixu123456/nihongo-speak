import "server-only";
import { recognizeAzure, type RecognitionResult } from "@/lib/azure";
import { piece } from "@/lib/gemini-hear";

export type { RecognitionResult } from "@/lib/azure";

// Speech to text for every short recording (/api/stt, /api/say, /api/help). The Azure trial ended on
// 2026-11-16 (both keys answer 401), so Gemini on Vertex AI (Google Cloud credit) writes down what was
// said, word for word, as 三回話す already does. It gives the reading too, which the 型ドリル judge uses
// where Azure's pronunciation scores used to tell 分かります from わかります. No scores any more: every
// screen treats them as optional. Azure is still tried if Gemini fails, in case it is paid for again.
export async function recognize(wav: ArrayBuffer, referenceText?: string): Promise<RecognitionResult & { ms?: number }> {
  // Gemini makes up a whole sentence from silence or room noise (2 s of quiet came back as
  // おばあさんと二人で住んでいます), so a recording with no voice in it isn't sent at all.
  if (!voiced(wav)) return { text: "" };
  const t0 = Date.now();
  try {
    // A short answer comes back in a few seconds; a try that hangs gets a second one alongside it.
    // Room for the words and their reading at a fast talker's pace, and no more: an answer that runs
    // away is cut in a couple of seconds and tried again, not left until the timeout.
    const seconds = Math.max(0, wav.byteLength - 44) / 2 / (new DataView(wav).getUint32(24, true) || 16000);
    const r = await piece(Buffer.from(wav).toString("base64"), "audio/wav", 15000, 4000, Math.min(3000, Math.round(400 + seconds * 50)));
    const text = r.text.trim();
    return { text, ...(text && { kana: r.kana.trim() }), ms: Date.now() - t0 };
  } catch (e) {
    console.warn("STT, Gemini failed:", e);
    return recognizeAzure(wav, referenceText);
  }
}

// 16-bit mono WAV (lib/client/recorder.ts encodeWav): at least 0.15 s of 30 ms frames louder than
// -38 dBFS. Speech into a phone sits around -25 to -15; a quiet room well under -45.
function voiced(wav: ArrayBuffer) {
  const pcm = new Int16Array(wav, 44, Math.floor((wav.byteLength - 44) / 2));
  const rate = new DataView(wav).getUint32(24, true) || 16000;
  const frame = Math.round(rate * 0.03);
  const need = Math.ceil(0.15 / 0.03);
  const floor = 0.012 * 32768;
  let loud = 0;
  for (let i = 0; i + frame <= pcm.length; i += frame) {
    let e = 0;
    for (let j = i; j < i + frame; j++) e += pcm[j] * pcm[j];
    if (Math.sqrt(e / frame) > floor && ++loud >= need) return true;
  }
  return false;
}
