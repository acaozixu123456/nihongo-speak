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

// Which picture models this project can use (for ?pics=models).
export async function pictureModels() {
  const { project, token } = await vertexAccess();
  const out: Record<string, unknown> = {};
  for (const m of ["imagen-4.0-fast-generate-001", "imagen-4.0-generate-001", "imagen-4.0-ultra-generate-001", "imagen-3.0-fast-generate-001", "imagen-3.0-generate-002", "imagen-4.0-fast-generate-preview-06-06"]) {
    for (const region of ["us-central1", "asia-northeast1", "global"]) {
      const host = region === "global" ? "aiplatform.googleapis.com" : `${region}-aiplatform.googleapis.com`;
      const r = await fetch(`https://${host}/v1/projects/${project}/locations/${region}/publishers/google/models/${m}:predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ instances: [{ prompt: "a red apple on a white table" }], parameters: { sampleCount: 1 } }),
      }).catch((e) => ({ status: 0, text: async () => String(e) }));
      out[`${m}@${region}`] = r.status === 200 ? 200 : `${r.status} ${(await r.text()).slice(0, 120)}`;
      if (r.status === 200) break;
    }
  }
  const list = await fetch(`https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=300`, { headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": project } });
  const names = list.ok ? ((await list.json()) as { publisherModels?: { name: string }[] }).publisherModels?.map((x) => x.name).filter((n) => /imag|flash-image|veo/.test(n)) : `${list.status} ${(await list.text()).slice(0, 200)}`;
  return { out, names };
}

export type Drawn = { ok: boolean; why: string; engine?: string; drawn?: false };

// Imagen once refused (not on this project): the other model from then on, one at a time.
let imagenDown = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Whatever the model gives, kept as a JPEG of phone size (~100 KB rather than 2 MB).
const toJpeg = async (img: Buffer) => (await import("sharp")).default(img).resize({ width: 960, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();

async function drawOne(prompt: string, aspect: string, log: string[]): Promise<{ img: Buffer; engine: string } | null> {
  if (!imagenDown) {
    try {
      const img = await drawImagen(prompt, aspect);
      if (img) return { img, engine: IMAGEN };
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/ 40[34]/.test(m)) imagenDown = true;
      log.push(`imagen: ${m.slice(0, 120)}`);
    }
  }
  // The other model allows only a few pictures a minute: a refusal waits and asks again.
  for (let t = 0; t < 3; t++) {
    try {
      const img = await drawGemini(prompt, aspect);
      if (img) return { img, engine: PAINTER };
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      log.push(`gemini: ${m.slice(0, 80)}`);
      if (!/ 429/.test(m)) return null;
      await sleep(15000 * (t + 1));
    }
  }
  return null;
}

// Draws one picture and has it looked at; a second go when the first isn't right. drawn: false when no picture
// came at all (tried again on a later run), as against one that was looked at and turned down.
async function drawChecked(path: string, prompt: string, aspect: string, ja: string, zh: string, log: string[]): Promise<Drawn> {
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const got = await drawOne(`${prompt}\n\n${STYLE}`, aspect, log);
    if (!got) return { ok: false, why: "not drawn", drawn: false };
    const jpeg = await toJpeg(got.img);
    const check = await pictureCheck(jpeg, ja, zh, prompt).catch((e) => ({ ok: false, why: `check failed: ${e instanceof Error ? e.message : e}` }));
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
      const r = !redraw && (await exists(path)) ? { ok: true, why: "kept" } : await drawChecked(path, p, "4:3", s.ja, s.zh, log);
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
  await Promise.all(imagenDown ? [worker()] : [worker(), worker(), worker(), worker()]);
  return { a: { ...a, sentences, words, pics: left ? (a.pics ?? 0) + 1 : PICS_DONE }, done: !left };
}

// Draws what is missing for the newest articles (only: older ones were heard already), until the time is up.
// ids: just these articles (a sample run).
export async function drawNewsPictures(o: { until: number; days?: number; ids?: string[]; redraw?: boolean }) {
  const log: string[] = [];
  const file = await readNews();
  const days = [...new Set(file.items.map((a) => a.day))].sort().reverse().slice(0, o.days ?? 1);
  const todo = file.items.filter((a) => (o.ids ? o.ids.includes(a.id) : days.includes(a.day) && (a.pics ?? 0) < 3));
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
