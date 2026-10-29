import "server-only";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { kokoroQuestions } from "@/lib/claude";
import { readNews } from "@/lib/news";
import { addDays, type Progress } from "@/lib/progress-model";
import { readState } from "@/lib/store";
import { ANSWER_VOICE, ASK_VOICE, HINT_VOICE, PATTERNS, patternById } from "@/content/kokoro-patterns";
import { ttsUrl } from "@/lib/tts-url";
import { fixedParts, type KokoroItem, type KokoroSet } from "@/lib/kokoro-model";

// 心で答える: six questions a day about the learner's own work and life, answered in their head at work.
// Work comes from short notes a Claude routine writes each weekday morning after reading their Google
// Drive (the site itself can't reach it); life from what they told in 三回話す and the day's news.
// Each day's set is kept in Blob, so every phone gets the same one.

type Notes = { days: { day: string; notes: string[] }[] };
const NOTES = "kokoro/work.json";
const setPath = (day: string) => `kokoro/${day}.json`;

async function readJson<T>(path: string): Promise<T | null> {
  const res = await get(path, { access: "private", useCache: false }).catch((e: unknown) => {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  });
  return res?.statusCode === 200 ? ((await new Response(res.stream).json()) as T) : null;
}
const writeJson = (path: string, data: unknown) =>
  put(path, JSON.stringify(data), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });

export const readSet = (day: string) => readJson<KokoroSet>(setPath(day));

// The routine's notes for a day replace any earlier ones for it; the last five days are kept.
export async function saveNotes(day: string, notes: string[]) {
  const old = (await readJson<Notes>(NOTES)) ?? { days: [] };
  const days = [{ day, notes }, ...old.days.filter((d) => d.day !== day)].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 5);
  await writeJson(NOTES, { days });
}

function context(day: string, notes: Notes | null, p: Progress, news: string[], used: Map<string, number>, asked: string[]) {
  const work = (notes?.days ?? []).filter((d) => d.day <= day && d.day >= addDays(day, -4));
  const week = addDays(day, -7);
  const tellings = (p.retells ?? [])
    .filter((r) => r.date >= week && r.texts?.length)
    .slice(-4)
    .map((r) => `- ${r.date}「${r.topic}」：${r.texts![r.texts!.length - 1].slice(0, 160)}`);
  const date = new Date(`${day}T12:00:00+09:00`);
  const weekday = "日月火水木金土"[date.getUTCDay()];
  return `今日：${day}（${weekday}曜日）

仕事メモ（学習者の Google Drive で最近更新された資料から。新しい順）：
${work.map((d) => `- ${d.day}\n${d.notes.map((n) => `    ・${n}`).join("\n")}`).join("\n") || "（なし）"}

生活メモ（この1週間、学習者が三回話すで話したこと）：
${tellings.join("\n") || "（なし）"}

今日のニュース（NHKやさしいことばニュースの見出し。生活の質問の話題にしてもよい）：
${news.map((t) => `- ${t}`).join("\n") || "（なし）"}

この3日間に聞いた質問（同じ質問・同じ答えにしない。同じ出来事なら、その後や別の面を聞く。生活は別の話題に）：
${asked.map((q) => `- ${q}`).join("\n") || "（なし）"}

型の一覧（id：型 / 意味）と今週の使用回数：
${PATTERNS.map((x) => `- ${x.id}：${x.form} / ${x.zh}（今週 ${used.get(x.id) ?? 0} 回）`).join("\n")}`;
}

