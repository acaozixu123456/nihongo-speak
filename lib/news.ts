import "server-only";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { newsNotes } from "@/lib/claude";
import { addDays } from "@/lib/progress-model";
import { NEWS_DAYS, NEWS_VOICE, type NewsArticle } from "@/lib/news-model";
import { nhkArticle, nhkList, nhkSession, plain, spoken, withReadings } from "@/lib/nhk";

// Every morning (cron, 8:30 JST) the newest NHKやさしいことばニュース articles are fetched, given our
// notes and kept in one private Blob file the phone reads through /api/news. Their sentences are then
// asked for once from our own /api/tts, so the CDN holds the voice before the train.

const PATH = "news/articles.json";
export type NewsFile = { made: number; items: NewsArticle[] };

export async function readNews(): Promise<NewsFile> {
  const res = await get(PATH, { access: "private", useCache: false }).catch((e: unknown) => {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  });
  return res?.statusCode === 200 ? ((await new Response(res.stream).json()) as NewsFile) : { made: 0, items: [] };
}

async function writeNews(f: NewsFile) {
  await put(PATH, JSON.stringify(f), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
}

// The articles of the last few days NHK put out that aren't kept yet, made one by one (a failed one is
// tried again next time). Old ones are dropped.
export async function refreshNews(today: string, opts: { days?: number } = {}): Promise<{ added: string[]; failed: string[]; file: NewsFile }> {
  const file = await readNews();
  const s = await nhkSession();
  const list = await nhkList(s);
  const from = addDays(today, -(opts.days ?? 3));
  const have = new Set(file.items.map((a) => a.id));
  const todo = list.filter((n) => n.day >= from && !have.has(n.id));
  const added: string[] = [];
  const failed: string[] = [];
  const made = await Promise.all(
    todo.map(async (n) => {
      try {
        const a = await nhkArticle(s, n.id);
        const flat = a.paras.flatMap((p) => p.map((segs, i) => ({ segs, p: i === 0 })));
        const notes = await newsNotes(withReadings(a.title), flat.map((x) => withReadings(x.segs)));
        const zh = new Map(notes.zh.map((z) => [Math.round(z.n), z.zh]));
        const article: NewsArticle = {
          id: n.id,
          day: n.day,
          at: n.at,
          rank: n.rank,
          title: a.title,
          title_ja: plain(a.title),
          title_zh: notes.title_zh,
          sentences: flat.map((x, i) => ({ segs: x.segs, ja: plain(x.segs), say: spoken(x.segs), zh: zh.get(i + 1) ?? "", ...(x.p && i > 0 ? { p: true as const } : {}) })),
          words: notes.words,
          keys: notes.keys,
          summary: notes.summary,
          url: a.url,
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
  if (added.length || items.length !== file.items.length) await writeNews(next);
  return { added, failed, file: next };
}

// The voice of every sentence of these articles, asked for once through the public address (the same one
// the phone asks for), so the CDN has it. A few at a time.
export async function warmVoices(base: string, items: NewsArticle[]) {
  const urls = items.flatMap((a) => [a.title_ja, ...a.sentences.map((s) => s.say)].map((t) => ttsAddress(base, t)));
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
function ttsAddress(base: string, text: string) {
  const kanjiOnly = !/[\u3040-\u30f5\u30f7-\u30fa\u30fd-\u30ff]/.test(text);
  return `${base}/api/tts?${new URLSearchParams({ text, voice: NEWS_VOICE, v: "2", ...(kanjiOnly ? { yomi: "3" } : {}) })}`;
}
