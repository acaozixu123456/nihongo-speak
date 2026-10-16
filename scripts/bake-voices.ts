// Records every fixed sentence ahead of time into public/voice/, so the app keeps its HD voices
// and plays fixed content without Azure (for example after the Azure trial ends). Content that is
// written on the fly (AI replies, feedback, the daily podcast) is still synthesized on demand.
//
//   npx tsx scripts/bake-voices.ts [site] [--redo-ja] [--max=80] [--lite] [--batch]     (default https://nihongo-speak.vercel.app)
//
// Japanese sentences are recorded with Gemini TTS straight from here when GEMINI_API_KEY is set;
// everything else, and Japanese without the key, goes through the site. --redo-ja re-records the
// existing Japanese files that scripts/gemini-recorded.txt doesn't list yet. Gemini allows 100
// requests a day, so --max caps how many this run uses (the app needs some too) and a run stops
// asking Gemini once the day's quota is gone; run it again the next day to continue, or use --lite
// (Gemini Flash-Lite TTS, which has a quota of its own). --batch sends all the Japanese sentences
// as one Batch API job instead: half the price, no daily quota, done in minutes.
//
// The site is asked with only the first voice of a list, so
// an HD voice that fails is an error here instead of a quiet fallback to the standard voice.
// Files already recorded are kept; files no longer used are removed. Then lib/voice-library.ts
// is rewritten so the app knows which sentences have a recording.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "../content/calls";
import { listenIntro, NARRATION, ZH_VOICE } from "../content/narration";
import { scenarios } from "../content/scenarios";
import { FLASH, FLASH_LITE, geminiConfigured, geminiVoice, synthesizeGemini, synthesizeGeminiBatch } from "../lib/gemini-tts";
import { voiceKey } from "../lib/voice-key";

const args = process.argv.slice(2);
const site = args.find((a) => !a.startsWith("--")) ?? "https://nihongo-speak.vercel.app";
const redoJa = args.includes("--redo-ja");
const model = args.includes("--lite") ? FLASH_LITE : FLASH;
const batch = args.includes("--batch");
const maxGemini = Number(args.find((a) => a.startsWith("--max="))?.slice(6) ?? Infinity);
const dir = join(__dirname, "..", "public", "voice");
const geminiLog = join(__dirname, "gemini-recorded.txt");
const recordedWithGemini = new Set(existsSync(geminiLog) ? readFileSync(geminiLog, "utf8").split("\n").filter(Boolean) : []);

const items = new Map<string, { text: string; voice: string }>();
const add = (text: string, voice: string) => items.set(voiceKey(text, voice), { text, voice });

for (const s of scenarios) {
  for (const l of s.lines) {
    add(l.ja, l.voice);
    add(l.zh, ZH_VOICE);
  }
  add(s.talk.opening.ja, s.talk.aiVoice);
  add(listenIntro(s.titleZh), ZH_VOICE);
}
for (const c of calls) add(c.talk.opening.ja, c.talk.aiVoice);
for (const line of Object.values(NARRATION)) add(line, ZH_VOICE);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gemini TTS allows 10 requests a minute on the first paid tier, so its requests are spaced out.
let nextGemini = 0;
let geminiQuotaGone = false;
let geminiUsed = 0;
async function geminiTurn() {
  const at = Math.max(Date.now(), nextGemini);
  nextGemini = at + 6500;
  await wait(at - Date.now());
}

async function record(text: string, voice: string) {
  const gemini = geminiConfigured() ? geminiVoice(voice) : null;
  if (gemini) {
    for (let attempt = 1; ; attempt++) {
      await geminiTurn();
      try {
        return await synthesizeGemini(text, gemini, 60000, model);
      } catch (e) {
        // The daily quota won't come back today; anything else gets a few spaced-out tries.
        if (String(e).includes("(daily quota)")) {
          geminiQuotaGone = true;
          throw e;
        }
        if (attempt >= 6) throw e;
      }
    }
  }
  const url = `${site}/api/tts?${new URLSearchParams({ text, voice: voice.split("|")[0] })}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.ok && buf.length > 1000) return buf;
    if (attempt >= 6) throw new Error(`${res.status} for ${voice}: ${text}`);
    await wait(attempt * 5000);
  }
}

async function main() {
  mkdirSync(dir, { recursive: true });
  const useGemini = (voice: string) => geminiConfigured() && geminiVoice(voice) !== null;
  const redo = (key: string, voice: string) => redoJa && useGemini(voice) && !recordedWithGemini.has(key);
  const todo = [...items].filter(([key, { voice }]) => redo(key, voice) || !existsSync(join(dir, `${key}.mp3`)));
  console.log(`${items.size} sentences, ${todo.length} to record`);
  let done = 0;
  let failed = 0;
  if (batch) {
    const jobs = todo.filter(([, { voice }]) => useGemini(voice)).slice(0, maxGemini);
    console.log(`sending ${jobs.length} to the Gemini Batch API`);
    const got = await synthesizeGeminiBatch(
      jobs.map(([key, { text, voice }]) => ({ key, text, voice: geminiVoice(voice)! })),
      model,
    );
    for (const [key] of jobs) {
      const mp3 = got.get(key);
      if (!mp3) {
        failed++;
        console.error(`no audio from the batch for ${key}`);
        continue;
      }
      writeFileSync(join(dir, `${key}.mp3`), mp3);
      appendFileSync(geminiLog, `${key}\n`);
      done++;
    }
    geminiQuotaGone = true; // the rest of the run leaves Japanese alone
  }
  const worker = async () => {
    for (let next = todo.shift(); next; next = todo.shift()) {
      const [key, { text, voice }] = next;
      const gemini = useGemini(voice);
      if (gemini && (geminiQuotaGone || geminiUsed >= maxGemini)) continue;
      if (gemini) geminiUsed++;
      try {
        writeFileSync(join(dir, `${key}.mp3`), await record(text, voice));
        if (gemini) appendFileSync(geminiLog, `${key}\n`);
        if (++done % 25 === 0) console.log(`${done} recorded`);
      } catch (e) {
        failed++;
        console.error(String(e));
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  let bytes = 0;
  for (const f of readdirSync(dir)) {
    const key = f.replace(/\.mp3$/, "");
    if (!items.has(key)) unlinkSync(join(dir, f));
    else bytes += statSync(join(dir, f)).size;
  }
  const have = [...items.keys()].filter((key) => existsSync(join(dir, `${key}.mp3`))).sort();
  writeFileSync(
    join(__dirname, "..", "lib", "voice-library.ts"),
    `// Generated by scripts/bake-voices.ts: the recordings in public/voice/.\nexport const VOICE_LIBRARY = new Set<string>(${JSON.stringify(have.join(" "))}.split(" "));\n`,
  );
  console.log(`recorded ${done}, failed ${failed}; library has ${have.length} of ${items.size} (${(bytes / 1e6).toFixed(1)} MB)`);
}

main();
