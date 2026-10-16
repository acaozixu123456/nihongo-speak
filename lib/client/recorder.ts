"use client";

// Records the microphone and hands back 16kHz mono 16-bit WAV, the format Azure's
// short-audio API expects.
//
// Capture uses MediaRecorder, not Web Audio. On iPhone a live AudioContext can only be
// started from the end of a tap, so a Web Audio recorder pressed and held stays silent
// until the finger lifts. MediaRecorder needs no gesture, and its compressed output is
// decoded and resampled afterwards with an OfflineAudioContext, which needs none either.

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

let live = false;
// True while the mic is open; playback leaves the audio session alone then.
export const isRecording = () => live;

export function setAudioSession(type: "play-and-record" | "playback") {
  const s = (navigator as AudioSessionNavigator).audioSession;
  if (s) s.type = type;
}

const RATE = 16000;

export class Recorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopped: Promise<void> = Promise.resolve();

  // Resolves once audio is actually being captured, so the caller can say "speak now".
  async start() {
    live = true;
    setAudioSession("play-and-record");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const rec = new MediaRecorder(this.stream);
      this.rec = rec;
      this.chunks = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      this.stopped = new Promise((resolve) => (rec.onstop = () => resolve()));
      await new Promise<void>((resolve, reject) => {
        rec.onstart = () => resolve();
        rec.onerror = () => reject(new Error("recorder failed"));
        rec.start();
      });
    } catch (e) {
      this.release();
      throw e;
    }
  }

  // The stream as it is being recorded, for a level meter.
  get input() {
    return this.stream;
  }

  async stop(): Promise<Blob> {
    const rec = this.rec;
    if (rec && rec.state !== "inactive") rec.stop();
    await this.stopped;
    const type = rec?.mimeType || this.chunks[0]?.type || "";
    const data = new Blob(this.chunks, { type });
    this.chunks = [];
    this.release();
    return encodeWav(await decode(data), RATE);
  }

  private release() {
    live = false;
    this.rec = null;
    // Releasing the mic puts iOS back into normal speaker playback.
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    setAudioSession("playback");
  }
}

// Decodes the recording straight to 16kHz mono; decoding into a 16kHz context resamples it.
async function decode(data: Blob): Promise<Float32Array> {
  if (!data.size) return new Float32Array(0);
  const bytes = await data.arrayBuffer();
  try {
    const buf = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes.slice(0));
    return buf.getChannelData(0);
  } catch {
    // Older Safari only decodes into 44.1/48kHz contexts.
    const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes);
    return downsample(buf.getChannelData(0), buf.sampleRate, RATE);
  }
}

function downsample(input: Float32Array, from: number, to: number) {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average the samples that fold into this one, a cheap low-pass filter.
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export type SttResult = {
  text: string;
  scores?: {
    pron: number;
    accuracy: number;
    fluency: number;
    completeness: number;
    words: { word: string; accuracy: number; errorType: string }[];
  };
  error?: string;
};

export async function transcribe(wav: Blob, referenceText?: string): Promise<SttResult> {
  const qs = referenceText ? `?${new URLSearchParams({ ref: referenceText })}` : "";
  const res = await fetch(`/api/stt${qs}`, { method: "POST", body: wav, headers: { "Content-Type": "audio/wav" } });
  const data = (await res.json()) as SttResult;
  if (!res.ok) throw new Error(data.error ?? "语音识别失败");
  return data;
}
