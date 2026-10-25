"use client";

import { encodeWav, wavBytes } from "./recorder";

// Listens alongside a recording, for 森先生: how long the learner has been quiet, whether they have said
// anything yet, and their last seconds as a WAV to send her. Not "any sound": a cough, a click or the
// room doesn't count as speaking (the old quiet hints vanished at any noise and the user found that
// distracting). Speech is a level well above the room's own, held for a quarter of a second.
// Runs on the shared Web Audio context, which on iPhone only runs when it was made inside a tap
// (renewAudio() in the tap that opens the mic). If it isn't running, quiet() stays 0 and she never
// comes on her own (a tap on her still works).
const KEEP_S = 16;
const OUT = 16000;
const SPEECH_S = 0.25;

export class Ears {
  private src: MediaStreamAudioSourceNode;
  private node: ScriptProcessorNode;
  private sink: GainNode;
  private ring: Float32Array;
  private pos = 0;
  private filled = 0;
  private floor = 0.004;
  private run = 0; // seconds of speech-level sound in a row
  private lastVoice = 0;
  private startedAt = Date.now();
  private alive = false;
  private total = 0; // samples heard so far
  private markAt = 0; // where the last phrase() ended
  // Said something (a real stretch of speech) since listening started; since the last phrase().
  spoke = false;
  fresh = false;

  constructor(stream: MediaStream, private ctx: AudioContext) {
    this.ring = new Float32Array(Math.ceil(ctx.sampleRate * KEEP_S));
    this.src = ctx.createMediaStreamSource(stream);
    this.node = ctx.createScriptProcessor(2048, 1, 1);
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.node.onaudioprocess = (e) => this.hear(e.inputBuffer.getChannelData(0));
    this.src.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(ctx.destination);
  }

  private hear(x: Float32Array) {
    this.alive = true;
    let e = 0;
    for (let i = 0; i < x.length; i++) {
      e += x[i] * x[i];
      this.ring[this.pos] = x[i];
      this.pos = (this.pos + 1) % this.ring.length;
    }
    this.filled = Math.min(this.ring.length, this.filled + x.length);
    this.total += x.length;
    const rms = Math.sqrt(e / x.length);
    const dur = x.length / this.ctx.sampleRate;
    if (rms > Math.max(0.012, this.floor * 3)) {
      this.run += dur;
      if (this.run >= SPEECH_S) {
        this.spoke = true;
        this.fresh = true;
        this.lastVoice = Date.now();
      }
    } else {
      this.run = 0;
      // The room's own level, followed slowly while nobody speaks.
      this.floor = this.floor * 0.97 + rms * 0.03;
    }
  }

  // Seconds since the learner last spoke (since listening started, before they have); 0 while not running.
  quiet() {
    if (!this.alive) return 0;
    return (Date.now() - (this.lastVoice || this.startedAt)) / 1000;
  }

  // The last `sec` seconds as 16 kHz WAV, base64; "" when there is hardly anything.
  clip(sec = 14): string {
    return this.last(Math.floor(sec * this.ctx.sampleRate));
  }

  // What was said since the last call (one phrase, cut at a short silence), to be written down while the
  // learner goes on: when they get stuck, only the last bit is left to write down.
  phrase(): string {
    const n = this.total - this.markAt;
    this.markAt = this.total;
    this.fresh = false;
    return this.last(n);
  }

  private last(want: number): string {
    const rate = this.ctx.sampleRate;
    const n = Math.min(this.filled, want);
    if (n < rate * 0.5) return "";
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = this.ring[(this.pos - n + i + this.ring.length) % this.ring.length];
    const ratio = rate / OUT;
    const out = new Float32Array(Math.floor(n / ratio));
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(n, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += raw[j];
      out[i] = s / Math.max(1, b - a);
    }
    const bytes = new Uint8Array(wavBytes(out, OUT));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  close() {
    this.node.onaudioprocess = null;
    try {
      this.src.disconnect();
      this.node.disconnect();
      this.sink.disconnect();
    } catch {}
  }
}

// Several recordings of one telling (the mic is shut while 森先生 speaks) joined into one 16 kHz WAV.
export async function joinWavs(wavs: Blob[]): Promise<Blob> {
  if (wavs.length === 1) return wavs[0];
  const parts = await Promise.all(wavs.map(async (w) => new Int16Array((await w.arrayBuffer()).slice(44))));
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) for (let i = 0; i < p.length; i++) all[at++] = p[i] / 0x8000;
  return encodeWav(all, OUT);
}
