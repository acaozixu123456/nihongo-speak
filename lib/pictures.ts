import "server-only";
import { createHash } from "node:crypto";
import { get, head, put } from "@vercel/blob";
import { pictureCheck, picturePlan, type PicturePlan } from "@/lib/claude";
import { readNews, writeNews } from "@/lib/news";
import { PICS_DONE, type NewsArticle } from "@/lib/news-model";
import { vertexAccess } from "@/lib/vertex-tts";

// Pictures for the NHK articles: one whole situation per sentence (scene_image) and one per word (image_url),
// for dual coding: hearing the sentence while seeing what it is about, a word card with a picture and the
// Chinese. Gemini's picture models draw them on Vertex AI (the Google Cloud credit), Opus plans what to
// draw and looks at every picture before it is kept: one that doesn't plainly show the meaning is drawn once
// more, then left out (no picture is better than a wrong one).
// Words are kept for good under their own name (pic/w/<hash>.jpg), so a word met again costs nothing and a
// saved card keeps its picture; a sentence's picture goes with its article.

// Imagen is gone from Vertex for this project (2026-10, every version 404); Gemini's picture models, cheapest first.
const PAINTERS = ["gemini-3.1-flash-lite-image", "gemini-2.5-flash-image", "gemini-3.1-flash-image"];

const STYLE =
  "Realistic photograph, natural light, clean simple composition, the main subject large and in clear focus in the center. Absolutely no text, letters, numbers, captions, signs or logos anywhere in the image.";

export const wordKey = (w: { ja: string; kana: string }) => createHash("sha1").update(`${w.ja}|${w.kana}`).digest("hex").slice(0, 16);
const wordPath = (key: string) => `pic/w/${key}.jpg`;
const scenePath = (id: string, i: number) => `news/pic/${id}/s${i}.jpg`;
const planPath = (id: string) => `news/pic/${id}/plan.json`;
// The address the phone gets them from (app/api/pic).
export const wordUrl = (key: string) => `/api/pic/w/${key}`;
export const sceneUrl = (id: string, i: number) => `/api/pic/s/${id}/${i}`;

export async function readPicture(kind: "w" | "s", id: string, i?: number): Promise<ArrayBuffer | null> {
  const res = await get(kind === "w" ? wordPath(id) : scenePath(id, i ?? 0), { access: "private" }).catch(() => null);
  return res?.statusCode === 200 ? new Response(res.stream).arrayBuffer() : null;
}

