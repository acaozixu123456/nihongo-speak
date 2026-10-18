import "server-only";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import * as z from "zod/v4";
import type { Radio } from "@/lib/radio";
import { vertexAccess } from "@/lib/vertex-tts";
import { sungKana } from "@/lib/claude";

// 洗脑歌: each 趣味电台 episode's words and grammar sung as a catchy J-pop song, with a little
// cartoon for every line. All Google models on Vertex AI, paid from the Google Cloud credit:
// Gemini writes the lyrics and the scenes, Lyria 3 Pro sings them ($0.08) and Nano Banana draws
// each scene ($0.067 each), about 60 cents an episode. The phone animates the pictures itself:
// Veo would have been another 2 dollars an episode.
// Making one takes a couple of minutes, so it goes a step at a time: the phone calls step() again
// and again, and each call does one step and saves where it got to in Blob (earworm/<id>/job.json).

const GLOBAL = "https://aiplatform.googleapis.com/v1";
const WRITER = "gemini-3.8-flash";
const SINGER = "lyria-3-pro-preview";
const PAINTER = "gemini-3.1-flash-image";

// 3: sung from kana lyrics and checked by ear, since Lyria read many kanji wrong.
const VERSION = 3;
// A song whose check still finds wrong readings is sung again, up to this many times in all.
const MAX_SINGS = 3;

const Line = z.object({
  sing: z.string().describe("歌う歌詞1行（日本語、8〜16字）。重点の単語や文型をそのまま入れる"),
  kw: z.string().describe("この行で覚える単語・文型（画面に大きく出す。単語は表記どおり、文型は「〜ないように」の形）"),
  kana: z.string().describe("kw の読み（ひらがな）。文型なら使われた形の読み"),
  zh: z.string().describe("kw の中国語の意味（短く、15字以内）"),
  scene: z.number().int().describe("この行で映す場面の番号（scenes の 0 から始まる添字）"),
});

export const SongSchema = z.object({
  style: z
    .string()
    .describe("Music style prompt in English: genre, vocal (one clear singer), instruments. Super catchy, upbeat, earworm. No tempo."),
  scenes: z
    .array(
      z.object({
        image: z.string().describe("English prompt for one funny illustration of this moment (who, where, what happens). No text in the image."),
      }),
    )
    .describe("6〜8 scenes, each used by one or more lines"),
  intro: z.array(Line).describe("イントロの問いかけ、1行"),
  verse1: z.array(Line).describe("1番、4行"),
  chorus: z.array(Line).describe("サビ、4行。2回歌う。一番大事な単語・文型を何度も繰り返す"),
  verse2: z.array(Line).describe("2番、4行"),
});

export type Song = z.infer<typeof SongSchema>;
export type SongLine = z.infer<typeof Line>;

type Step = "lyrics" | "song" | "check" | "draw" | "ready" | "failed";

export type Job = {
  step: Step;
  song?: Song;
  lines?: (SongLine & { at: number })[]; // in sung order, the chorus twice
  end?: number;
  lyria?: string; // what Lyria said it sang, kept for checking the timing
  sung?: string[]; // the lyrics Lyria was given, in kana, in the order of the song's lines (no repeat)
  sings?: number; // times sung at this version
  wrong?: { n: number; heard: string }[]; // lines the last check heard sung wrong
  drawn?: boolean[];
  drawTries?: number;
  failedStep?: Step;
  failedAt?: number;
  version?: number; // songs made before VERSION get sung again (their lyrics and pictures stay)
  error?: string;
  busyUntil?: number;
  revived?: number; // times a failed job was given another go
};

// What the phone sees.
export const view = (j: Job | null) =>
  j && {
    step: j.step,
    lines: j.lines,
    end: j.end,
    scenes: j.song?.scenes.length,
    version: j.version ?? 1,
    // How the pronunciation check went, to look at from outside.
    sung: j.sung,
    sings: j.sings,
    wrong: j.wrong,
    error: j.error,
  };

const path = (id: string, file: string) => `earworm/${id}/${file}`;

