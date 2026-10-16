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

// HD voices aren't offered in Japan East, so they go through an optional second
// Speech resource (AZURE_TTS_KEY / AZURE_TTS_REGION, e.g. southeastasia, tier S0).
function hdConfig() {
  const key = process.env.AZURE_TTS_KEY;
  const region = process.env.AZURE_TTS_REGION;
  return key && region ? { key, region } : null;
}

const isHd = (name: string) => name.includes(":DragonHD");

// A voice is an Azure voice name, optionally followed by "@style".
function ssml(text: string, voice: string) {
  const [name, style] = voice.split("@");
  const body = style
    ? `<mstts:express-as style="${escapeXml(style)}">${escapeXml(text)}</mstts:express-as>`
    : escapeXml(text);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="ja-JP"><voice name="${escapeXml(name)}">${body}</voice></speak>`;
}

async function synthesizeWith(text: string, voice: string, { key, region }: { key: string; region: string }) {
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "nihongo-speak",
    },
    body: ssml(text, voice),
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status} for ${voice}: ${await res.text()}`);
  return res.arrayBuffer();
}

// voiceId lists voices to try in order, separated by "|". An HD voice is skipped
// when the HD resource isn't configured or fails (for example after the Azure
// trial credit runs out), so playback falls back to the free standard voice.
export async function synthesize(text: string, voiceId: string) {
  const voices = voiceId.split("|");
  const hd = hdConfig();
  for (const voice of voices.slice(0, -1)) {
    if (isHd(voice) && !hd) continue;
    try {
      return await synthesizeWith(text, voice, isHd(voice) ? hd! : config());
    } catch (e) {
      console.warn(e);
    }
  }
  const last = voices[voices.length - 1];
  return synthesizeWith(text, last, isHd(last) && hd ? hd : config());
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

type AzureResult = { RecognitionStatus: string; DisplayText?: string; NBest?: AzureNBest[] };

// Short-audio REST API: 16kHz mono PCM WAV, up to about 60 seconds.
async function stt(wav: ArrayBuffer, { key, region }: { key: string; region: string }, referenceText?: string) {
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
      // Mark words said beyond or missing from the reference instead of forcing the audio onto it.
      EnableMiscue: true,
    };
    headers["Pronunciation-Assessment"] = Buffer.from(JSON.stringify(params)).toString("base64");
  }
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ja-JP&format=detailed`;
  const res = await fetch(url, { method: "POST", headers, body: wav });
  if (!res.ok) throw new Error(`Azure STT ${res.status}: ${await res.text()}`);
  return (await res.json()) as AzureResult;
}

const displayOf = (d: AzureResult) => (d.RecognitionStatus === "Success" ? (d.NBest?.[0]?.Display ?? d.DisplayText ?? "") : "");

// With referenceText it also scores pronunciation against that sentence. The transcript then comes from a
// separate plain recognition: an assessment run reports the reference's words, not what was actually said,
// so a different answer used to look word-perfect. The plain run goes to the second (paid) resource when
// there is one, so the free resource isn't hit twice at once.
export async function recognize(wav: ArrayBuffer, referenceText?: string): Promise<RecognitionResult> {
  if (!referenceText) return { text: displayOf(await stt(wav, config())) };

  const [plain, assessed] = await Promise.allSettled([stt(wav, hdConfig() ?? config()), stt(wav, config(), referenceText)]);
  if (assessed.status === "rejected" && plain.status === "rejected") throw assessed.reason;
  const heard = plain.status === "fulfilled" ? displayOf(plain.value) : null;
  if (assessed.status === "rejected") {
    console.warn(assessed.reason);
    return { text: heard ?? "" };
  }
  const data = assessed.value;
  if (plain.status === "rejected") console.warn(plain.reason);
  const text = heard ?? displayOf(data);
  if (data.RecognitionStatus !== "Success") return { text };

  const best = data.NBest?.[0];
  if (!best) return { text };

  // Depending on API version the scores sit on the NBest item or under PronunciationAssessment.
  const pa = best.PronunciationAssessment ?? best;
  return {
    text,
    scores: {
      pron: Math.round(pa.PronScore ?? 0),
      accuracy: Math.round(pa.AccuracyScore ?? 0),
      fluency: Math.round(pa.FluencyScore ?? 0),
      completeness: Math.round(pa.CompletenessScore ?? 0),
      words: (best.Words ?? [])
        // Words the learner added aren't in the reference sentence the screen shows.
        .filter((w) => (w.PronunciationAssessment?.ErrorType ?? w.ErrorType) !== "Insertion")
        .map((w) => ({
          word: w.Word,
          accuracy: Math.round(w.PronunciationAssessment?.AccuracyScore ?? w.AccuracyScore ?? 0),
          errorType: w.PronunciationAssessment?.ErrorType ?? w.ErrorType ?? "None",
        })),
    },
  };
}

// One audio file from several voices and pauses, for the commute podcast. Standard voices only,
// so it runs on the free resource and the whole episode is a single file the phone can play locked.
export type Part = { voice: string; text?: string; pauseMs?: number };

export async function synthesizeParts(parts: Part[]) {
  const body = parts
    .map((p) => {
      const breaks: string[] = [];
      for (let ms = p.pauseMs ?? 0; ms > 0; ms -= 5000) breaks.push(`<break time="${Math.min(5000, ms)}ms"/>`);
      return `<voice name="${escapeXml(p.voice)}">${p.text ? escapeXml(p.text) : ""}${breaks.join("")}</voice>`;
    })
    .join("");
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">${body}</speak>`;
  const { key, region } = config();
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "nihongo-speak",
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}
