import "server-only";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import * as z from "zod/v4";
import type { Radio } from "@/lib/radio";
import { vertexAccess } from "@/lib/vertex-tts";
import { LEARNER, LEVEL } from "@/lib/learner";

// 洗脑歌: each 趣味电台 episode's words and grammar sung as a catchy pop song, with a little
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

// Songs made before this version are sung again (their lyrics and pictures stay).
const VERSION = 1;
// A song whose check still finds words sung unclearly is sung again, up to this many times in all.
const MAX_SINGS = 3;

const Line = z.object({
  sing: z.string().describe("One sung lyric line (English, 4-9 words). Put the key word or pattern in as is"),
  kw: z.string().describe("The word or pattern to learn in this line (shown big on screen; a word as written, a pattern like 'used to + verb')"),
  kana: z.string().describe("kw's pronunciation in IPA (for a pattern, the form used)"),
  zh: z.string().describe("kw's Chinese meaning (short, 15 characters at most)"),
  scene: z.number().int().describe("Number of the scene shown for this line (0-based index into scenes)"),
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
  intro: z.array(Line).describe("Intro question, 1 line"),
  verse1: z.array(Line).describe("Verse 1, 4 lines"),
  chorus: z.array(Line).describe("Chorus, 4 lines, sung twice. Repeats the most important word or pattern again and again"),
  verse2: z.array(Line).describe("Verse 2, 4 lines"),
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
  sung?: string[]; // the lyrics Lyria was given, in the order of the song's lines (no repeat)
  sings?: number; // times sung at this version
  wrong?: { n: number; heard: string }[]; // lines the last check heard sung unclearly
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

const WRITE = `You write "earworm songs" for English learners: songs you can't get out of your head after hearing them once. ${LEARNER}
Turn the words and patterns of one radio episode into a fun pop song so she remembers them.

- Use as many of the episode's key words and patterns as possible, as they are, in the lyrics. The chorus repeats the most important ones again and again ("Out of stock, out of stock, sorry it's out of stock").
- A word line may spell it out or say it twice ("Receipt, receipt, here's your receipt").
- Follow the story of the episode so the punchline comes through. Short, rhythmic, easy to sing, ${LEVEL} English.
- For each line decide what to learn (kw), its IPA, its Chinese meaning and the scene shown.
- A scene is one funny comic panel of the episode's story. The characters are Amy (cheerful woman) and Ben (goofy man). No text or signs drawn.`;

// The 今日 recap has no episode behind it: just what was learned that day, mistakes first.
const DAY = `
This time it is not a radio episode but what the learner learned today (or the last few days) (script is empty).
- No story needed. Put as many of words, phrases and grammar as possible into the lyrics. The first ones in each list (today's mistakes) matter most: repeat them in the chorus.
- Each scene is one funny panel that shows the meaning of the line's word or sentence at a glance, acted by Amy and Ben.`;

const STYLE =
  "Cute flat vector illustration, bold simple shapes, thick clean outlines, warm off-white paper background, palette of ink black, soft beige and a vivid vermilion red accent, playful and funny like a kids' educational TV show. Recurring characters: Amy, a cheerful young woman with a short bob and a red sweater; Ben, a goofy young man with messy hair and round glasses. Absolutely no text, letters or signs in the image. Vertical 9:16 composition with the main subject in the middle.";

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

// Lyria sings timed lyrics on time: given "[8.0:] Here's your receipt…" it starts that line within half a
// second of 8.0 (checked with speech recognition). So the song is laid out here, at 120 BPM with a
// line every two bars after a two-bar intro, and the captions follow the plan. Left to itself,
// Lyria put in instrumental breaks and stretched lines, and only said where each section started.
const BAR2 = 4; // seconds: two bars of 4/4 at 120 BPM
const LEAD = 0.4; // the singer comes in a little ahead of the beat

// When each line is sung: as Lyria reports it back ("[8.0:] …") where it does, else as planned.
export function lineTimes(text: string, planned: number[], lyrics: string[] = []) {
  const said: number[] = [];
  // Only sung lines count: the section descriptions that follow carry times too. A sung line shares
  // most of its words with one of the lyrics.
  const words = (t: string) => t.toLowerCase().match(/[a-z']+/g) ?? [];
  const sung = lyrics.map((l) => new Set(words(l)));
  for (const m of text.matchAll(/^\[(\d+(?:\.\d+)?):[^\]]*\]\s*(.+)$/gm)) {
    const w = words(m[2]);
    if (w.length && sung.some((l) => w.filter((x) => l.has(x)).length >= w.length / 2)) said.push(Number(m[1]));
  }
  const use = said.length >= planned.length ? said.slice(0, planned.length) : planned;
  return use.map((t) => Math.max(0, t - LEAD));
}

// The lines written once each, in order: the chorus comes twice in the song.
const unique = (s: Song) => [...s.intro, ...s.verse1, ...s.chorus, ...s.verse2];

async function sing(id: string, song: Song, given?: string[]) {
  const once = unique(song);
  const sung = given?.length === once.length ? given : once.map((l) => l.sing);
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
  const prompt = `Create a ${end}-second super catchy, upbeat pop earworm song for English learners, like a cheerful kids-TV jingle. ${style}. Exactly 120 BPM, 4/4. One clear lead vocal with a clear American English accent, diction clear and slow enough that every word is easy to hear. The chorus must be extremely repetitive and hook-heavy. Instrumental intro from 0.0 to ${BAR2.toFixed(1)} seconds. Each lyric line is sung over exactly two bars (${BAR2} seconds) and starts exactly at the time written before it, with no instrumental breaks between sections. Sing in English exactly these timed lyrics:\n\n${lyrics}`;
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
  const at = lineTimes(text, planned, sung);
  const duration = Number(text.match(/duration_secs:\s*([\d.]+)/)?.[1] ?? 0);
  return { lines: flat.map((l, i) => ({ ...l, at: at[i] })), end: Math.max(duration, end), lyria: text.slice(0, 6000), version: VERSION, sung };
}

const CheckSchema = z.object({
  wrong: z
    .array(z.object({ n: z.number().int().describe("The lyric line's number"), heard: z.string().describe("What was actually heard sung") }))
    .describe("Only the lines whose words can't be made out or are sung as other words. Not the lines sung right"),
});

// Listens to the song and lists the lines whose words don't come through (mumbled, swallowed, sung as
// other words): a learner can't pick them up from it. Stretched vowels, melody and timing don't count.
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
            text: `You check the diction of a song for English learners. Listen to the song and list the lines where a learner could not make out the words below: words swallowed, mumbled, left out or sung as other words.
Not counted: stretched vowels, melody, timing, a slight accent. Leave out lines you aren't sure about.`,
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "audio/mpeg", data: mp3.toString("base64") } },
            { text: `Lyrics:
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
// Amy and Ben in it, drawn once (about 7 cents) and kept with the 洗脑歌 files as cover.png.
export async function drawCover(id: string, ep: Radio) {
  const have = await readFile(id, "cover.png");
  if (have) return true;
  const talk = ep.lines
    .filter((l) => !l.part || l.part === "main")
    .slice(0, 14)
    .map((l) => l.ja)
    .join("\n");
  const prompt = `Draw the cover illustration for one episode of a cheerful English radio talk show for learners.
Episode title (Chinese): ${ep.title_zh}
Teaser: ${ep.hook_zh}
What the hosts talk about:
${talk}

Show the single most surprising or funny moment of this topic as one scene, with the two hosts Amy and Ben in it reacting to it. Wide 16:9 composition, the main subject a little right of center, calm space along the bottom edge.

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
