import "server-only";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { teacherPlan } from "@/lib/claude";
import { addDays, type Progress } from "@/lib/progress-model";
import type { NewsArticle } from "@/lib/news-model";
import { readNews } from "@/lib/news";

// 老师: once a night Opus reads the whole record and orders the weak points for the next day. The
// app's own ranking (misses minus half the hits) can't tell a duplicate tag or a speech-recognition
// slip from a real mistake; this can. Kept beside state.json and handed out with every sync.

export type Good = { before: string; after: string; mark: string; zh: string };
export type Fix = { tag: string; said: string; better: string; mark: string; zh: string };
export type Memo = { day: string; good: Good | null; fix: Fix | null };
// good/fix are what 記録 and 今日 show; past is the teacher's own last notes, read back the next night
// so it can follow up instead of starting over.
// news: the article she wants told in 讲三遍 next (its id).
export type Teacher = { day: string; made: number; order: string[]; hide: string[]; why_zh: string; note_zh: string; letter_ja?: string; good?: Good | null; fix?: Fix | null; past?: Memo[]; news?: string };

const PATH = "teacher.json";

export async function readTeacher(): Promise<Teacher | null> {
  const res = await get(PATH, { access: "private", useCache: false }).catch((e: unknown) => {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  });
  return res?.statusCode === 200 ? ((await new Response(res.stream).json()) as Teacher) : null;
}

// The record as the teacher reads it: every weak point with its latest mistakes, and the last week's
// tellings in the learner's own words.
function record(p: Progress, day: string, past: Memo[], news: NewsArticle[]) {
  const week = addDays(day, -7);
  const weak = Object.values(p.weak)
    .filter((w) => w.miss > 0)
    .sort((x, y) => (x.last < y.last ? 1 : -1))
    .slice(0, 40)
    .map(
      (w) =>
        `- tag: ${w.tag} (${w.zh}) right ${w.hit} times · wrong ${w.miss} times · last ${w.lastMiss ?? w.last}\n${w.examples
          .slice(0, 4)
          .map((e) => `    said: ${e.said} → better: ${e.better}`)
          .join("\n")}`,
    );
  const tellings = (p.retells ?? [])
    .filter((r) => r.date >= week && r.texts?.length)
    .slice(-6)
    .map((r) => `- ${r.date} "${r.topic}"\n    1st telling: ${r.texts![0]}\n    3rd telling: ${r.texts![r.texts!.length - 1]}${r.next?.tag ? `\n    point that day: ${r.next.tag}` : ""}`);
  return `Today: ${day}
Weak-point record (newest first):
${weak.join("\n") || "(none)"}

This week's "tell it three times" (transcripts of her telling, in her own words, stories she heard on the radio or the news):
${tellings.join("\n") || "(none)"}

Tomorrow's news (id: headline / content):
${news.map((a) => `- ${a.id}: ${a.title_ja} / ${a.summary.join(" ")}`).join("\n") || "(none)"}

Earlier notes (what you wrote before, newest first):
${past.map((m) => `- ${m.day}${m.good ? `\n    improved: ${m.good.before} → ${m.good.after}` : ""}${m.fix ? `\n    to fix: ${m.fix.said} → ${m.fix.better} (${m.fix.tag})` : ""}`).join("\n") || "(none)"}`;
}

// A highlight the screen can find: the marked part must be inside the sentence, or nothing is marked.
const marked = <T extends { mark: string }>(x: T, whole: string): T => ({ ...x, mark: x.mark && whole.includes(x.mark) ? x.mark : "" });

export async function teach(p: Progress, day: string, last: Teacher | null = null): Promise<Teacher> {
  const past = [...(last?.good || last?.fix ? [{ day: last.day, good: last.good ?? null, fix: last.fix ?? null }] : []), ...(last?.past ?? [])]
    .filter((m) => m.day < day)
    .slice(0, 7);
  // The articles not heard yet, newest day first: the ones to be heard tomorrow.
  const kept = await readNews().then((f) => f.items).catch(() => [] as NewsArticle[]);
  const newest = kept[0]?.day;
  const news = kept.filter((a) => a.day === newest && !p.news?.[a.id]?.heard);
  const plan = await teacherPlan(record(p, day, past, news));
  const tags = new Set(Object.keys(p.weak));
  const order = [...new Set(plan.order)].filter((t) => tags.has(t)).slice(0, 5);
  const hide = plan.hide.filter((t) => tags.has(t) && !order.includes(t));
  const good = plan.good?.after.trim() ? marked(plan.good, plan.good.after) : null;
  // The fix is drilled through its weak point, so it has to be one the app still has.
  const tag = plan.fix && tags.has(plan.fix.tag) ? plan.fix.tag : order[0];
  const fix = plan.fix?.better.trim() && tag ? marked({ ...plan.fix, tag }, plan.fix.better) : null;
  const t: Teacher = { day, made: Date.now(), order, hide, why_zh: plan.why_zh, note_zh: plan.note_zh, letter_ja: plan.letter_ja, good, fix, past, ...(news.some((a) => a.id === plan.news) && { news: plan.news }) };
  await put(PATH, JSON.stringify(t), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  return t;
}
