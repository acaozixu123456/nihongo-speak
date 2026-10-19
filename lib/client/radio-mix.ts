"use client";

import type { RadioEpisode } from "@/lib/progress-model";
import { ttsUrl } from "./player";
import { fetchAudio, radioClips, type Clip, type ClipState, type Part, type RadioPart } from "./moyu";

// 趣味电台 on its own page, mixed like a radio show instead of joined end to end: the station
// jingle and the title call, background music under the talk, a chime before お便り and 本題,
// replies that cut in or wait a beat, the other host's quiet うんうん, and the episode's 洗脑歌 to
// close. Everything is decoded and mixed on the phone into one MP3, so it plays on with the
// screen locked. Older episodes (no corners) come out as before, minus the music.

const SR = 24000;

export type Chapter = { part: RadioPart; at: number };
// starts / ends: when each clip's voice begins and stops, in seconds.
export type Mixed = { clips: Clip[]; url: string; starts: number[]; ends: number[]; total: number; chapters: Chapter[] };

let ctx: OfflineAudioContext | null = null;
async function decode(buf: ArrayBuffer): Promise<Float32Array> {
  ctx ??= new OfflineAudioContext(1, 1, SR);
  const b = await ctx.decodeAudioData(buf.slice(0));
  return b.getChannelData(0).slice();
}

// TTS clips carry some silence at both ends; the gaps between lines are set here instead.
function trim(x: Float32Array) {
  let a = 0;
  let b = x.length - 1;
  while (a < b && Math.abs(x[a]) < 0.01) a++;
  while (b > a && Math.abs(x[b]) < 0.01) b--;
  return x.subarray(Math.max(0, a - 300), Math.min(x.length, b + 900));
}

const rms = (x: Float32Array) => {
  let s = 0;
  for (let i = 0; i < x.length; i += 4) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length / 4)) || 1;
};

async function music(url: string): Promise<Float32Array | null> {
  try {
    return await decode((await fetchAudio(url)).buf);
  } catch {
    return null;
  }
}

// The episode's 洗脑歌, if it has been made by now.
async function song(id: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(`/api/earworm?id=${encodeURIComponent(id)}`);
    const job = (await res.json()).job as { step?: string; version?: number } | null;
    if (job?.step !== "ready") return null;
    return music(`/api/earworm/${id}/song.mp3?v=${job.version ?? 1}`);
  } catch {
    return null;
  }
}

class Track {
  buf = new Float32Array(SR * 600);
  end = 0;
  put(x: Float32Array, at: number, gain = 1, fadeIn = 0, fadeOut = 0) {
    const s = Math.max(0, Math.round(at * SR));
    if (s + x.length > this.buf.length) {
      const bigger = new Float32Array(Math.ceil((s + x.length) * 1.5));
      bigger.set(this.buf);
      this.buf = bigger;
    }
    const fi = fadeIn * SR;
    const fo = fadeOut * SR;
    for (let i = 0; i < x.length; i++) {
      let g = gain;
      if (i < fi) g *= i / fi;
      if (x.length - i < fo) g *= (x.length - i) / fo;
      this.buf[s + i] += x[i] * g;
    }
    this.end = Math.max(this.end, at + x.length / SR);
    return at + x.length / SR;
  }
}

async function mp3(x: Float32Array): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const enc = new Mp3Encoder(1, SR, 64);
  const parts: BlobPart[] = [];
  const add = (b: ArrayBufferView) => b.byteLength && parts.push(new Uint8Array(b.buffer, b.byteOffset, b.byteLength).slice());
  const step = 1152 * 20;
  const pcm = new Int16Array(step);
  for (let i = 0; i < x.length; i += step) {
    const n = Math.min(step, x.length - i);
    for (let j = 0; j < n; j++) pcm[j] = Math.max(-1, Math.min(1, x[i + j])) * 32767;
    add(enc.encodeBuffer(pcm.subarray(0, n)));
    // Let the page breathe: a long episode takes a moment to encode.
    if ((i / step) % 40 === 39) await new Promise((r) => setTimeout(r, 0));
  }
  add(enc.flush());
  return new Blob(parts, { type: "audio/mpeg" });
}

