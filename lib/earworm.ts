import "server-only";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import * as z from "zod/v4";
import type { Radio } from "@/lib/radio";
import { vertexAccess } from "@/lib/vertex-tts";

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
    .describe("Music style prompt in English: genre, tempo (BPM), vocal (one clear singer), instruments. Super catchy, upbeat, earworm."),
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

type Step = "lyrics" | "song" | "draw" | "ready" | "failed";

export type Job = {
  step: Step;
  song?: Song;
  lines?: (SongLine & { at: number })[]; // in sung order, the chorus twice
  end?: number;
  lyria?: string; // what Lyria said it sang, kept for checking the timing
  drawn?: boolean[];
  drawTries?: number;
  failedStep?: Step;
  failedAt?: number;
  error?: string;
  busyUntil?: number;
};

// What the phone sees.
export const view = (j: Job | null) =>
  j && {
    step: j.step,
    lines: j.lines,
    end: j.end,
    scenes: j.song?.scenes.length,
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
      systemInstruction: { parts: [{ text: WRITE }] },
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

// Lyria answers with the lyrics it sang, a start time on the first line of each section
// ("[25.9:] 引っかかっちゃう…", the rest "[:] …"), its tempo ("bpm: 130.0") and the song's length
// ("duration_secs: 70.1"). Each line is sung over two bars, so the lines of a section follow its
// start eight beats apart (squeezed if the next section starts sooner). Spreading them evenly up
// to the next section went wrong whenever an instrumental break came in between.
export function lineTimes(text: string, sections: number[]) {
  const count = sections.reduce((a, b) => a + b, 0);
  const known: (number | null)[] = [];
  // Only sung lines count: the section descriptions that follow carry times too, but in English.
  for (const m of text.matchAll(/^\[(\d+(?:\.\d+)?)?:[^\]]*\]\s*(.+)$/gm)) {
    if (known.length >= count) break;
    if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(m[2])) known.push(m[1] ? Number(m[1]) : null);
  }
  const duration = Number(text.match(/duration_secs:\s*([\d.]+)/)?.[1] ?? 0);
  const bpm = Number(text.match(/bpm:\s*([\d.]+)/)?.[1] ?? 0);
  const pace = bpm > 60 && bpm < 240 ? 480 / bpm : 3.5;
  // Where each section starts, as Lyria says, or right after the one before.
  const firsts: number[] = [];
  let n = 0;
  for (const len of sections) {
    firsts.push(n);
    n += len;
  }
  const said = known.length === count ? firsts.map((i) => known[i]) : known.filter((x): x is number => x !== null);
  const at: number[] = [];
  let next = said[0] ?? 0;
  sections.forEach((len, k) => {
    const start = Math.max(said[k] ?? next, at.length ? at[at.length - 1] + 1 : 0);
    const after = said[k + 1];
    const step = after != null && after > start ? Math.min(pace, (after - start) / len) : pace;
    for (let i = 0; i < len; i++) at.push(start + i * step);
    next = start + len * step;
  });
  return { at, end: Math.max(duration, next) };
}

async function sing(id: string, song: Song) {
  const lyrics = sections(song)
    .map(([name, lines]) => `[${name}]\n${lines.map((l) => l.sing).join("\n")}`)
    .join("\n\n");
  const prompt = `Create a 70-second super catchy, upbeat J-pop earworm song for Japanese learners, like a cheerful kids-TV / anime opening jingle. ${song.style}. One clear lead vocal, diction clear and slow enough that every word is easy to hear. The chorus must be extremely repetitive and hook-heavy. Sing in Japanese, exactly these lyrics:\n\n${lyrics}`;
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
  const { at, end } = lineTimes(text, sections(song).map(([, lines]) => lines.length));
  return { lines: flat.map((l, i) => ({ ...l, at: at[i] })), end, lyria: text.slice(0, 6000) };
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
  // A job that stopped on an error gets another go when the page is opened again later.
  if (j.step === "failed" && j.failedStep && Date.now() - (j.failedAt ?? 0) > 10 * 60 * 1000) {
    j = { ...j, step: j.failedStep, error: undefined, drawTries: 0 };
  }
  if (j.step === "ready" || j.step === "failed" || (j.busyUntil ?? 0) > Date.now()) return j;
  await writeJob(id, { ...j, busyUntil: Date.now() + 115000 });
  try {
    if (j.step === "lyrics") {
      if (!ep) throw new Error("缺少这一期的内容");
      j = { ...j, song: await writeLyrics(ep), step: "song" };
    } else if (j.step === "song") {
      j = { ...j, ...(await sing(id, j.song!)), step: "draw" };
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
