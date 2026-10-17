"use client";

import type { Podcast as Episode } from "@/lib/claude";
import type { Radio } from "@/lib/radio";
import { listenIntro, NARRATION, ZH_VOICE } from "@/content/narration";
import { ttsUrl } from "./player";
import {
  allScenarios,
  dayKey,
  dueCards,
  quickRound,
  RADIO_VOICE,
  saveEpisode,
  weakList,
  type RadioEpisode,
  type Progress,
  type StuckLine,
} from "./progress";

// 摸鱼模式: listen-only practice for when the learner can't speak (at work, on the train).
// Each round is about ten minutes of short clips. Every clip is synthesized once, cached on the
// phone, and the round's clips are joined into one MP3 so playback carries on with the screen locked.

export type Block = "radio" | "listen" | "quick" | "review" | "fix" | "podcast";
export const BLOCK_LABEL: Record<Block, string> = {
  radio: "趣味电台",
  listen: "偷听",
  quick: "心里瞬间说",
  review: "复习收藏",
  fix: "错句对比",
  podcast: "今天的播客",
};

export type Part = { voice: string; text?: string; pauseMs?: number };
export type Clip = {
  block: Block;
  show: string; // the line on screen and on the lock screen
  sub?: string;
  line?: StuckLine; // what "再听一遍" keeps for saying out loud later
  parts: Part[];
};

const ZH = ZH_VOICE;
const JA = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";
// Time to say the sentence in your head before the answer.
export const THINK_MS = 4000;

const zh = (text: string, pauseMs = 300): Part => ({ voice: ZH, text, pauseMs });

function withIntro(clips: Clip[], intro: string): Clip[] {
  if (!clips.length) return clips;
  const [first, ...rest] = clips;
  return [{ ...first, parts: [zh(intro, 600), ...first.parts] }, ...rest];
}

function quickClips(p: Progress, n: number, used: Set<string>): Clip[] {
  let pick = quickRound(p, 40).filter((i) => !used.has(i.ja));
  if (pick.length < n) {
    // Everything has been heard this session: start over.
    used.clear();
    pick = quickRound(p, 40);
  }
  return withIntro(
    pick.slice(0, n).map((i) => {
      used.add(i.ja);
      return {
        block: "quick",
        show: i.zh,
        sub: i.where,
        line: { ja: i.ja, reading: i.reading, zh: i.zh, voice: i.voice },
        parts: [zh(i.zh, THINK_MS), { voice: i.voice, text: i.ja, pauseMs: 900 }, { voice: i.voice, text: i.ja, pauseMs: 1500 }],
      };
    }),
    NARRATION.quick,
  );
}

function reviewClips(p: Progress, n: number, used: Set<string>): Clip[] {
  const cards = dueCards(p).filter((c) => !used.has(`card:${c.id}`)).slice(0, n);
  return withIntro(
    cards.map((c) => {
      used.add(`card:${c.id}`);
      return {
        block: "review",
        show: c.ja,
        sub: c.zh,
        line: { ja: c.ja, reading: c.reading, zh: c.zh, voice: c.voice },
        parts: [{ voice: c.voice, text: c.ja, pauseMs: 700 }, zh(c.zh, 700), { voice: c.voice, text: c.ja, pauseMs: 1500 }],
      };
    }),
    NARRATION.review,
  );
}

function fixClips(p: Progress, r: number): Clip[] {
  const weak = weakList(p).filter((w) => w.examples.length);
  if (!weak.length) return [];
  const w = weak[r % weak.length];
  const e = w.examples[Math.floor(r / weak.length) % w.examples.length];
  return withIntro(
    [
      {
        block: "fix",
        show: e.better,
        sub: `${w.tag} · ${w.zh}`,
        line: { ja: e.better, zh: w.zh, voice: JA },
        parts: [
          zh(NARRATION.said),
          { voice: "ja-JP-NanamiNeural", text: e.said, pauseMs: 800 },
          zh(NARRATION.better),
          { voice: JA, text: e.better, pauseMs: 900 },
          { voice: JA, text: e.better, pauseMs: 900 },
          zh(w.zh, 1500),
        ],
      },
    ],
    `你说错过的句子：${w.tag}。`,
  );
}

