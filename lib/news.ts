import "server-only";
import { delKeys, getBytes, getJson, setBytes, setJson } from "@/lib/kv";
import { newsNotes, newsPick } from "@/lib/claude";
import { readState } from "@/lib/store";
import { addDays } from "@/lib/progress-model";
import { NEWS_DAYS, newsVoice, type NewsArticle, type Seg } from "@/lib/news-model";
import type { NewsMark } from "@/lib/progress-model";
import { nhkArticle, nhkImage, nhkList, nhkSession, plain, spoken, spokenAll, withReadings } from "@/lib/nhk";

// Every evening (cron, 21:00 JST, 8:30 as a backup) one of the day's NHKやさしいことばニュース articles is
// picked, given our notes and kept in one Redis value the phone reads through /api/news. Their sentences are then
// asked for once from our own /api/tts, so the CDN holds the voice before the train.

const PATH = "news/articles.json";
export type NewsFile = { made: number; items: NewsArticle[] };

export async function readNews(): Promise<NewsFile> {
  return (await getJson<NewsFile>(PATH)) ?? { made: 0, items: [] };
}

// NHK's picture for each article, kept as long as the article (it needs NHK's session, so the phone can't
// get it from NHK itself).
const imgPath = (id: string) => `news/img/${id}.jpg`;

export async function readNewsImage(id: string): Promise<ArrayBuffer | null> {
  const b = await getBytes(imgPath(id)).catch(() => null);
  return b ? new Uint8Array(b).buffer : null;
}

async function writeNews(f: NewsFile) {
  await setJson(PATH, f);
}

// One article a day: of the day's NHK articles, the one the AI finds most useful for this learner (everyday
// topic, everyday words, not too long), else the shortest with the fewest names.
const weight = (sentences: { segs: Seg[] }[]) => {
  const segs = sentences.flatMap((x) => x.segs);
  return Math.abs(plain(segs).length - 300) + 40 * segs.filter((x) => x.name).length;
};

async function best(cands: { title: string; sentences: { segs: Seg[] }[] }[], recent: string[]): Promise<number> {
  if (cands.length < 2) return 0;
  const k = await newsPick(cands.map((c) => ({ title: c.title, text: c.sentences.map((x) => plain(x.segs)).join("") })), recent).catch((e) => (console.error(e), -1));
  if (k >= 0 && k < cands.length) return k;
  const w = cands.map((c) => weight(c.sentences));
  return w.indexOf(Math.min(...w));
}

// Days kept from before with several articles keep one: the one the learner did most with, else the best.
async function onePerDay(items: NewsArticle[], marks: Record<string, NewsMark> = {}): Promise<NewsArticle[]> {
  const done = (a: NewsArticle) => {
    const m = marks[a.id];
    return m ? (m.told ? 100 : 0) + (m.full ? 50 : 0) + Object.keys(m.said ?? {}).length * 5 + (m.heard ? 10 : 0) + (m.miss?.length ?? 0) : 0;
  };
  const days = [...new Set(items.map((a) => a.day))];
  return Promise.all(
    days.map(async (day) => {
      const all = items.filter((a) => a.day === day).sort((x, y) => x.rank - y.rank);
      const most = Math.max(...all.map(done));
      if (most > 0) return all.find((a) => done(a) === most)!;
      return all[await best(all.map((a) => ({ title: a.title_ja, sentences: a.sentences })), [])];
    }),
  );
}

const byDay = (x: NewsArticle, y: NewsArticle) => (x.day < y.day ? 1 : x.day > y.day ? -1 : 0);

