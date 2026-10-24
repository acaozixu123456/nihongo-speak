import "server-only";
import { createHash } from "node:crypto";
import { get, head, put } from "@vercel/blob";
import { pictureCheck, picturePlan, type PicturePlan } from "@/lib/claude";
import { readNews, writeNews } from "@/lib/news";
import { PICS_DONE, type NewsArticle } from "@/lib/news-model";
import { vertexAccess } from "@/lib/vertex-tts";

// Pictures for the NHK articles: one whole situation per sentence (scene_image) and one per word (image_url),
// for dual coding: hearing the sentence while seeing what it is about, a word card with a picture and the
// Chinese. Imagen 4 Fast draws them on Vertex AI (2 cents each, the Google Cloud credit), Opus plans what to
// draw and looks at every picture before it is kept: one that doesn't plainly show the meaning is drawn once
// more, then left out (no picture is better than a wrong one).
// Words are kept for good under their own name (pic/w/<hash>.jpg), so a word met again costs nothing and a
// saved card keeps its picture; a sentence's picture goes with its article.

const REGION = "us-central1";
const IMAGEN = "imagen-4.0-fast-generate-001";
const PAINTER = "gemini-3.1-flash-image";

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

async function drawImagen(prompt: string, aspectRatio: string): Promise<Buffer | null> {
  const { project, token } = await vertexAccess();
  const res = await fetch(`https://${REGION}-aiplatform.googleapis.com/v1/projects/${project}/locations/${REGION}/publishers/google/models/${IMAGEN}:predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio, personGeneration: "allow_adult", outputOptions: { mimeType: "image/jpeg", compressionQuality: 78 } },
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`imagen ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { predictions?: { bytesBase64Encoded?: string }[] };
  const b = j.predictions?.[0]?.bytesBase64Encoded;
  return b ? Buffer.from(b, "base64") : null;
}

// Behind Imagen: the picture model the 洗脑歌 uses (dearer, and only a few a minute).
async function drawGemini(prompt: string, aspectRatio: string): Promise<Buffer | null> {
  const { project, token } = await vertexAccess();
  const res = await fetch(`https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${PAINTER}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio, imageSize: "1K" } },
    }),
    signal: AbortSignal.timeout(50000),
  });
  if (!res.ok) throw new Error(`${PAINTER} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  type Part = { inlineData?: { mimeType: string; data: string } };
  const j = (await res.json()) as { candidates?: { content?: { parts?: Part[] } }[] };
  const img = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  return img ? Buffer.from(img.data, "base64") : null;
}

export type Drawn = { ok: boolean; why: string; engine?: string };

// Draws one picture and has it looked at; a second go when the first isn't right.
async function drawChecked(path: string, prompt: string, aspect: string, ja: string, zh: string, log: string[]): Promise<Drawn> {
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const full = `${prompt}\n\n${STYLE}`;
    let img: Buffer | null = null;
    let engine = IMAGEN;
    try {
      img = await drawImagen(full, aspect);
    } catch (e) {
      log.push(`imagen failed: ${e instanceof Error ? e.message : e}`);
    }
    if (!img) {
      engine = PAINTER;
      img = await drawGemini(full, aspect).catch((e) => (log.push(`gemini failed: ${e instanceof Error ? e.message : e}`), null));
    }
    if (!img) return { ok: false, why: "not drawn" };
    // Imagen gives JPEG; the other model may give PNG, which the check wants named as such.
    const jpeg = img[0] === 0xff;
    const check = jpeg ? await pictureCheck(img, ja, zh, prompt).catch((e) => ({ ok: false, why: `check failed: ${e instanceof Error ? e.message : e}` })) : { ok: true, why: "png, not checked" };
    if (check.ok) {
      await put(path, img, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: jpeg ? "image/jpeg" : "image/png" });
      return { ok: true, why: check.why, engine };
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
async function picturesFor(a: NewsArticle, until: number, log: string[]): Promise<{ a: NewsArticle; done: boolean }> {
  const plan = await planFor(a);
  type Job = () => Promise<void>;
  const sentences = a.sentences.map((s) => ({ ...s }));
  const words = a.words.map((w) => ({ ...w }));
  const jobs: Job[] = [];
  let left = false;
  sentences.forEach((s, i) => {
    const p = plan.scenes.find((x) => Math.round(x.n) === i + 1)?.prompt.trim();
    if (!p || s.scene_image) return;
    jobs.push(async () => {
      if (Date.now() > until) return void (left = true);
      const path = scenePath(a.id, i);
      const r = (await exists(path)) ? { ok: true, why: "kept" } : await drawChecked(path, p, "4:3", s.ja, s.zh, log);
      if (r.ok) s.scene_image = sceneUrl(a.id, i);
      log.push(`${a.id} s${i} ${r.ok ? "ok" : "none"} ${r.why}`);
    });
  });
  words.forEach((w) => {
    const p = plan.words.find((x) => x.ja === w.ja);
    if (!p || p.look === "none" || !p.prompt.trim() || w.image_url) return;
    jobs.push(async () => {
      if (Date.now() > until) return void (left = true);
      const key = wordKey(w);
      const r = (await exists(wordPath(key))) ? { ok: true, why: "kept" } : await drawChecked(wordPath(key), p.prompt, "1:1", w.ja, w.zh, log);
      if (r.ok) Object.assign(w, { image_url: wordUrl(key), look: p.look });
      log.push(`${a.id} ${w.ja} ${r.ok ? "ok" : "none"} ${r.why}`);
    });
  });
  let k = 0;
  const worker = async () => {
    while (k < jobs.length) await jobs[k++]();
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { a: { ...a, sentences, words, pics: left ? (a.pics ?? 0) + 1 : PICS_DONE }, done: !left };
}

// Draws what is missing for the newest articles (only: older ones were heard already), until the time is up.
// ids: just these articles (a sample run).
export async function drawNewsPictures(o: { until: number; days?: number; ids?: string[] }) {
  const log: string[] = [];
  const file = await readNews();
  const days = [...new Set(file.items.map((a) => a.day))].sort().reverse().slice(0, o.days ?? 1);
  const todo = file.items.filter((a) => (o.ids ? o.ids.includes(a.id) : days.includes(a.day) && (a.pics ?? 0) < 3));
  const made = new Map<string, NewsArticle>();
  for (const a of todo) {
    if (Date.now() > o.until) break;
    try {
      const r = await picturesFor(a, o.until, log);
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