// The day's set, written once. Questions whose answer doesn't really use its 型 are dropped.
// try: a trial set from the given notes ([] = none), neither kept nor read from the saved notes.
// more: the questions a phone went through before asking for another set after the laps (it may have
// kept an older set than the one saved). A set written again the same day (this, or the morning
// routine's) leaves out those and the day's earlier ones, and keeps them as its earlier.
export async function makeSet(day: string, opts: { try?: string[]; more?: string[] } = {}): Promise<KokoroSet> {
  const lastWeek = Array.from({ length: 6 }, (_, i) => addDays(day, -(i + 1)));
  const [notes, { progress }, news, today, ...past] = await Promise.all([
    opts.try ? { days: opts.try.length ? [{ day, notes: opts.try }] : [] } : readJson<Notes>(NOTES),
    readState(),
    readNews().then((f) => f.items).catch(() => []),
    opts.try ? null : readSet(day).catch(() => null),
    ...lastWeek.map((d) => readSet(d).catch(() => null)),
  ]);
  const used = new Map<string, number>();
  for (const s of [today, ...past]) for (const it of s?.items ?? []) for (const f of it.forms) used.set(f, (used.get(f) ?? 0) + 1);
  const newest = news[0]?.day;
  const titles = news.filter((a) => a.day === newest).map((a) => a.title_ja);
  const heard = (s: KokoroSet | null) => [...(s?.items.map((it) => it.q) ?? []), ...(s?.earlier ?? [])];
  const earlier = [...new Set([...(opts.more ?? []), ...heard(today)])];
  const asked = [...earlier, ...past.slice(0, 3).flatMap(heard)];
  const drafts = await kokoroQuestions(context(day, notes, progress, titles, used, asked));
  const made = Date.now();
  const items: KokoroItem[] = [];
  for (const [i, d] of drafts.entries()) {
    const forms = d.forms.map(patternById).filter((x) => !!x);
    const fits = forms.length > 0 && forms.every((f) => fixedParts(f.form).every((part) => d.answer.includes(part)));
    items.push({
      id: `${day}-${made.toString(36)}-${i}`,
      kind: d.kind,
      q: d.q,
      q_zh: d.q_zh,
      forms: forms.map((f) => f.id),
      pattern: forms.map((f) => f.form),
      answer: d.answer,
      answer_zh: d.answer_zh,
      fits,
    });
  }
  // No 型 more than twice a day, whatever the model did.
  const seen = new Map<string, number>();
  const good = items.filter((x) => {
    if (!x.fits) return false;
    const over = x.forms.some((f) => (seen.get(f) ?? 0) >= 2);
    if (!over) for (const f of x.forms) seen.set(f, (seen.get(f) ?? 0) + 1);
    return !over;
  });
  // Six: four about work and two about life when there are work notes.
  const from = good.length >= 4 ? good : items;
  const work = from.filter((x) => x.kind === "work");
  const life = from.filter((x) => x.kind === "life");
  const nWork = Math.min(work.length, Math.max(4, 6 - life.length));
  const chosen = [...work.slice(0, nWork), ...life.slice(0, 6 - nWork)];
  const set: KokoroSet = { day, made, work: work.length > 0, items: chosen, ...(earlier.length ? { earlier } : {}) };
  if (!opts.try) await writeJson(setPath(day), set);
  return set;
}

// Every line of the day's laps asked for once, right after the set is written. This runs in Tokyo,
// so the CDN there has them all when the learner taps 聞く (a lap made from nothing took ~30 s).
// From the last line back: a phone making the lap at the same time (a set asked for after the laps)
// goes from the first, so the two meet halfway.
export async function warm(set: KokoroSet) {
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!site) return console.warn("kokoro warm: no VERCEL_PROJECT_PRODUCTION_URL");
  const t = Date.now();
  const urls = new Set(
    set.items.flatMap((it) => [ttsUrl(it.q, ASK_VOICE), ttsUrl(it.answer_zh, HINT_VOICE), ttsUrl(it.answer, ANSWER_VOICE)]),
  );
  const todo = [...urls].filter((u) => u.startsWith("/api/")).reverse().values();
  let made = 0;
  const worker = async () => {
    for (const u of todo) {
      const res = await fetch(`https://${site}${u}`).catch(() => null);
      await res?.arrayBuffer().catch(() => {});
      if (res?.ok && res.headers.get("x-vercel-cache") !== "HIT") made++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`kokoro warm: ${made} of ${urls.size} lines made in ${Date.now() - t} ms`);
}