export async function readFile(id: string, file: string) {
  const res = await get(path(id, file), { access: "private", useCache: false }).catch((e: unknown) => {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  });
  if (!res || res.statusCode !== 200) return null;
  return Buffer.from(await new Response(res.stream).arrayBuffer());
}

const save = (id: string, file: string, body: Buffer | string, contentType: string) =>
  put(path(id, file), body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });

export async function readJob(id: string): Promise<Job | null> {
  const b = await readFile(id, "job.json");
  return b ? (JSON.parse(b.toString("utf8")) as Job) : null;
}

const writeJob = (id: string, j: Job) => save(id, "job.json", JSON.stringify(j), "application/json");

async function vertex(model: string, body: object, timeoutMs: number) {
  const { project, token } = await vertexAccess();
  const res = await fetch(`${GLOBAL}/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  type Part = { text?: string; thought?: boolean; inlineData?: { mimeType: string; data: string } };
  const reply = (await res.json()) as { candidates?: { content?: { parts?: Part[] } }[] };
  return reply.candidates?.[0]?.content?.parts ?? [];
}

const WRITE = `あなたは日本語学習者向けの「洗脑歌」（一度聞いたら頭から離れない覚え歌）の作詞家です。
聞き手は日本で働く中国人、JLPT N4〜N3。ラジオ番組1回分の単語・文型を、楽しいJ-popの歌にして覚えてもらいます。

- 番組の重要単語と文型をできるだけ全部、歌詞の中でそのまま使う。サビは一番大事なものを何度も繰り返す（「邪魔 邪魔 靴が邪魔」のように）。
- 単語の行では、表記と読みを続けて歌ってもよい（「玄関 げんかん 靴を脱ぐ」）。
- 歌詞は番組の話の流れに沿って、オチまでわかるように。短く、リズムよく、歌いやすく。
- 行ごとに、覚えるもの（kw）、読み、中国語の意味、映す場面を決める。
- 場面は番組の話を面白く描いたマンガの1コマ。登場人物はハル（明るい女性）とケン（とぼけた男性）。文字や看板は描かせない。`;

// The 今日 recap has no episode behind it: just what was learned that day, mistakes first.
const DAY = `
今回はラジオ番組ではなく、学習者が今日1日（または最近数日）で学んだもののまとめ（script は空）。
- 話の筋は要らない。words・phrases・grammar をできるだけ多く歌詞に入れる。並びの先頭のもの（今日間違えたもの）ほど大事なので、サビで何度も繰り返す。
- 場面は、その行の単語・文の意味がひと目でわかる面白い1コマ。ハルとケンが演じる。`;

const STYLE =
  "Cute flat vector illustration, bold simple shapes, thick clean outlines, warm off-white paper background, palette of ink black, soft beige and a vivid vermilion red accent, playful and funny like a Japanese kids' educational TV show. Recurring characters: Haru, a cheerful young Japanese woman with a short bob and a red sweater; Ken, a goofy young man with messy hair and round glasses. Absolutely no text, letters or signs in the image. Vertical 9:16 composition with the main subject in the middle.";

async function writeLyrics(ep: Radio): Promise<Song> {
  const { $schema, ...schema } = z.toJSONSchema(SongSchema) as Record<string, unknown>;
  void $schema;
  const brief = {
    title: ep.title_zh,
    script: ep.lines.map((l) => l.ja),
    words: ep.words,
    grammar: ep.grammar,
    phrases: ep.phrases,
  };
  const parts = await vertex(
    WRITER,
    {
      systemInstruction: { parts: [{ text: ep.lines.length ? WRITE : WRITE + DAY }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(brief) }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 1 },
    },
    60000,
  );
  const song = SongSchema.parse(JSON.parse(parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("")));
  if (!song.scenes.length) throw new Error("没有场景");
  song.scenes = song.scenes.slice(0, 8);
  const fix = (l: SongLine) => ({ ...l, scene: Math.max(0, Math.min(song.scenes.length - 1, l.scene)) });
  return {
    ...song,
    intro: song.intro.slice(0, 1).map(fix),
    verse1: song.verse1.slice(0, 4).map(fix),
    chorus: song.chorus.slice(0, 4).map(fix),
    verse2: song.verse2.slice(0, 4).map(fix),
  };
}

const sections = (s: Song) => [
  ["Intro", s.intro],
  ["Verse 1", s.verse1],
  ["Chorus", s.chorus],
  ["Verse 2", s.verse2],
  ["Chorus", s.chorus],
] as const;

// Lyria sings timed lyrics on time: given "[8.0:] 玄関ドアは…" it starts that line within half a
// second of 8.0 (checked with speech recognition). So the song is laid out here, at 120 BPM with a
// line every two bars after a two-bar intro, and the captions follow the plan. Left to itself,
// Lyria put in instrumental breaks and stretched lines, and only said where each section started.
const BAR2 = 4; // seconds: two bars of 4/4 at 120 BPM
const LEAD = 0.4; // the singer comes in a little ahead of the beat

// When each line is sung: as Lyria reports it back ("[8.0:] …") where it does, else as planned.
export function lineTimes(text: string, planned: number[]) {
  const said: number[] = [];
  // Only sung lines count: the section descriptions that follow carry times too, but in English.
  for (const m of text.matchAll(/^\[(\d+(?:\.\d+)?):[^\]]*\]\s*(.+)$/gm)) {
    if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(m[2])) said.push(Number(m[1]));
  }
  const use = said.length >= planned.length ? said.slice(0, planned.length) : planned;
  return use.map((t) => Math.max(0, t - LEAD));
}

// The lines written once each, in order: the chorus comes twice in the song.
const unique = (s: Song) => [...s.intro, ...s.verse1, ...s.chorus, ...s.verse2];

async function sing(id: string, song: Song, given?: string[]) {
  // Lyria reads kanji wrong often enough (細菌, 工面, 一夜) that it only ever sees kana.
  const once = unique(song);
  const sung = given?.length === once.length ? given : await sungKana(once.map((l) => l.sing));
  const kana = new Map(once.map((l, i) => [l, sung[i]]));
  let t = BAR2;
  const planned: number[] = [];
  const lyrics = sections(song)
    .map(([name, lines]) => {
      const timed = lines.map((l) => {
        planned.push(t);
        t += BAR2;
        return `[${(t - BAR2).toFixed(1)}:] ${kana.get(l) ?? l.sing}`;
      });
      return `[${name}]\n${timed.join("\n")}`;
    })
    .join("\n\n");
  const end = t + BAR2;
  // Gemini's style may name its own tempo; the timing needs this one.
  const style = song.style.replace(/\d+\s*BPM/gi, "");
  const prompt = `Create a ${end}-second super catchy, upbeat J-pop earworm song for Japanese learners, like a cheerful kids-TV / anime opening jingle. ${style}. Exactly 120 BPM, 4/4. One clear lead vocal, diction clear and slow enough that every word is easy to hear. The chorus must be extremely repetitive and hook-heavy. Instrumental intro from 0.0 to ${BAR2.toFixed(1)} seconds. Each lyric line is sung over exactly two bars (${BAR2} seconds) and starts exactly at the time written before it, with no instrumental breaks between sections. The lyrics are written in kana so every word is sung with its right Japanese reading: sing each syllable exactly as written. Sing in Japanese exactly these timed lyrics:\n\n${lyrics}`;
  const parts = await vertex(
    SINGER,
    { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["AUDIO", "TEXT"] } },
    110000,
  );
  const audio = parts.find((p) => p.inlineData)?.inlineData;
  if (!audio) throw new Error("Lyria 没有返回歌");
  await save(id, "song.mp3", Buffer.from(audio.data, "base64"), "audio/mpeg");
  const flat = sections(song).flatMap(([, lines]) => lines);
  const text = parts.map((p) => p.text ?? "").join("\n");
  const at = lineTimes(text, planned);
  const duration = Number(text.match(/duration_secs:\s*([\d.]+)/)?.[1] ?? 0);
  return { lines: flat.map((l, i) => ({ ...l, at: at[i] })), end: Math.max(duration, end), lyria: text.slice(0, 6000), version: VERSION, sung };
}

const CheckSchema = z.object({
  wrong: z
    .array(z.object({ n: z.number().int().describe("歌詞の行番号"), heard: z.string().describe("実際に聞こえた歌い方（かな）") }))
    .describe("読み方を間違えて歌っている行だけ。正しく歌えている行は入れない"),
});

// Listens to the song and lists the lines sung with a wrong reading (a kanji read the Chinese way, a
// syllable left out or changed). Stretched vowels, melody and timing don't count.
async function check(id: string, sung: string[]) {
  const mp3 = await readFile(id, "song.mp3");
  if (!mp3) throw new Error("找不到歌");
  const { $schema, ...schema } = z.toJSONSchema(CheckSchema) as Record<string, unknown>;
  void $schema;
  const parts = await vertex(
    WRITER,
    {
      systemInstruction: {
        parts: [
          {
            text: `日本語の覚え歌の発音チェック係です。歌を聞いて、下の歌詞（かな）と違う読み方で歌われている行を挙げてください。
対象：違う音で歌っている（中国語の発音になっている、音が抜けている・別の音になっている）。
対象外：伸ばし、こぶし、メロディー、タイミング、ほんの少しのなまり。自信がない行は挙げない。`,
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "audio/mpeg", data: mp3.toString("base64") } },
            { text: `歌詞：
${sung.map((l, i) => `${i + 1}. ${l}`).join("\n")}` },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0 },
    },
    90000,
  );
  return CheckSchema.parse(JSON.parse(parts.filter((p) => !p.thought && p.text).map((p) => p.text).join(""))).wrong;
}

// Draws one scene. The image model allows only a few pictures a minute on this account, so a
// refusal waits a moment and asks once more; whatever is still missing is drawn on the next call.
async function draw(id: string, scene: Song["scenes"][number], i: number) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parts = await vertex(
        PAINTER,
        {
          contents: [{ role: "user", parts: [{ text: `${scene.image}\n\nStyle: ${STYLE}` }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16", imageSize: "1K" } },
        },
        50000,
      );
      const img = parts.find((p) => p.inlineData)?.inlineData;
      if (img) {
        await save(id, `i${i}.png`, Buffer.from(img.data, "base64"), img.mimeType);
        return true;
      }
    } catch (e) {
      console.warn("earworm: drawing failed", i, e);
      await new Promise((r) => setTimeout(r, 8000));
    }
  }
  return false;
}

// Draws the scenes still missing, two at a time, saving after each pair. After a few calls, lines whose scene never
// got drawn borrow another one rather than holding up the song.
async function drawMissing(id: string, j: Job): Promise<Job> {
  const scenes = j.song!.scenes;
  const drawn = j.drawn ?? scenes.map(() => false);
  const todo = scenes.map((_, i) => i).filter((i) => !drawn[i]);
  const t0 = Date.now();
  let failed = false;
  // Stops starting new pictures in time to finish within the function's two minutes.
  for (let k = 0; k < todo.length && Date.now() - t0 < 60000; k += 2) {
    const pair = todo.slice(k, k + 2);
    const ok = await Promise.all(pair.map((i) => draw(id, scenes[i], i)));
    pair.forEach((i, n) => (drawn[i] = ok[n]));
    if (ok.includes(false)) failed = true;
    await writeJob(id, { ...j, drawn, busyUntil: t0 + 110000 });
  }
  const tries = (j.drawTries ?? 0) + (failed ? 1 : 0);
  if (drawn.every(Boolean)) return { ...j, drawn, step: "ready" };
  if (tries < 4 || !drawn.some(Boolean)) {
    if (tries >= 6) throw new Error("插图画不出来");
    return { ...j, drawn, drawTries: tries };
  }
  const have = drawn.flatMap((d, i) => (d ? [i] : []));
  const lines = j.lines!.map((l) => (drawn[l.scene] ? l : { ...l, scene: have[l.scene % have.length] }));
  return { ...j, drawn, lines, step: "ready" };
}

// Does the next step and saves the job. `ep` is needed only for the first step.
export async function step(id: string, ep: Radio | null): Promise<Job | null> {
  let j = await readJob(id);
  if (!j) {
    if (!ep) return null;
    j = { step: "lyrics" };
  }
  // Songs sung before the timing was laid out get sung again, keeping the lyrics and pictures.
  if (j.step === "ready" && (j.version ?? 1) < VERSION) j = { ...j, step: "song", drawTries: 0, sings: 0, sung: undefined };
  // A job that stopped on an error gets another go when the page is opened again later.
  // Twice at most: a step that keeps failing would otherwise be paid for every ten minutes.
  if (j.step === "failed" && j.failedStep && (j.revived ?? 0) < 2 && Date.now() - (j.failedAt ?? 0) > 10 * 60 * 1000) {
    j = { ...j, step: j.failedStep, error: undefined, drawTries: 0, revived: (j.revived ?? 0) + 1 };
  }
  if (j.step === "ready" || j.step === "failed" || (j.busyUntil ?? 0) > Date.now()) return j;
  await writeJob(id, { ...j, busyUntil: Date.now() + 115000 });
  try {
    if (j.step === "lyrics") {
      if (!ep) throw new Error("缺少这一期的内容");
      j = { ...j, song: await writeLyrics(ep), step: "song" };
    } else if (j.step === "song") {
      const sung = await sing(id, j.song!, j.sung);
      j = { ...j, ...sung, sings: (j.version === VERSION ? (j.sings ?? 0) : 0) + 1, step: "check" };
    } else if (j.step === "check") {
      // A check that can't be done doesn't hold the song up.
      const wrong = await check(id, j.sung ?? []).catch((e) => (console.warn("earworm: check failed", id, e), []));
      const again = wrong.length > 0 && (j.sings ?? 1) < MAX_SINGS;
      j = { ...j, wrong, step: again ? "song" : j.drawn?.every(Boolean) ? "ready" : "draw" };
    } else if (j.step === "draw") {
      j = await drawMissing(id, j);
    }
    j = { ...j, error: undefined };
  } catch (e) {
    console.error("earworm", id, j.step, e);
    // A step that fails is tried once more on the next call, then the job stops.
    const msg = e instanceof Error ? e.message : String(e);
    j = j.error?.startsWith(`${j.step}:`)
      ? { ...j, step: "failed", failedStep: j.step, failedAt: Date.now(), error: msg }
      : { ...j, error: `${j.step}: ${msg}` };
  }
  j = { ...j, busyUntil: 0 };
  await writeJob(id, j);
  return j;
}

// The picture at the top of an episode's page: one wide cartoon of what the show is about, with
// Haru and Ken in it, drawn once (about 7 cents) and kept with the 洗脑歌 files as cover.png.
export async function drawCover(id: string, ep: Radio) {
  const have = await readFile(id, "cover.png");
  if (have) return true;
  const talk = ep.lines
    .filter((l) => !l.part || l.part === "main")
    .slice(0, 14)
    .map((l) => l.ja)
    .join("\n");
  const prompt = `Draw the cover illustration for one episode of a cheerful Japanese radio talk show for learners.
Episode title (Chinese): ${ep.title_zh}
Teaser: ${ep.hook_zh}
What the hosts talk about:
${talk}

Show the single most surprising or funny moment of this topic as one scene, set in Japan, with the two hosts Haru and Ken in it reacting to it. Wide 16:9 composition, the main subject a little right of center, calm space along the bottom edge.

Style: ${STYLE.replace(/Vertical 9:16 composition[^.]*\./, "")}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const parts = await vertex(
        PAINTER,
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "1K" } },
        },
        50000,
      );
      const img = parts.find((p) => p.inlineData)?.inlineData;
      if (img) {
        await save(id, "cover.png", Buffer.from(img.data, "base64"), img.mimeType);
        return true;
      }
    } catch (e) {
      // The image model often refuses for a moment (a few pictures a minute on this account).
      console.warn("cover: drawing failed", id, e);
      await new Promise((r) => setTimeout(r, 8000));
    }
  }
  return false;
}