function listenClips(p: Progress, r: number): Clip[] {
  const touched = (id: string) => !!p.scenarios[id];
  const list = [...allScenarios(p)].sort((a, b) => Number(touched(b.id)) - Number(touched(a.id)));
  if (!list.length) return [];
  const s = list[r % list.length];
  const whole: Clip = {
    block: "listen",
    show: s.titleZh,
    sub: "先听一遍整段",
    parts: [zh(listenIntro(s.titleZh), 600), ...s.lines.map((l) => ({ voice: l.voice, text: l.ja, pauseMs: 500 })), { voice: ZH, pauseMs: 1000 }],
  };
  const lines: Clip[] = s.lines.map((l) => ({
    block: "listen",
    show: l.ja,
    sub: `${l.speaker} · ${l.zh}`,
    line: { ja: l.ja, reading: l.kana, zh: l.zh, voice: l.voice },
    parts: [{ voice: l.voice, text: l.ja, pauseMs: 600 }, zh(l.zh, 1200)],
  }));
  return [whole, ...withIntro(lines, NARRATION.lines)];
}

// The day's podcast, cut where the Chinese narration starts each new point.
function podcastClips(ep: Episode): Clip[] {
  const clips: Clip[] = [];
  for (const s of ep.segments) {
    if (s.kind === "zh" || !clips.length) clips.push({ block: "podcast", show: ep.title_zh, parts: [] });
    const c = clips[clips.length - 1];
    if (s.kind === "zh") {
      c.sub = s.text;
      c.parts.push(zh(s.text, 400));
    } else {
      c.show = s.text;
      c.sub = s.zh;
      c.line = { ja: s.text, zh: s.zh, voice: JA };
      if (s.kind === "ja") c.parts.push({ voice: JA, text: s.text, pauseMs: 700 });
      // Long enough to say it back in your head: about a third of a second per character, plus a beat.
      else c.parts.push({ voice: JA, text: s.text, pauseMs: Math.min(8000, 1200 + s.text.length * 330) }, { voice: JA, text: s.text, pauseMs: 900 });
    }
  }
  return withIntro(clips.filter((c) => c.parts.length), `今天的播客：${ep.title_zh}。`);
}

const HOST = RADIO_VOICE;

// The hook in Chinese, the chat straight through in Japanese (each line its own clip, so "再听"
// lands on it), then three phrases to keep and a question to think about.
export function radioClips(ep: Radio): Clip[] {
  // Stage directions like （笑） would be read out loud.
  const say = (ja: string) => ja.replace(/[（(][^）)]*[）)]/g, "").replace(/〜/g, "").trim();
  const talk: Clip[] = ep.lines.filter((l) => say(l.ja)).map((l, i) => ({
    block: "radio",
    show: l.ja,
    sub: `${l.who === "A" ? "ハル" : "ケン"} · ${l.zh}`,
    line: { ja: l.ja, zh: l.zh, voice: HOST[l.who] },
    parts: [...(i ? [] : [zh(`趣味电台：${ep.title_zh}`, 500), zh(ep.hook_zh, 900)]), { voice: HOST[l.who], text: say(l.ja), pauseMs: 350 }],
  }));
  const keep: Clip[] = ep.phrases.map((ph, i) => ({
    block: "radio",
    show: ph.ja,
    sub: ph.zh,
    line: { ja: ph.ja, zh: ph.zh, voice: HOST.A },
    parts: [
      ...(i ? [] : [zh(NARRATION.radioKeep, 600)]),
      { voice: HOST.A, text: say(ph.ja), pauseMs: 700 },
      zh(ph.zh, 700),
      { voice: HOST.A, text: say(ph.ja), pauseMs: 1500 },
    ],
  }));
  const quiz: Clip = { block: "radio", show: ep.title_zh, sub: ep.quiz_zh, parts: [zh(ep.quiz_zh, 2500)] };
  return [...talk, ...keep, quiz];
}

