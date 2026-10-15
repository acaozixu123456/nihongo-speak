import "server-only";

function config() {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || "japaneast";
  if (!key) throw new Error("AZURE_SPEECH_KEY is not set");
  return { key, region };
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

// A voice id is an Azure voice name, optionally followed by "@style".
function ssml(text: string, voiceId: string) {
  const [name, style] = voiceId.split("@");
  const body = style
    ? `<mstts:express-as style="${escapeXml(style)}">${escapeXml(text)}</mstts:express-as>`
    : escapeXml(text);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="ja-JP"><voice name="${escapeXml(name)}">${body}</voice></speak>`;
}

export async function synthesize(text: string, voiceId: string) {
  const { key, region } = config();
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "nihongo-speak",
    },
    body: ssml(text, voiceId),
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status} for ${voiceId}: ${await res.text()}`);
  return res.arrayBuffer();
}

export type WordScore = { word: string; accuracy: number; errorType: string };

export type RecognitionResult = {
  text: string;
  scores?: {
    pron: number;
    accuracy: number;
    fluency: number;
    completeness: number;
    words: WordScore[];
  };
};

type AzureWord = {
  Word: string;
  AccuracyScore?: number;
  ErrorType?: string;
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
};

type AzureNBest = {
  Display?: string;
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  PronScore?: number;
  PronunciationAssessment?: {
    AccuracyScore?: number;
    FluencyScore?: number;
    CompletenessScore?: number;
    PronScore?: number;
  };
  Words?: AzureWord[];
};

// Short-audio REST API: 16kHz mono PCM WAV, up to about 60 seconds.
// With referenceText it also runs pronunciation assessment against that sentence.
export async function recognize(wav: ArrayBuffer, referenceText?: string): Promise<RecognitionResult> {
  const { key, region } = config();
  const headers: Record<string, string> = {
    "Ocp-Apim-Subscription-Key": key,
    "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
    Accept: "application/json",
  };
  if (referenceText) {
    const params = {
      ReferenceText: referenceText,
      GradingSystem: "HundredMark",
      Granularity: "Word",
      Dimension: "Comprehensive",
    };
    headers["Pronunciation-Assessment"] = Buffer.from(JSON.stringify(params)).toString("base64");
  }
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ja-JP&format=detailed`;
  const res = await fetch(url, { method: "POST", headers, body: wav });
  if (!res.ok) throw new Error(`Azure STT ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { RecognitionStatus: string; DisplayText?: string; NBest?: AzureNBest[] };
  if (data.RecognitionStatus !== "Success") return { text: "" };

  const best = data.NBest?.[0];
  const text = best?.Display ?? data.DisplayText ?? "";
  if (!referenceText || !best) return { text };

  // Depending on API version the scores sit on the NBest item or under PronunciationAssessment.
  const pa = best.PronunciationAssessment ?? best;
  return {
    text,
    scores: {
      pron: Math.round(pa.PronScore ?? 0),
      accuracy: Math.round(pa.AccuracyScore ?? 0),
      fluency: Math.round(pa.FluencyScore ?? 0),
      completeness: Math.round(pa.CompletenessScore ?? 0),
      words: (best.Words ?? []).map((w) => ({
        word: w.Word,
        accuracy: Math.round(w.PronunciationAssessment?.AccuracyScore ?? w.AccuracyScore ?? 0),
        errorType: w.PronunciationAssessment?.ErrorType ?? w.ErrorType ?? "None",
      })),
    },
  };
}
