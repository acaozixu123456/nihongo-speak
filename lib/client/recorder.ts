"use client";

// Records the microphone as 16kHz mono 16-bit WAV, the format Azure's
// short-audio API expects. iPhone's MediaRecorder only produces mp4/aac,
// so this captures raw samples with Web Audio instead.

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

let live = false;
// True while the mic is open; playback leaves the audio session alone then.
export const isRecording = () => live;

export function setAudioSession(type: "play-and-record" | "playback") {
  const s = (navigator as AudioSessionNavigator).audioSession;
  if (s) s.type = type;
}

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];

  async start() {
    live = true;
    setAudioSession("play-and-record");
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = this.ctx ?? new Ctx();
    // Must happen inside the tap; awaiting getUserMedia first would lose the gesture.
    const resumed = this.ctx.resume();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      live = false;
      setAudioSession("playback");
      throw e;
    }
    await resumed;
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = (e) => {
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  stop(): Blob {
    live = false;
    this.node?.disconnect();
    this.node = null;
    // Releasing the mic puts iOS back into normal speaker playback.
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    setAudioSession("playback");
    const rate = this.ctx?.sampleRate ?? 48000;
    return encodeWav(downsample(concat(this.chunks), rate, 16000), 16000);
  }
}

function concat(chunks: Float32Array[]) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
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
