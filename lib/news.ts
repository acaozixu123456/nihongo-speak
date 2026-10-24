import "server-only";
import { BlobNotFoundError, del, get, put } from "@vercel/blob";
import { newsNotes } from "@/lib/claude";
import { addDays } from "@/lib/progress-model";
import { NEWS_DAYS, newsVoice, type NewsArticle } from "@/lib/news-model";
import { newsList, storyImage, storyText } from "@/lib/bbc";

// Twice a day (cron, 21:00 and 8:30 JST) the newest BBC stories are fetched, written as short articles for
// the learner with our notes, and kept in one private Blob file the phone reads through /api/news. Their
// sentences are then asked for once from our own /api/tts, so the CDN holds the voice before the train.

const PATH = "news/articles.json";
export type NewsFile = { made: number; items: NewsArticle[] };

export async function readNews(): Promise<NewsFile> {
  const res = await get(PATH, { access: "private", useCache: false }).catch((e: unknown) => {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  });
  return res?.statusCode === 200 ? ((await new Response(res.stream).json()) as NewsFile) : { made: 0, items: [] };
}

// The story's picture, kept as long as the article.
const imgPath = (id: string) => `news/img/${id}.jpg`;

export async function readNewsImage(id: string): Promise<ArrayBuffer | null> {
  const res = await get(imgPath(id), { access: "private" }).catch(() => null);
  return res?.statusCode === 200 ? new Response(res.stream).arrayBuffer() : null;
}

async function writeNews(f: NewsFile) {
  await put(PATH, JSON.stringify(f), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
}

// The articles of the last few days the BBC put out that aren't kept yet, made one by one (a failed one is
// tried again next time). Old ones are dropped. redo: make the kept ones of those days again too (after
// the notes or the voice text changed).
export async function refreshNews(today: string, opts: { days?: number; redo?: boolean } = {}): Promise<{ added: string[]; failed: string[]; file: NewsFile }> {
  const read = await readNews();
  const list = await newsList();
  const from = addDays(today, -(opts.days ?? 3));
  const file = opts.redo ? { ...read, items: read.items.filter((a) => !list.some((n) => n.id === a.id && n.day >= from)) } : read;
  const have = new Set(file.items.map((a) => a.id));
  const todo = list.filter((n) => n.day >= from && !have.has(n.id));
  const added: string[] = [];
  const failed: string[] = [];
  const made = await Promise.all(
    todo.map(async (n) => {
      try {
        const notes = await newsNotes(n.title, await storyText(n));
        const sentences = notes.sentences.map((x) => x.en.trim()).filter(Boolean);
        if (sentences.length < 3) throw new Error(`news ${n.id}: only ${sentences.length} sentences`);
        const article: NewsArticle = {
          id: n.id,
          day: n.day,
          at: n.at,
          rank: n.rank,
          title: [{ t: notes.title }],
          title_ja: notes.title,
          title_say: notes.title,
          title_zh: notes.title_zh,
          // A new paragraph after the opening sentence, as a news reader pauses after the lead.
          sentences: notes.sentences.filter((x) => x.en.trim()).map((x, i) => ({ segs: [{ t: x.en.trim() }], ja: x.en.trim(), say: x.en.trim(), zh: x.zh, ...(i === 1 ? { p: true as const } : {}) })),
          words: notes.words,
          keys: notes.keys,
          summary: notes.summary,
          url: n.link,
          ...(read.items.find((o) => o.id === n.id)?.image ? { image: true as const } : {}),
        };
        added.push(n.id);
        return article;
      } catch (e) {
        console.error(e);
        failed.push(n.id);
        return null;
      }
    }),
  );
  const keepFrom = addDays(today, -NEWS_DAYS);
  const items = [...made.filter((a): a is NewsArticle => !!a), ...file.items]
    .filter((a) => a.day >= keepFrom)
    .sort((x, y) => (x.day === y.day ? x.rank - y.rank : x.day < y.day ? 1 : -1));
  const next = { made: Date.now(), items };
  // A redo that failed keeps the article as it was.
  for (const id of failed) {
    const old = read.items.find((a) => a.id === id);
    if (old && !items.some((a) => a.id === id)) items.push(old);
  }
  items.sort((x, y) => (x.day === y.day ? x.rank - y.rank : x.day < y.day ? 1 : -1));
  // Pictures for the articles that have none yet (new ones, and any a run before couldn't get).
  const uri = new Map(list.map((n) => [n.id, n.image]));
  let pics = 0;
  await Promise.all(
    items.map(async (a, k) => {
      const u = !a.image && uri.get(a.id);
      const body = u ? await storyImage(u) : null;
      if (!body) return;
      await put(imgPath(a.id), Buffer.from(body), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg" });
      items[k] = { ...a, image: true };
      pics++;
    }),
  );
  const gone = read.items.filter((a) => a.image && !items.some((b) => b.id === a.id)).map((a) => imgPath(a.id));
  if (gone.length) await del(gone).catch(() => {});
  if (added.length || pics || items.length !== read.items.length) await writeNews(next);
  return { added, failed, file: next };
}

// The voice of every sentence of these articles, asked for once through the public address (the same one
// the phone asks for), so the CDN has it. A few at a time.
export async function warmVoices(base: string, items: NewsArticle[]) {
  const urls = items.flatMap((a) => [a.title_say ?? a.title_ja, ...a.sentences.map((s) => s.say)].map((t) => ttsAddress(base, t, newsVoice())));
  let i = 0;
  let ok = 0;
  const worker = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        const res = await fetch(u, { signal: AbortSignal.timeout(40000) });
        await res.arrayBuffer();
        if (res.ok) ok++;
      } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { asked: urls.length, ok };
}

// Must match ttsUrl in lib/client/player.ts (news is never in the voice library).
function ttsAddress(base: string, text: string, voice: string) {
  return `${base}/api/tts?${new URLSearchParams({ text, voice, v: "2" })}`;
}
