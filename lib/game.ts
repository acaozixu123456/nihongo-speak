import "server-only";
import * as z from "zod/v4";
import { COACH, makeRadioWithClaude } from "@/lib/claude";
import { inEnglish } from "@/lib/variant";
import { LEVEL } from "@/lib/learner";
import { vertexAccess, vertexConfigured } from "@/lib/vertex-tts";

// 练一练: a short Duolingo-style round built from what the learner met in 趣味电台: words, key
// sentences, grammar and whatever they asked AI about. Each item comes with its level (0–5) from the
// spaced schedule, which decides how hard its exercises are: recognising it, then using it in new
// sentences, then saying it. Sentences are new every round, so nothing is passed by memorising answers.
// Written in small parallel batches so a round is ready in seconds: Gemini on Vertex AI (paid from the
// Google Cloud credit) first, Haiku when that fails.
const GameSchema = z.object({
  questions: z
    .array(
      z.object({
        kind: z
          .enum(["meaning", "listen", "reading", "pick", "judge", "fill", "order", "dictate", "say"])
          .describe(
            "meaning: see the English, pick the Chinese meaning. listen: hear the audio only, pick the Chinese meaning. pick: see the Chinese, pick the English. fill: pick what goes in the blank (___) of an English sentence in a new situation (TOEIC Part 5 style). order: see the Chinese, put English pieces in order. say: see the Chinese, say the English out loud. reading: see a word, pick its right pronunciation in IPA (word items only). judge: decide whether an English sentence using the item is natural or not (about half should be a typical misuse). dictate: hear the audio only, put the heard sentence together from pieces",
          ),
        about: z.string().describe("The item this question practises. Copy the item's ja exactly"),
        ja: z.string().describe("meaning/listen/reading/judge/dictate: the English shown or read (reading: the word itself; dictate: the sentence read, same as answer). fill: a sentence from a new everyday or workplace situation with exactly one ___. Otherwise empty"),
        zh: z.string().describe("pick/order/say: the Chinese shown. fill/judge/dictate: the sentence's Chinese translation (for an unnatural judge sentence, what it meant to say). meaning/listen/reading: empty"),
        answer: z.string().describe("The right answer. meaning/listen: Chinese. pick/fill: English. order/say/dictate: the whole English sentence. reading: IPA. judge: 自然 or 不自然"),
        options: z
          .array(z.string())
          .describe("meaning/listen/pick/fill: 3 plausible wrong choices (same language and about the same length as the answer). reading: 3 confusable pronunciations (wrong stress, wrong vowel, l/r). judge: for an unnatural sentence, [the right English sentence], for a natural one empty. order/dictate: 1-2 confusing extra pieces. say: empty"),
        tiles: z.array(z.string()).describe("order/dictate only: answer cut in order into 3-6 pieces (joined with spaces they give answer exactly). Otherwise empty"),
        explain_zh: z.string().describe("One-line note shown after answering (Chinese, 1 sentence: why, or a tip for using it)"),
      }),
    )
    .describe("Exactly 2 questions per item"),
});

export type Game = z.infer<typeof GameSchema>;

export type GameItem = { ja: string; zh: string; kind: string; note?: string; level: number };

const SYSTEM = `${COACH}
Turn the words, key phrases, grammar and parts she asked about from her listening into a game, so she really understands them and can use them herself. Pick the question format by each item's level (0-5):
- Level 0-1 (new or still shaky): meaning, listen, reading (words) to check meaning and sound, and pick for the other question.
- Level 2-3: one of fill, order, judge, dictate, using it in a new situation.
- Level 4-5: say (she says it herself) and dictate or listen.
Mix as many formats as possible overall. For order, dictate and say, answer is one sentence (8-15 words).
The two questions of one item must use different formats (meaning → use, from different angles).
- Items of kind weak are grammar points or expressions she kept getting wrong when speaking (the note has her real mistake and the right way). Whatever the level, pick 2 of fill, judge, order, say, and make her use that grammar correctly herself. In judge, show the misuse she tends to make and say in explain_zh in one line why it is wrong.
- Sentences for fill, order and say are not copies of the original but short new sentences from her shop work or daily life (${LEVEL}). fill may look like a TOEIC Part 5 question.
- Wrong choices are typical confusions (similar words, similar patterns, wrong preposition or tense, similar Chinese meanings). Nothing obviously unrelated.
- Chinese is Simplified. zh, explain_zh, and the answer and options of meaning/listen must be Chinese only (English in them gives the answer away). Quote English words in 「」.`;