// Round 0 is short so playback starts quickly; later rounds open with a 趣味电台 episode when one is
// ready, then add a scene to overhear and, once, the podcast.
export function buildRound(p: Progress, r: number, used: Set<string>, episode: Episode | null, radio: Radio | null = null): Clip[] {
  if (r === 0) return [...quickClips(p, 5, used), ...reviewClips(p, 3, used), ...fixClips(p, 0)];
  return [
    ...(radio ? radioClips(radio) : []),
    ...listenClips(p, r - 1),
    ...quickClips(p, 6, used),
    ...reviewClips(p, 4, used),
    ...fixClips(p, r),
    ...(episode ? podcastClips(episode) : []),
  ];
}

// ---- Podcast script (Haiku), one a day ----

const EPISODE_KEY = "nihongo-speak:podcast";
type SavedEpisode = Episode & { day: string };

export function todayEpisode(): Episode | null {
  try {
    const raw = localStorage.getItem(EPISODE_KEY);
    const ep = raw ? (JSON.parse(raw) as SavedEpisode) : null;
    return ep?.day === dayKey() ? ep : null;
  } catch {
    return null;
  }
}

export async function makeEpisode(p: Progress): Promise<Episode> {
  const weak = weakList(p).slice(0, 3).map((w) => ({ tag: w.tag, zh: w.zh, examples: w.examples.slice(0, 2) }));
  const cards = [...dueCards(p), ...p.cards].slice(0, 8).map((c) => ({ ja: c.ja, zh: c.zh }));
  const scenes = allScenarios(p).slice(0, 6).map((s) => s.titleZh);
  const res = await fetch("/api/podcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "script", weak, cards, scenes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "生成失败");
  try {
    localStorage.setItem(EPISODE_KEY, JSON.stringify({ ...data, day: dayKey() }));
  } catch {}
  return data as Episode;
}

// ---- 趣味电台 script, a new one each round ----

const RADIO_SEEN_KEY = "nihongo-speak:radio-seen";

// The new episode is saved with its notes (see saveEpisode), so it can be looked back on in 听.
export async function makeRadio(): Promise<RadioEpisode> {
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(RADIO_SEEN_KEY) ?? "[]");
  } catch {}
  const res = await fetch("/api/podcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "radio", avoid: seen.slice(-30) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "生成失败");
  try {
    localStorage.setItem(RADIO_SEEN_KEY, JSON.stringify([...seen, data.title_zh].slice(-30)));
  } catch {}
  return saveEpisode(data as Radio);
}

// ---- Audio ----

// Each part is played from its own recording (pre-made ones ship with the site, see ttsUrl), so a
// sentence is only synthesized once however many clips it turns up in.
// v2: v1 kept lines that had fallen back to Azure's flatter voice forever.
const CACHE = "nihongo-speak-moyu-v2";
const MAX_CACHED = 600;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAudio(url: string): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
  } catch {}
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      // The server marks a fallback voice no-store: ask again next time instead of keeping it.
      const keep = !res.headers.get("cache-control")?.includes("no-store");
      if (cache && keep) await cache.put(url, new Response(buf, { headers: { "Content-Type": "audio/mpeg" } })).catch(() => {});
      return buf;
    } catch (e) {
      if (attempt >= 2) throw e;
      await wait(attempt ? 6000 : 2500);
    }
  }
}

// A silent frame in Azure's format (MPEG-2 layer III, 24 kHz, 48 kbit/s, mono): a header and an
// all-zero body, which decodes to 24 ms of silence and doesn't lean on the frames before it.
const QUIET = new Uint8Array(144);
QUIET.set([0xff, 0xf3, 0x64, 0xc4]);
const QUIET_SEC = 576 / 24000;