async function drawGemini(model: string, prompt: string, aspectRatio: string): Promise<Buffer | null> {
  const { project, token } = await vertexAccess();
  const res = await fetch(`https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
    }),
    signal: AbortSignal.timeout(50000),
  });
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  type Part = { inlineData?: { mimeType: string; data: string } };
  const j = (await res.json()) as { candidates?: { content?: { parts?: Part[] } }[] };
  const img = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  return img ? Buffer.from(img.data, "base64") : null;
}

// Which picture models this project has (for ?pics=models).
export async function pictureModels() {
  const { project, token } = await vertexAccess();
  const list = await fetch(`https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=300`, { headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": project } });
  return list.ok ? ((await list.json()) as { publisherModels?: { name: string }[] }).publisherModels?.map((x) => x.name).filter((n) => /imag|veo/.test(n)) : `${list.status}`;
}

export type Drawn = { ok: boolean; why: string; engine?: string; drawn?: false };

// Models that stopped answering (not on this project) are skipped from then on.
const down = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Whatever the model gives, kept as a JPEG of phone size (~100 KB rather than 2 MB).
const toJpeg = async (img: Buffer) => (await import("sharp")).default(img).resize({ width: 960, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();

// The cheapest model first; each allows only a few pictures a minute, so a refusal moves on to the next, and
// when all refuse it waits and asks again.
async function drawOne(prompt: string, aspect: string, log: string[]): Promise<{ img: Buffer; engine: string } | null> {
  for (let t = 0; t < 3; t++) {
    for (const m of PAINTERS.filter((m) => !down.has(m))) {
      try {
        const img = await drawGemini(m, prompt, aspect);
        if (img) return { img, engine: m };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/ 40[034]/.test(msg)) down.add(m);
        log.push(msg.slice(0, 90));
      }
    }
    await sleep(12000 * (t + 1));
  }
  return null;
}

// Draws one picture and has it looked at; a second go when the first isn't right. drawn: false when no picture
// came at all (tried again on a later run), as against one that was looked at and turned down.
async function drawChecked(path: string, prompt: string, aspect: string, ja: string, zh: string, log: string[], kind: "word" | "sentence" = "word"): Promise<Drawn> {
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const got = await drawOne(`${prompt}\n\n${STYLE}`, aspect, log);
    if (!got) return { ok: false, why: "not drawn", drawn: false };
    const jpeg = await toJpeg(got.img);
    const check = await pictureCheck(jpeg, ja, zh, prompt, kind).catch((e) => ({ ok: false, why: `check failed: ${e instanceof Error ? e.message : e}` }));
    if (check.ok) {
      await put(path, jpeg, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg" });
      return { ok: true, why: check.why, engine: got.engine };
    }
    why = check.why;
    log.push(`rejected ${ja}: ${why}`);
  }
  return { ok: false, why };
}

async function planFor(a: NewsArticle): Promise<PicturePlan> {
  const res = await get(planPath(a.id), { access: "private", useCache: false }).catch(() => null);
  if (res?.statusCode === 200) {
    const kept = (await new Response(res.stream).json()) as PicturePlan;
    // Made for this text (not before the article was made again).
    if (kept.scenes.length === a.sentences.length && a.words.every((w) => kept.words.some((x) => x.ja === w.ja))) return kept;
  }
  const plan = await picturePlan(
    a.title_ja,
    a.sentences.map((s) => ({ ja: s.ja, zh: s.zh })),
    a.words,
  );
  await put(planPath(a.id), JSON.stringify(plan), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  return plan;
}

const exists = (path: string) => head(path).then(() => true, () => false);

// One article's pictures, the ones still missing, a few at a time; returns the article with their addresses.
async function picturesFor(a: NewsArticle, until: number, log: string[], redraw = false): Promise<{ a: NewsArticle; done: boolean }> {
  const plan = await planFor(a);
  type Job = () => Promise<void>;
  const sentences = a.sentences.map((s) => (redraw ? { ...s, scene_image: undefined } : { ...s }));
  const words = a.words.map((w) => (redraw ? { ...w, image_url: undefined, look: undefined } : { ...w }));
  const jobs: Job[] = [];
  let left = false;
  sentences.forEach((s, i) => {
    const p = plan.scenes.find((x) => Math.round(x.n) === i + 1)?.prompt.trim();
    if (!p || s.scene_image) return;
    jobs.push(async () => {
      if (Date.now() > until) return void (left = true);
      const path = scenePath(a.id, i);
      const r = !redraw && (await exists(path)) ? { ok: true, why: "kept" } : await drawChecked(path, p, "4:3", s.ja, s.zh, log, "sentence");
      if (r.ok) s.scene_image = sceneUrl(a.id, i);
      if ("drawn" in r && r.drawn === false) left = true;
      log.push(`${a.id} s${i} ${r.ok ? "ok" : "none"} ${r.why}`);
    });
  });
  words.forEach((w) => {
    const p = plan.words.find((x) => x.ja === w.ja);
    if (!p || p.look === "none" || !p.prompt.trim() || w.image_url) return;
    jobs.push(async () => {
      if (Date.now() > until) return void (left = true);
      const key = wordKey(w);
      const r = !redraw && (await exists(wordPath(key))) ? { ok: true, why: "kept" } : await drawChecked(wordPath(key), p.prompt, "1:1", w.ja, w.zh, log);
      if (r.ok) Object.assign(w, { image_url: wordUrl(key), look: p.look });
      if ("drawn" in r && r.drawn === false) left = true;
      log.push(`${a.id} ${w.ja} ${r.ok ? "ok" : "none"} ${r.why}`);
    });
  });
  let k = 0;
  const worker = async () => {
    while (k < jobs.length) await jobs[k++]();
  };
  await Promise.all([worker(), worker()]);
  return { a: { ...a, sentences, words, pics: left ? ((a.pics ?? 0) >= PICS_DONE ? 1 : (a.pics ?? 0) + 1) : PICS_DONE }, done: !left };
}

// Draws what is missing for the newest articles (only: older ones were heard already), until the time is up.
// ids: just these articles (a sample run).
export async function drawNewsPictures(o: { until: number; days?: number; ids?: string[]; redraw?: boolean }) {
  const log: string[] = [];
  const file = await readNews();
  const days = [...new Set(file.items.map((a) => a.day))].sort().reverse().slice(0, o.days ?? 1);
  const todo = file.items.filter((a) => (o.ids ? o.ids.includes(a.id) : days.includes(a.day) && (a.pics ?? 0) < 10));
  const made = new Map<string, NewsArticle>();
  for (const a of todo) {
    if (Date.now() > o.until) break;
    try {
      const r = await picturesFor(a, o.until, log, o.redraw);
      made.set(a.id, r.a);
    } catch (e) {
      log.push(`${a.id} failed: ${e instanceof Error ? e.message : e}`);
      made.set(a.id, { ...a, pics: (a.pics ?? 0) + 1 });
    }
  }
  if (made.size) {
    // Read again: the file may have changed while drawing.
    const now = await readNews();
    await writeNews({ ...now, items: now.items.map((a) => (made.has(a.id) ? { ...a, ...pick(made.get(a.id)!) } : a)) });
  }
  return { articles: [...made.values()].map((a) => ({ id: a.id, pics: a.pics, scenes: a.sentences.filter((s) => s.scene_image).length, of: a.sentences.length, words: a.words.filter((w) => w.image_url).length })), log };
}

// Only what drawing changed, laid over the article as it is now.
const pick = (a: NewsArticle) => ({ sentences: a.sentences, words: a.words, pics: a.pics });