const prompt = (topic: string | undefined, items: GameItem[]) => `${topic ? `Show's topic: ${topic}\n` : ""}Items:
${items.map((x) => `- [${x.kind} · level ${x.level}] ${x.ja}${x.note ? ` (${x.note})` : ""}: ${x.zh}`).join("\n")}`;

const MODEL = "gemini-3.8-flash";

// Thinking is kept low: these are short, well-specified exercises, and a round should be ready in seconds.
async function withGemini(content: string, think = true): Promise<Game> {
  const { project, token } = await vertexAccess();
  const { $schema, ...schema } = z.toJSONSchema(GameSchema) as Record<string, unknown>;
  void $schema;
  const res = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: content }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          temperature: 0.9,
          ...(think ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
        },
      }),
      signal: AbortSignal.timeout(22000),
    },
  );
  if (res.status === 400 && think) return withGemini(content, false);
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  type Reply = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const reply = (await res.json()) as Reply;
  const text = (reply.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("");
  return GameSchema.parse(JSON.parse(text));
}

type Batch = { questions: Game["questions"]; by: string };

async function batch(topic: string | undefined, items: GameItem[]): Promise<Batch> {
  const content = prompt(topic, items);
  const t = Date.now();
  // The model sometimes copies an item with its note; point each question back at the item itself.
  // A Chinese prompt or choice with English in it gives the answer away; such a question is dropped.
  const zhOk = (q: Game["questions"][number]) =>
    !inEnglish(q.explain_zh) &&
    !inEnglish(q.zh, 2) &&
    (q.kind !== "meaning" && q.kind !== "listen" ? true : ![q.answer, ...q.options].some((x) => inEnglish(x, 2)));
  const fix = (qs: Game["questions"]) =>
    qs.filter(zhOk).map((q) => ({ ...q, about: items.find((x) => q.about === x.ja || q.about.startsWith(x.ja) || q.about.includes(x.ja))?.ja ?? q.about }));
  if (vertexConfigured()) {
    try {
      return { questions: fix((await withGemini(content)).questions), by: `gemini ${Date.now() - t}ms` };
    } catch (e) {
      console.warn("game: Gemini failed, using Claude", e);
    }
  }
  return { questions: fix((await makeRadioWithClaude(GameSchema, SYSTEM, content)).questions), by: `claude ${Date.now() - t}ms` };
}

const BATCH = 2;
// Easy kinds first, as in a lesson.
const RANK = { meaning: 0, listen: 0, reading: 0, pick: 1, judge: 2, fill: 2, order: 3, dictate: 3, say: 4 } as const;

// by: which model wrote each batch and how long it took, for checking speed from outside.
export async function makeGame(a: { topic?: string; items: GameItem[] }): Promise<Game & { by: string[] }> {
  const groups: GameItem[][] = [];
  for (let i = 0; i < a.items.length; i += BATCH) groups.push(a.items.slice(i, i + BATCH));
  const done = await Promise.allSettled(groups.map((g) => batch(a.topic, g)));
  const questions = done.flatMap((r) => (r.status === "fulfilled" ? r.value.questions : []));
  if (!questions.length) throw new Error((done.find((r) => r.status === "rejected") as PromiseRejectedResult)?.reason?.message ?? "出题失败");
  // Within each kind, spread one item's questions apart.
  const shuffled = questions.map((q) => ({ q, r: Math.random() })).sort((x, y) => RANK[x.q.kind] - RANK[y.q.kind] || x.r - y.r);
  return { questions: shuffled.map((x) => x.q), by: done.map((r) => (r.status === "fulfilled" ? r.value.by : "failed")) };
}