const pause = (ms: number): Frames => {
  const n = Math.round(ms / 1000 / QUIET_SEC);
  return { chunks: new Array(n).fill(QUIET), sec: n * QUIET_SEC };
};

async function clipAudio(parts: Part[]): Promise<Frames> {
  const out: Frames = { chunks: [], sec: 0 };
  for (const p of parts) {
    for (const a of [p.text ? mp3Frames(await fetchAudio(ttsUrl(p.text, p.voice))) : null, p.pauseMs ? pause(p.pauseMs) : null]) {
      if (!a) continue;
      out.chunks.push(...a.chunks);
      out.sec += a.sec;
    }
  }
  return out;
}

// Keeps the phone's cache from growing without end: drop the oldest half when it gets big.
export async function pruneCache() {
  try {
    await caches.delete("nihongo-speak-podcast"); // the old commute-podcast cache
    await caches.delete("nihongo-speak-moyu");
    const c = await caches.open(CACHE);
    const keys = await c.keys();
    if (keys.length > MAX_CACHED) for (const k of keys.slice(0, keys.length / 2)) await c.delete(k);
  } catch {}
}

// MP3 frames of one clip, without the ID3 tag or the Xing/Info header frame, so clips can be
// joined into one file whose length the phone reads correctly. Also returns the clip's duration.
const BITRATE = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

type Frames = { chunks: Uint8Array[]; sec: number };

export function mp3Frames(buf: ArrayBuffer): Frames {
  const b = new Uint8Array(buf);
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    i = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + (b[5] & 0x10 ? 10 : 0);
  }
  const chunks: Uint8Array[] = [];
  let sec = 0;
  while (i + 4 <= b.length) {
    const ver = (b[i + 1] >> 3) & 3;
    const layer = (b[i + 1] >> 1) & 3;
    const brIdx = b[i + 2] >> 4;
    const srIdx = (b[i + 2] >> 2) & 3;
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0 || ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) break;
    const rate = RATES[ver][srIdx];
    const kbps = (ver === 3 ? BITRATE.v1 : BITRATE.v2)[brIdx];
    const size = Math.floor(((ver === 3 ? 144000 : 72000) * kbps) / rate) + ((b[i + 2] >> 1) & 1);
    const mono = b[i + 3] >> 6 === 3;
    const side = ver === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const tag = String.fromCharCode(...b.subarray(i + 4 + side, i + 8 + side));
    if (tag !== "Xing" && tag !== "Info" && i + size <= b.length) {
      chunks.push(b.subarray(i, i + size));
      sec += (ver === 3 ? 1152 : 576) / rate;
    }
    i += size;
  }
  // Not an MP3 we can read frame by frame: use it whole and estimate from Azure's 48 kbit/s.
  if (!sec) return { chunks: [b], sec: b.length / 6000 };
  return { chunks, sec };
}

export type Prepared = { clips: Clip[]; url: string; starts: number[]; total: number };

// Fetch every clip (a few at a time), drop any that fail, and join the rest into one MP3.
export async function prepare(clips: Clip[]): Promise<Prepared> {
  const out: (Frames | null)[] = new Array(clips.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < clips.length) {
      const i = next++;
      try {
        out[i] = await clipAudio(clips[i].parts);
      } catch (e) {
        console.warn(e);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const kept = clips.map((c, i) => ({ c, a: out[i] })).filter((x) => x.a);
  if (!kept.length) throw new Error("音频生成失败，检查一下网络");
  const starts: number[] = [];
  let total = 0;
  for (const { a } of kept) {
    starts.push(total);
    total += a!.sec;
  }
  const blob = new Blob(kept.flatMap(({ a }) => a!.chunks as BlobPart[]), { type: "audio/mpeg" });
  return { clips: kept.map((x) => x.c), url: URL.createObjectURL(blob), starts, total };
}
