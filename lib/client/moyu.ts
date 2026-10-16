"use client";

import type { Podcast as Episode } from "@/lib/claude";
import {
  allScenarios,
  dayKey,
  dueCards,
  quickRound,
  weakList,
  type Progress,
  type StuckLine,
} from "./progress";

// 摸鱼模式: listen-only practice for when the learner can't speak (at work, on the train).
// Each round is about ten minutes of short clips. Every clip is synthesized once, cached on the
// phone, and the round's clips are joined into one MP3 so playback carries on with the screen locked.

export type Block = "listen" | "quick" | "review" | "fix" | "podcast";
export const BLOCK_LABEL: Record<Block, string> = {
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

const ZH = "zh-CN-XiaoxiaoNeural";
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
    "心里瞬间说。听到中文，先在心里说日语。",
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
    "复习今天到期的收藏。",
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
          zh("你当时说的是："),
          { voice: "ja-JP-NanamiNeural", text: e.said, pauseMs: 800 },
          zh("更自然的说法是："),
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
    parts: [zh(`偷听：${s.titleZh}。先听一遍整段。`, 600), ...s.lines.map((l) => ({ voice: l.voice, text: l.ja, pauseMs: 500 })), { voice: ZH, pauseMs: 1000 }],
  };
  const lines: Clip[] = s.lines.map((l) => ({
    block: "listen",
    show: l.ja,
    sub: `${l.speaker} · ${l.zh}`,
    line: { ja: l.ja, reading: l.kana, zh: l.zh, voice: l.voice },
    parts: [{ voice: l.voice, text: l.ja, pauseMs: 600 }, zh(l.zh, 1200)],
  }));
  return [whole, ...withIntro(lines, "再一句一句听。")];
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

// Round 0 is short so playback starts quickly; later rounds add a scene to overhear and, once, the podcast.
export function buildRound(p: Progress, r: number, used: Set<string>, episode: Episode | null): Clip[] {
  if (r === 0) return [...quickClips(p, 5, used), ...reviewClips(p, 3, used), ...fixClips(p, 0)];
  return [
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

// ---- Audio ----

const CACHE = "nihongo-speak-moyu";
const MAX_CACHED = 400;

async function clipKey(parts: Part[]) {
  const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(JSON.stringify(parts)));
  return `/moyu-clip/${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchClip(parts: Part[]): Promise<ArrayBuffer> {
  const key = await clipKey(parts);
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(key);
    if (hit) return hit.arrayBuffer();
  } catch {}
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch("/api/moyu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parts }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      if (cache) await cache.put(key, new Response(buf, { headers: { "Content-Type": "audio/mpeg" } })).catch(() => {});
      return buf;
    } catch (e) {
      // The free speech resource allows only a few requests a minute; back off and try again.
      if (attempt >= 2) throw e;
      await wait(attempt ? 6000 : 2500);
    }
  }
}

// Keeps the phone's cache from growing without end: drop the oldest half when it gets big.
export async function pruneCache() {
  try {
    await caches.delete("nihongo-speak-podcast"); // the old commute-podcast cache
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

export function mp3Frames(buf: ArrayBuffer): { chunks: Uint8Array[]; sec: number } {
  const b = new Uint8Array(buf);
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    i = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + (b[5] & 0x10 ? 10 : 0);
  }
  const chunks: Uint8Array[] = [];
  let sec = 0;
  let start = i;
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
    if (tag === "Xing" || tag === "Info") {
      if (i > start) chunks.push(b.subarray(start, i));
      start = i + size;
    } else {
      sec += (ver === 3 ? 1152 : 576) / rate;
    }
    i += size;
  }
  if (i > start) chunks.push(b.subarray(start, Math.min(i, b.length)));
  // Not an MP3 we can read frame by frame: use it whole and estimate from Azure's 48 kbit/s.
  if (!sec) return { chunks: [b], sec: b.length / 6000 };
  return { chunks, sec };
}

export type Prepared = { clips: Clip[]; url: string; starts: number[]; total: number };

// Fetch every clip (a few at a time), drop any that fail, and join the rest into one MP3.
export async function prepare(clips: Clip[]): Promise<Prepared> {
  const out: ({ chunks: Uint8Array[]; sec: number } | null)[] = new Array(clips.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < clips.length) {
      const i = next++;
      try {
        out[i] = mp3Frames(await fetchClip(clips[i].parts));
      } catch (e) {
        console.warn(e);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
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
