import "server-only";
import { drillSentences } from "@/lib/claude";
import { aboutNow, readJson, writeJson } from "@/lib/kokoro";
import { ANSWER_VOICE, HINT_VOICE, patternById } from "@/content/kokoro-patterns";
import { fixedParts } from "@/lib/kokoro-model";
import { DRILL_SIZE, type Drill } from "@/lib/drill-model";
import { ttsUrl } from "@/lib/tts-url";

// A 型's drill for the day, written once and kept in Blob, so it's the same on every phone.
const path = (day: string, form: string) => `drill/${day}-${form}.json`;

export const readDrill = (day: string, form: string) => readJson<Drill>(path(day, form));

export async function makeDrill(day: string, form: string): Promise<Drill> {
  const p = patternById(form);
  if (!p) throw new Error("没有这个型");
  const drafts = await drillSentences(await aboutNow(day), p.form, p.zh);
  const parts = fixedParts(p.form);
  // Sentences that dropped part of the 型 are left out; the spares make up for them.
  const fit = drafts.filter((d) => d.ja.trim() && d.zh.trim() && parts.every((x) => d.ja.includes(x)));
  const items = (fit.length >= 8 ? fit : drafts).slice(0, DRILL_SIZE).map((d) => ({ ja: d.ja.trim(), zh: d.zh.trim() }));
  const drill: Drill = { day, made: Date.now(), form, pattern: p.form, zh: p.zh, items };
  await writeJson(path(day, form), drill);
  return drill;
}

// Every line asked for once from Tokyo right after the drill is written, so the CDN there has them
// when the phone makes the round (as 心で答える's warm). From the last line back, so the two meet.
export async function warmDrill(d: Drill) {
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!site) return;
  const urls = [...new Set(d.items.flatMap((it) => [ttsUrl(it.zh, HINT_VOICE), ttsUrl(it.ja, ANSWER_VOICE)]))].filter((u) => u.startsWith("/api/")).reverse();
  const todo = urls.values();
  const worker = async () => {
    for (const u of todo) {
      const res = await fetch(`https://${site}${u}`).catch(() => null);
      await res?.arrayBuffer().catch(() => {});
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