// The last few days NHK put out that have no article kept yet each get one, picked from that day's and made
// (a failed day is tried again next time). Old ones are dropped. redo: make the kept ones of those days again
// (after the notes or the voice text changed).
export async function refreshNews(today: string, opts: { days?: number; redo?: boolean } = {}): Promise<{ added: string[]; failed: string[]; file: NewsFile }> {
  const read = await readNews();
  const s = await nhkSession();
  const list = await nhkList(s);
  const from = addDays(today, -(opts.days ?? 3));
  const marks = await readState().then((st) => st.progress.news).catch(() => undefined);
  const kept = (await onePerDay(read.items.filter((a) => a.day >= addDays(today, -NEWS_DAYS)), marks)).sort(byDay);
  const recent = kept.slice(0, 7).map((a) => a.title_ja);
  const added: string[] = [];
  const failed: string[] = [];
  const days = [...new Set(list.filter((n) => n.day >= from).map((n) => n.day))];
  const made = await Promise.all(
    days.map(async (day): Promise<NewsArticle | null> => {
      const have = kept.find((a) => a.day === day);
      if (have && !(opts.redo && list.some((n) => n.id === have.id))) return null;
      const cands = list.filter((n) => (have ? n.id === have.id : n.day === day));
      const got = (await Promise.all(cands.map((n) => nhkArticle(s, n.id).then((a) => ({ n, a }), (e) => (console.error(e), null))))).filter((x) => !!x);
      if (!got.length) {
        failed.push(...cands.map((n) => n.id));
        return null;
      }
      const flats = got.map(({ a }) => a.paras.flatMap((p) => p.map((segs, i) => ({ segs, p: i === 0 }))));
      const k = await best(got.map(({ a }, i) => ({ title: plain(a.title), sentences: flats[i] })), recent);
      const { n, a } = got[k];
      const flat = flats[k];
      try {
        const notes = await newsNotes(withReadings(a.title), flat.map((x) => withReadings(x.segs)));
        const zh = new Map(notes.zh.map((z) => [Math.round(z.n), z.zh]));
        added.push(n.id);
        return {
          id: n.id,
          day: n.day,
          at: n.at,
          rank: n.rank,
          title: a.title,
          title_ja: plain(a.title),
          title_say: spokenAll(a.title),
          title_zh: notes.title_zh,
          sentences: flat.map((x, i) => ({ segs: x.segs, ja: plain(x.segs), say: spoken(x.segs), zh: zh.get(i + 1) ?? "", ...(x.p && i > 0 ? { p: true as const } : {}) })),
          words: notes.words,
          keys: notes.keys,
          summary: notes.summary,
          url: a.url,
          ...(have?.image ? { image: true as const } : {}),
        };
      } catch (e) {
        console.error(e);
        failed.push(n.id);
        return null;
      }
    }),
  );
  const keepFrom = addDays(today, -NEWS_DAYS);
  const fresh = made.filter((a): a is NewsArticle => !!a);
  // A redo that failed keeps the article as it was.
  const items = [...fresh, ...kept.filter((a) => !fresh.some((b) => b.day === a.day))].filter((a) => a.day >= keepFrom).sort(byDay);
  // Pictures for the articles that have none yet (new ones, and any a run before couldn't get).
  const uri = new Map(list.map((n) => [n.id, n.image]));
  let pics = 0;
  await Promise.all(
    items.map(async (a, k) => {
      const u = !a.image && uri.get(a.id);
      const body = u ? await nhkImage(s, u) : null;
      if (!body) return;
      await setBytes(imgPath(a.id), Buffer.from(body), NEWS_DAYS + 7);
      items[k] = { ...a, image: true };
      pics++;
    }),
  );
  const next = { made: Date.now(), items };
  const gone = read.items.filter((a) => a.image && !items.some((b) => b.id === a.id)).map((a) => imgPath(a.id));
  if (gone.length) await delKeys(gone).catch(() => {});
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
  const kanjiOnly = !/[\u3040-\u30f5\u30f7-\u30fa\u30fd-\u30ff]/.test(text);
  return `${base}/api/tts?${new URLSearchParams({ text, voice, v: "2", ...(kanjiOnly ? { yomi: "3" } : {}) })}`;
}