export async function mixRadio(ep: RadioEpisode, onProgress?: (i: number, s: ClipState) => void): Promise<Mixed> {
  const show = !!ep.hitokoto; // made since the makeover
  const clips = radioClips(ep, false);

  // Every voice part, a few at a time, as in 摸鱼模式.
  const voice = new Map<string, Float32Array | null>();
  const keyOf = (p: Part) => `${p.voice}|${p.text}`;
  const ok: boolean[] = clips.map(() => false);
  let next = 0;
  const worker = async () => {
    while (next < clips.length) {
      const i = next++;
      const c = clips[i];
      const report = (s: ClipState) => onProgress?.(i, s);
      report({ at: "work" });
      let fallback = false;
      try {
        for (const p of [...c.parts, c.back, c.with]) {
          if (!p?.text || voice.has(keyOf(p))) continue;
          try {
            const got = await fetchAudio(ttsUrl(p.text, p.voice), report);
            if (got.fallback && p.voice.startsWith("ja-")) fallback = true;
            voice.set(keyOf(p), trim(await decode(got.buf)));
          } catch (e) {
            // An aizuchi that didn't come is just left out; the line itself is not.
            if (p !== c.back && p !== c.with) throw e;
            voice.set(keyOf(p), null);
          }
        }
        ok[i] = true;
        report({ at: "done", fallback });
      } catch (e) {
        console.warn(e);
        report({ at: "fail" });
      }
    }
  };
  const [jingle, bed, letterBell, mainBell, sung] = await Promise.all([
    show ? music("/api/radio-music/jingle") : null,
    show ? music("/api/radio-music/bed").then((b) => b ?? music("/radio/bed.mp3")) : null,
    show ? music("/radio/letter.mp3") : null,
    show ? music("/radio/main.mp3") : null,
    show ? song(ep.id) : null,
    Promise.all([worker(), worker(), worker(), worker()]),
  ]);
  if (!ok.some(Boolean)) throw new Error("音频生成失败，检查一下网络");

  const t = new Track();
  const kept: Clip[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const chapters: Chapter[] = [];
  let cursor = 0;
  if (jingle) {
    const j = jingle.subarray(0, Math.min(jingle.length, SR * 6.5));
    t.put(j, 0, 0.9, 0, 1.5);
    cursor = j.length / SR - 1.8;
  }
  let part: RadioPart | undefined;
  let bedFrom = -1;
  let bedTo = 0;
  clips.forEach((c, i) => {
    if (!ok[i]) return;
    let gap = c.gap ?? 0;
    if (c.part && c.part !== part) {
      const bell = c.part === "letter" ? letterBell : c.part === "main" ? mainBell : null;
      if (bell) {
        t.put(bell, cursor + 0.4, 0.8);
        cursor += 1.4;
        gap = 0;
      }
      part = c.part;
      chapters.push({ part: c.part, at: Math.max(0, cursor + gap) });
    }
    // The talk starts after the title call: the music comes in under it.
    if (show && bedFrom < 0 && c.line) bedFrom = cursor;
    const start = Math.max(starts.length ? starts[starts.length - 1] + 0.1 : 0, cursor + gap);
    kept.push(c);
    starts.push(start);
    let at = start;
    let last = 0;
    for (const p of c.parts) {
      const x = p.text ? voice.get(keyOf(p)) : null;
      if (x) at = t.put(x, at);
      last = (p.pauseMs ?? 0) / 1000;
      at += last;
    }
    ends.push(at - last);
    // A show line's own gap stands in for the pause after it.
    cursor = c.gap !== undefined ? at - last : at;
    const w = c.with && voice.get(keyOf(c.with));
    if (w) t.put(w, start + 0.03, 0.85);
    const b = c.back && voice.get(keyOf(c.back));
    const said = c.parts[0]?.text && voice.get(keyOf(c.parts[0]));
    if (b && said) t.put(b, start + (said.length / SR) * 0.5, 0.5);
    bedTo = cursor;
  });

  if (bed && bedFrom >= 0) {
    // About 16 dB under the voices, looped from the first words after the title call to the end.
    const len = bedTo + 1.5 - (bedFrom - 0.8);
    const loop = new Float32Array(Math.ceil(len * SR));
    for (let i = 0; i < loop.length; i += bed.length) loop.set(bed.subarray(0, Math.min(bed.length, loop.length - i)), i);
    t.put(loop, bedFrom - 0.8, 0.016 / rms(bed), 1.5, 2.5);
  }

  if (sung) {
    // The start of the 洗脑歌 to close the show.
    cursor += 1.2;
    const s = sung.subarray(0, Math.min(sung.length, SR * 26));
    chapters.push({ part: "song", at: cursor });
    kept.push({ block: "radio", show: "♪ 这期的洗脑歌", parts: [], part: "song" });
    starts.push(cursor);
    cursor = t.put(s, cursor, 0.8, 0, 3);
    ends.push(cursor);
  }

  const total = Math.max(t.end, cursor) + 0.4;
  const out = t.buf.subarray(0, Math.ceil(total * SR));
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak;
  return { clips: kept, url: URL.createObjectURL(await mp3(out)), starts, ends, total, chapters };
}
