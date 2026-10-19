import "server-only";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { teacherPlan } from "@/lib/claude";
import { addDays, type Progress } from "@/lib/progress-model";

// 先生: once a night Opus reads the whole record and orders the weak points for the next day. The
// app's own ranking (misses minus half the hits) can't tell a duplicate tag or a speech-recognition
// slip from a real mistake; this can. Kept beside state.json and handed out with every sync.

export type Teacher = { day: string; made: number; order: string[]; hide: string[]; why_zh: string; note_zh: string };

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
function record(p: Progress, day: string) {
  const week = addDays(day, -7);
  const weak = Object.values(p.weak)
    .filter((w) => w.miss > 0)
    .sort((x, y) => (x.last < y.last ? 1 : -1))
    .slice(0, 40)
    .map(
      (w) =>
        `- tag：${w.tag}（${w.zh}）正しく ${w.hit} 回・間違い ${w.miss} 回・最後 ${w.lastMiss ?? w.last}\n${w.examples
          .slice(0, 4)
          .map((e) => `    言った：${e.said} → 正しくは：${e.better}`)
          .join("\n")}`,
    );
  const tellings = (p.retells ?? [])
    .filter((r) => r.date >= week && r.texts?.length)
    .slice(-6)
    .map((r) => `- ${r.date}「${r.topic}」\n    1回目：${r.texts![0]}\n    3回目：${r.texts![r.texts!.length - 1]}${r.next?.tag ? `\n    その日の注意：${r.next.tag}` : ""}`);
  return `今日：${day}
弱点の記録（新しい順）：
${weak.join("\n") || "（なし）"}

この1週間の「三回話す」（ラジオで聞いた話を自分の言葉で話した文字起こし）：
${tellings.join("\n") || "（なし）"}`;
}

export async function teach(p: Progress, day: string): Promise<Teacher> {
  const plan = await teacherPlan(record(p, day));
  const tags = new Set(Object.keys(p.weak));
  const order = [...new Set(plan.order)].filter((t) => tags.has(t)).slice(0, 5);
  const hide = plan.hide.filter((t) => tags.has(t) && !order.includes(t));
  const t: Teacher = { day, made: Date.now(), order, hide, why_zh: plan.why_zh, note_zh: plan.note_zh };
  await put(PATH, JSON.stringify(t), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  return t;
}
