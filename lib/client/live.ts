"use client";

import { play } from "./player";

// Phone-call replies from Gemini Live (/api/live). The answer streams in as raw 24 kHz PCM and
// is played through Web Audio as it arrives, so the other side starts talking before it has
// finished thinking. iPhone only runs an AudioContext started from a tap (unlockLive, called when
// the call is picked up); when it isn't running, the whole answer plays through the shared
// <audio> element once it is in.
const OUT_RATE = 24000;

let ctx: AudioContext | null = null;
let sources: AudioBufferSourceNode[] = [];

export function unlockLive() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function stopLive() {
  for (const s of sources) {
    try {
      s.stop();
    } catch {}
  }
  sources = [];
}

export type LiveReply = { heard: string; said: string; audio: Blob; played: Promise<void> };

type Event = { heard?: string; said?: string; audio?: string; done?: true; error?: string };

// The recording is the 16 kHz WAV the recorder makes; its 44-byte header is dropped.
export async function liveReply(
  body: { scenarioId: string; talk: unknown; history: { role: string; text: string }[] },
  wav: Blob,
  onStart: () => void, // the first sound of the answer is in
): Promise<LiveReply> {
  const pcm = new Uint8Array(await wav.arrayBuffer()).subarray(44);
  const res = await fetch("/api/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, audio: base64(pcm) }),
  });
  if (!res.ok || !res.body) throw new Error(`live ${res.status}`);

  stopLive();
  const live = ctx?.state === "running" ? ctx : null;
  let at = 0;
  const chunks: Int16Array[] = [];
  let heard = "";
  let said = "";
  let error = "";
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += value;
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const e = JSON.parse(line) as Event;
      if (e.heard) heard = e.heard;
      if (e.said) said = e.said;
      if (e.error) error = e.error;
      if (e.audio) {
        const samples = int16(e.audio);
        if (!chunks.length) onStart();
        chunks.push(samples);
        if (live) at = schedule(live, samples, at);
      }
    }
  }
  if (!chunks.length) throw new Error(error || "对方没有回答");

  const audio = wavBlob(chunks);
  const played = live
    ? new Promise<void>((resolve) => {
        const last = sources[sources.length - 1];
        if (!last) return resolve();
        last.onended = () => resolve();
      })
    : play(URL.createObjectURL(audio), 1);
  return { heard, said, audio, played };
}

function schedule(c: AudioContext, samples: Int16Array, at: number) {
  const buf = c.createBuffer(1, samples.length, OUT_RATE);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 0x8000;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  const start = Math.max(at, c.currentTime + 0.05);
  src.start(start);
  sources.push(src);
  return start + buf.duration;
}

function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function int16(b64: string) {
  const bin = atob(b64);
  const out = new Int16Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16;
  return out;
}

function wavBlob(chunks: Int16Array[]) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, OUT_RATE, true);
  v.setUint32(28, OUT_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks) for (const s of c) (v.setInt16(o, s, true), (o += 2));
  return new Blob([buf], { type: "audio/wav" });
}
