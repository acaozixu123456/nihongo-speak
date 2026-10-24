import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { Scenario } from "@/content/scenarios";
import { LEARNER, LEVEL } from "@/lib/learner";
import { englishZh, inEnglish, variantOk, zhIsTranslation } from "@/lib/variant";

// Only the role-play part of a scenario is needed here.
type Talk = Pick<Scenario, "talk">;

// The fields keep the names of the Japanese app this one was made from: `ja` is the English line, `kana`
// a pronunciation help (IPA for a single word, else empty).

// Haiku for quick plumbing (replies, titles). Judging the learner's English goes to Opus: it decides what
// they learn. effort low where they wait on every line, medium for one review of a whole telling. Opus
// thinks inside max_tokens, so its calls get extra room.
const MODEL = "claude-haiku-5-5";
const SMART = "claude-opus-5-5";
type Effort = "low" | "medium" | "high";
const smart = (maxTokens: number) => ({ model: SMART, max_tokens: maxTokens + 12000 });
// A key created outside any workspace must name one on every request.
const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
const client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});

// The instructions are in English, so the model drifts into English in the Chinese fields: every call ends with this.
const ZH_RULE = `

[Output language] Fields whose names are zh or end in _zh / Zh (comments, explanations, reasons, translations) must be written in Simplified Chinese, never in English. English words being discussed may be quoted inside 「」.
English fields (ja, better, examples, rewrites) stay in English.`;
// …and still writes some of them in English now and then. Such an answer is asked for once more, with
// the fields named; the second answer is used only if it is better. Long writing (radio scripts,
// scenarios) isn't asked again: it would not fit in the request's time.
const parse: typeof client.messages.parse = (async (params: Parameters<typeof client.messages.parse>[0], options?: Parameters<typeof client.messages.parse>[1]) => {
  const system = `${params.system ?? ""}${ZH_RULE}`;
  const first = await client.messages.parse({ ...params, system }, options);
  const bad = params.model === MODEL && params.max_tokens > 4000 ? [] : englishZh(first.parsed_output);
  if (!bad.length) return first;
  console.warn("Chinese fields in English, asking again:", bad.join(" "));
  const again = await client.messages
    .parse({ ...params, system: `${system}\nLast time you wrote ${bad.join(", ")} in English. These must be in Simplified Chinese.` }, options)
    .catch(() => null);
  return again && englishZh(again.parsed_output).length < bad.length ? again : first;
}) as unknown as typeof client.messages.parse;

export type Turn = { role: "user" | "assistant"; text: string };

export function roleplaySystem(s: Talk) {
  return `You are a conversation partner for English speaking practice. ${LEARNER}

Situation: ${s.talk.setup}
Your role: ${s.talk.aiRole}
The learner's role: ${s.talk.userRole}

Rules:
- Stay in role and talk the way people really talk in this situation. Avoid textbook-stiff English.
- 1-3 sentences per turn. Leave the learner plenty of turns to speak.
- Keep vocabulary and grammar around ${LEVEL}, but keep it natural (contractions and common phrasal verbs are fine).
- Don't correct the learner's English inside the conversation. If you can't understand, ask again the way a real person would.
- The learner's lines come from speech recognition; fill in small recognition slips from context.
- When the purpose of the scene is naturally done, close the conversation with one line.`;
}

function toMessages(history: Turn[]): Anthropic.MessageParam[] {
  // The API needs a user turn first; the scenario opens with the AI speaking.
  return [
    { role: "user", content: "(Please start the conversation.)" },
    ...history.map((t) => ({ role: t.role, content: t.text })),
  ];
}

function checkStop(stop: string | null) {
  if (stop === "refusal") throw new Error("模型拒绝了这次请求，请换个说法再试");
}

const ReplySchema = z.object({
  ja: z.string().describe("Your reply in role, in English"),
  zh: z.string().describe("A natural Chinese translation of the reply"),
  finished: z.boolean().describe("true when the scene's conversation is over"),
});

export async function roleplayReply(s: Talk, history: Turn[]) {
  const res = await parse({
    model: MODEL,
    max_tokens: 2000,
    system: roleplaySystem(s),
    messages: toMessages(history),
    output_config: { format: zodOutputFormat(ReplySchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  return res.parsed_output;
}

const HintSchema = z.object({
  suggestions: z
    .array(z.object({ ja: z.string(), zh: z.string() }))
    .describe("2-3 things the learner could say next, in English. Shortest and easiest to say first"),
});

export async function hint(s: Talk, history: Turn[], wantZh?: string) {
  const ask = wantZh
    ? `The learner wants to say this next (in Chinese): "${wantZh}". Suggest natural ways to say it in English in this situation.`
    : "The learner is stuck and doesn't know what to say next. Suggest natural replies for this situation.";
  const res = await parse({
    model: MODEL,
    max_tokens: 2000,
    system: `${roleplaySystem(s)}

Right now you step outside the conversation and help as the learner's coach. Do not answer in role.`,
    messages: [...toMessages(history), { role: "user", content: ask }],
    output_config: { format: zodOutputFormat(HintSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  return res.parsed_output;
}

// After a conversation: one thing to fix next time, with the line that shows it, and one phrase to
// keep. Not a list: the learner acts on one point, and that point goes into the weak points.
const FeedbackSchema = z.object({
  overall_zh: z.string().describe("One-sentence comment in Chinese. Start by recognising what she managed to say"),
  focus_zh: z.string().describe("The single most important thing to fix next time (Chinese, 1-2 sentences). Concretely what to say and how"),
  fix: z.object({
    you_said: z.string().describe("The English the learner actually said that best shows focus_zh. Empty if none"),
    better: z.string().describe("A more natural way to say it in this situation. Empty if you_said is empty"),
    zh: z.string().describe("Chinese translation of better (Simplified). Only the translation, no explanation: it is used to recall the English from Chinese. Empty if better is empty"),
    why_zh: z.string().describe("Why it is said that way (Chinese, short). Empty if none"),
  }),
  point: z.object({
    tag: z.string().describe("Name of the grammar point or expression behind focus_zh (English, short). E.g. 'Could you ...? (requests)', 'present perfect: have done', 'articles: a / the'. Empty if it isn't a grammar point or expression"),
    zh: z.string().describe("What that grammar point or expression is (Chinese, 1 sentence). Empty if tag is empty"),
  }),
  phrases: z.array(z.object({ ja: z.string(), reading: z.string().describe("Leave empty"), zh: z.string() })).describe("Exactly one expression she can use again in this situation"),
  memory_ja: z
    .string()
    .describe("Something learned about the learner that the other person could bring up in the next call (English, 1-2 sentences: plans, circumstances, likes). Empty if nothing"),
});

const knownLine = (known?: string[]) =>
  known?.length ? `\nTags already used in the learner's weak-point record: ${known.join(" / ")}\nIf it is the same grammar point or expression, use exactly that tag.` : "";

export async function feedback(s: Talk, history: Turn[], known?: string[]) {
  const transcript = history.map((t) => `${t.role === "user" ? "Learner" : "Partner"}: ${t.text}`).join("\n");
  const res = await parse({
    ...smart(4000),
    system: `You are an English speaking coach. ${LEARNER}
Situation: ${s.talk.setup}
The learner's role: ${s.talk.userRole}

Read the conversation and pick exactly one thing the learner should fix next time.
- The learner's lines come from speech recognition. Don't point out what look like recognition slips.
- Pick the one with the biggest effect (errors that block meaning > politeness that doesn't fit > unnatural phrasing > could be said more simply). Don't write about the others.
- Explain in Chinese, concretely.${knownLine(known)}`,
    messages: [{ role: "user", content: transcript }],
    output_config: { effort: "medium", format: zodOutputFormat(FeedbackSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  const f = res.parsed_output;
  return { ...f, fix: { ...f.fix, zh: await cardZh(f.fix.better, f.fix.zh) } };
}

// The Chinese a saved sentence is reviewed from. Haiku sometimes writes a note about the mistake
// instead of a translation; ask once for just the translation, and give up (no card) if that fails too.
const TranslationSchema = z.object({ zh: z.string().describe("Simplified Chinese translation. Only the translation: no notes, no English") });
async function cardZh(en: string, zh: string) {
  if (!en || zhIsTranslation(zh)) return en ? zh : "";
  try {
    const t = await haikuFirst(TranslationSchema, "Translate the English sentence into natural Simplified Chinese.", en, 300);
    return zhIsTranslation(t.zh) ? t.zh : "";
  } catch {
    return "";
  }
}

export type Reply = z.infer<typeof ReplySchema>;
export type Hint = z.infer<typeof HintSchema>;
export type Feedback = z.infer<typeof FeedbackSchema>;

// ---- AI-written scenarios ----

const GeneratedSchema = z.object({
  title: z.string().describe("English title of the scene (6 words at most)"),
  titleZh: z.string().describe("Chinese title of the scene (15 characters at most)"),
  icon: z.string().describe("One emoji for the scene"),
  summaryZh: z.string().describe("What the scene is (Chinese, 1 sentence)"),
  characters: z
    .array(z.object({ name: z.string(), gender: z.enum(["male", "female"]) }))
    .describe("2-3 characters, including the one the learner plays"),
  lines: z
    .array(
      z.object({
        speaker: z.string().describe("One of the characters' names"),
        ja: z.string().describe("The line, in English"),
        kana: z.string().describe("Leave empty"),
        zh: z.string().describe("Natural Chinese translation"),
      }),
    )
    .describe("The scene's conversation, 10-14 lines"),
  talk: z.object({
    aiRole: z.string().describe("The role the AI plays in the role-play and how they talk (English)"),
    aiCharacter: z.string().describe("Name of the character the AI plays"),
    userRole: z.string().describe("The learner's role (English)"),
    goalZh: z.string().describe("What the learner achieves in the role-play (Chinese, 1-2 sentences)"),
    setup: z.string().describe("The role-play situation, including how the AI moves it along (English, 2-4 sentences)"),
    opening: z.object({ ja: z.string(), zh: z.string() }).describe("The AI's first line"),
  }),
});

export type Generated = z.infer<typeof GeneratedSchema>;

export type Photo = { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };

// `topic` is either a situation to practise or what happened when the learner couldn't get the words out;
// `photo` is a picture from their day (a sign, a menu, an email) to build the scene around.
export async function generateScenario(topic: string, category: "work" | "life", photo?: Photo) {
  const res = await parse({
    model: MODEL,
    max_tokens: 16000,
    system: `You write English listening and speaking material. ${LEARNER}
Write material for a situation the learner really meets ${category === "work" ? "at work in the shop" : "in daily life"}.
- The conversation sounds like real ${category === "work" ? "shop-floor and workplace" : "everyday"} English, not a textbook.
- Vocabulary and grammar around ${LEVEL}, but keep the phrases people really use (contractions, fillers like "sure", "no worries", softeners like "I'm afraid").
- Include the lines of the character the learner plays, as a model she can use as is.
- The role-play is not a continuation: it is the same scene again, where the learner says it in her own words.
- If the learner writes what really happened or what she couldn't say, recreate that scene as faithfully as possible and always include a line that says what she couldn't.
- If there is a photo, read what is in it (a sign, menu, document, email, screen) and build a scene where the learner talks about it.`,
    messages: [
      {
        role: "user",
        content: [
          ...(photo ? [{ type: "image" as const, source: { type: "base64" as const, media_type: photo.mediaType, data: photo.data } }] : []),
          { type: "text" as const, text: `${photo ? "A photo the learner took.\n" : ""}Situation: ${topic || "(the situation in the photo)"}` },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(GeneratedSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  return res.parsed_output;
}

// ---- Judging one spoken answer (马上说 / 复习) ----

const JudgeSchema = z.object({
  verdict: z
    .enum(["good", "ok", "off"])
    .describe("good: natural and works as is in the situation. ok: the meaning gets across but something should be fixed. off: different meaning, not understandable, or hardly said"),
  summary_zh: z.string().describe("One-sentence comment in Chinese. Start with what she got right"),
  right_zh: z.string().describe("What was good (Chinese, short). Empty if nothing"),
  fixes: z
    .array(z.object({ you_said: z.string(), better: z.string(), why_zh: z.string() }))
    .describe("Only the single most important thing to fix. Leave out what look like recognition slips. Empty array if good"),
  others: z
    .array(z.object({ ja: z.string(), zh: z.string().describe("When to use it (Chinese, short)") }))
    .describe("One other way to say the same thing: more or less polite, more casual, or shorter"),
  points: z
    .array(
      z.object({
        tag: z.string().describe("Name of the grammar point or expression (English, short). E.g. 'Could you ...? (requests)', 'past tense: -ed', 'prepositions: in / on / at'"),
        zh: z.string().describe("What it is (Chinese, 1 sentence)"),
        ok: z.boolean().describe("true if the learner used it correctly. false if she didn't say it, got it wrong or avoided it"),
      }),
    )
    .describe("1-3 grammar points or expressions at the core of the model answer, and whether the learner used each. Leave out pure vocabulary differences and recognition slips"),
});

export type Judge = z.infer<typeof JudgeSchema>;

// Runs after every single answer; one retry if the model errors or returns nothing usable.
export async function judgeAnswer(a: { zh: string; ja: string; where?: string; said: string; known?: string[] }) {
  try {
    return await judgeOnce(a);
  } catch (e) {
    console.error("judge failed, retrying:", e);
    return judgeOnce(a);
  }
}

async function judgeOnce(a: { zh: string; ja: string; where?: string; said: string; known?: string[] }) {
  const res = await parse({
    ...smart(4000),
    system: `You are an English speaking coach. ${LEARNER}
The learner sees a Chinese sentence and says it in English straight away. She doesn't need to match the model answer word for word.
First check whether what she said means the same as the Chinese. If she said something else or left out an important part, it is off, even if it is good English.
If it means the same and works naturally in the situation, it is good. Don't mark down for a different wording alone.
Her answer comes from speech recognition. Homophones, punctuation, capitals and small recognition slips are not her mistakes.
Explain in Chinese, short and concrete.
points are used to keep a record of her weak points. Always use the same tag for the same grammar point or expression.${
      a.known?.length ? `\nTags already used: ${a.known.join(" / ")}\nIf one fits, use it exactly as written.` : ""
    }`,
    messages: [
      {
        role: "user",
        content: `Situation: ${a.where || "(none)"}
What she wants to say (Chinese): ${a.zh}
Model answer: ${a.ja}
What she said: ${a.said}`,
      },
    ],
    output_config: { effort: "low", format: zodOutputFormat(JudgeSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error(`AI 返回格式不对（${res.stop_reason}），请重试`);
  return res.parsed_output;
}

// ---- Targeted drill for one weak point ----

const DrillSchema = z.object({
  explain_zh: z
    .string()
    .describe("How to use this grammar point or expression (Chinese, 3-5 sentences). Touch on why her mistakes are wrong and give a tip for saying it"),
  pattern: z.string().describe("The form in short. E.g. 'Could you + verb ...?'"),
  items: z
    .array(
      z.object({
        zh: z.string().describe("The Chinese shown to the learner (what she wants to say)"),
        ja: z.string().describe("Natural English using the grammar point or expression. 15 words at most"),
        reading: z.string().describe("Leave empty"),
        where: z.string().describe("The situation (Chinese, 10 characters at most). E.g. 「对客人」「对店长」「便利店」"),
      }),
    )
    .describe("6 sentences to say straight away from the Chinese, easiest first. Mix shop-floor and daily-life situations"),
});

export type Drill = z.infer<typeof DrillSchema>;

export async function makeDrill(w: { tag: string; zh: string; examples: { said: string; better: string }[] }) {
  const res = await parse({
    ...smart(4000),
    system: `You are an English speaking coach. ${LEARNER}
For a grammar point or expression the learner keeps getting wrong when she speaks, write a short explanation and practice sentences she says in English straight away from the Chinese.
- Every practice sentence uses the grammar point or expression, and is natural English she could use as is at the shop or in daily life.
- Vocabulary around ${LEVEL}. One short sentence each.`,
    messages: [
      {
        role: "user",
        content: `Grammar point or expression: ${w.tag} (${w.zh})
Her recent mistakes:
${w.examples.map((e) => `- said: ${e.said} → better: ${e.better}`).join("\n") || "(none recorded)"}`,
      },
    ],
    output_config: { effort: "medium", format: zodOutputFormat(DrillSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  // The Chinese is the question: one with English in it shows the answer, so it isn't asked.
  const items = res.parsed_output.items.filter((x) => !inEnglish(x.zh, 2));
  if (!items.length) throw new Error("AI 返回格式不对，请重试");
  return { ...res.parsed_output, items };
}

// ---- Haiku coach: quick feedback on every other kind of speaking ----

export const COACH = `You are an English speaking coach. ${LEARNER}
Explain in Chinese, short and concrete. The learner's words come from speech recognition, so homophones, punctuation and capitals are not her mistakes.`;

const PointsSchema = z
  .array(
    z.object({
      tag: z.string().describe("Name of the grammar point or expression (English, short). E.g. 'Could you ...? (requests)', 'prepositions: in / on / at'"),
      zh: z.string().describe("What it is (Chinese, 1 sentence)"),
      ok: z.boolean().describe("true if she used it correctly, false if she got it wrong or avoided it"),
    }),
  )
  .describe("0-2 grammar points or expressions at the core of what she said. Leave out pure vocabulary differences and recognition slips");

// Short coaching calls; one retry so the learner still gets feedback after a hiccup. With an effort, the
// call goes to Opus.
async function haikuFirst<S extends z.ZodType>(schema: S, system: string, content: string, maxTokens = 3000, effort?: Effort): Promise<z.infer<S>> {
  const run = async () => {
    const res = await parse({
      ...(effort ? smart(maxTokens) : { model: MODEL, max_tokens: maxTokens }),
      system,
      messages: [{ role: "user", content }],
      output_config: { ...(effort && { effort }), format: zodOutputFormat(schema) },
    });
    checkStop(res.stop_reason);
    if (!res.parsed_output) throw new Error(`AI 返回格式不对（${res.stop_reason}），请重试`);
    return res.parsed_output as z.infer<S>;
  };
  try {
    return await run();
  } catch (e) {
    console.error("coach call failed, retrying:", e);
    return run();
  }
}

// 模仿说: turn Azure's word scores into one thing to fix.
const ShadowCoachSchema = z.object({
  tip_zh: z.string().describe("The single most important thing to fix in the next try (Chinese, 1-2 sentences). Which sound of which word, and how to say it"),
  words: z
    .array(
      z.object({
        word: z.string(),
        kana: z.string().describe("The word's pronunciation in IPA, e.g. /ˈθɜːrzdeɪ/"),
        why_zh: z.string().describe("What tends to go wrong and a tip (Chinese, short)"),
      }),
    )
    .describe("Up to 3 words to watch. Prefer low-scoring words and sounds Chinese speakers often get wrong: th, v/w, l/r, final consonants, word stress, linking"),
  score_doubt: z
    .boolean()
    .describe("true if the recognition is almost the same as the model but the overall score is extremely low (under 50), i.e. the scoring looks broken"),
  doubt_zh: z.string().describe("If score_doubt is true, one line for the learner (Chinese). Otherwise empty"),
});

export type ShadowCoach = z.infer<typeof ShadowCoachSchema>;

export function coachShadow(a: {
  ja: string;
  kana?: string;
  said: string;
  scores?: { pron: number; accuracy: number; fluency: number; completeness: number; words: { word: string; accuracy: number; errorType: string }[] };
}) {
  const s = a.scores;
  return haikuFirst(
    ShadowCoachSchema,
    `${COACH}
The learner listens to a model recording and says the same sentence after it (shadowing).
From the pronunciation scores and what was recognised, tell her the one thing to fix in the next try. Don't read the scores out.`,
    `Model: ${a.ja}
Recognised: ${a.said}
${
  s
    ? `Overall ${s.pron} · accuracy ${s.accuracy} · fluency ${s.fluency} · completeness ${s.completeness}
Per word: ${s.words.map((w) => `${w.word}(${w.accuracy}${w.errorType !== "None" ? `,${w.errorType}` : ""})`).join(" ")}`
    : "No pronunciation scores"
}`,
    3000,
    "low",
  );
}

// 对话: a quiet note on each line the learner says, without breaking the conversation.
const TurnCheckSchema = z.object({
  verdict: z.enum(["good", "ok", "off"]).describe("good: natural in this situation. ok: understandable but something should be fixed. off: not understandable or doesn't fit"),
  better: z.string().describe("A more natural way to say it (English, 1 sentence). Empty if good"),
  why_zh: z.string().describe("One-line explanation (Chinese, 1 sentence). If good, a word of praise"),
  points: PointsSchema,
});

export type TurnCheck = z.infer<typeof TurnCheckSchema>;

export function checkTurn(s: Talk, history: Turn[], known?: string[]) {
  const said = history[history.length - 1]?.text ?? "";
  const before = history.slice(-5, -1);
  return haikuFirst(
    TurnCheckSchema,
    `${COACH}
The learner is in a role-play conversation. Look only at her last line and judge whether it is natural in this situation.
Don't mark down for a different wording alone. Do check that the politeness fits the person and situation (e.g. a customer).${knownLine(known)}`,
    `Situation: ${s.talk.setup}
Partner: ${s.talk.aiRole}
Learner's role: ${s.talk.userRole}
Goal: ${s.talk.goalZh}
Conversation just before:
${before.map((t) => `${t.role === "user" ? "Learner" : "Partner"}: ${t.text}`).join("\n") || "(none)"}
Learner's line: ${said}`,
    3000,
    "low",
  );
}

// 复习: a fresh sentence built on the same pattern, so a card isn't memorised as one fixed string.
const VariantSchema = z.object({
  ja: z
    .string()
    .describe("One natural English sentence using the same grammar point or expression as the original, with the content or situation changed a little. Even if the original is a short phrase, make it a concrete sentence that says what it is about (20 words at most)"),
  zh: z
    .string()
    .describe("The Chinese translation of the ja sentence above, leaving nothing out (1 sentence). Everything in ja (who, what, what happened) must be in it. The learner says the English from this. Never write instructions, explanations, grammar notes or 'translate this'"),
  reading: z.string().describe("Leave empty"),
  pattern_zh: z.string().describe("The grammar point or expression shared with the original (Chinese, short)"),
});

export type Variant = z.infer<typeof VariantSchema>;

export async function makeVariant(c: { ja: string; zh: string }) {
  const ask = () =>
    haikuFirst(
      VariantSchema,
      `${COACH}
To review a sentence the learner has learned, write one other sentence using the same grammar point or expression. Vocabulary around ${LEVEL}. A sentence she could use as is at the shop or in daily life.
zh is shown big on the screen as "what you want to say". Write only the Chinese translation of ja, no instructions or notes.
If the original is a short phrase, widen it into a concrete sentence that shows the situation. Example: original "That would be great!" → ja "It would be great if you could send me the receipt." zh 「你能把收据发给我的话就太好了。」`,
      `Original: ${c.ja}
Meaning: ${c.zh}`,
      3000,
      "low",
    );
  const first = await ask();
  if (variantOk(first)) return first;
  console.error("bad variant, retrying:", first);
  const second = await ask();
  if (variantOk(second)) return second;
  throw new Error("AI 出的新句子不对，先考原句");
}

// 通勤播客: a short daily audio episode built from the learner's own weak points and saved phrases.
const PodcastSchema = z.object({
  title_zh: z.string().describe("Today's episode title (Chinese, 15 characters at most)"),
  segments: z
    .array(
      z.object({
        kind: z
          .enum(["zh", "ja", "repeat"])
          .describe("zh: a commentary line in Chinese (the host speaks). ja: read an English example sentence. repeat: read an English sentence, leave a gap for the listener to repeat it in their head, then read it again"),
        text: z.string().describe("The line read out. zh: 1-3 Chinese sentences; ja and repeat: one English sentence (15 words at most)"),
        zh: z.string().describe("For ja and repeat, the Chinese translation. For zh, empty"),
      }),
    )
    .describe("About 3 minutes in all, 20-30 segments. Start by introducing today's theme in Chinese, end with a word of encouragement in Chinese"),
});

export type Podcast = z.infer<typeof PodcastSchema>;

export function makePodcast(a: {
  weak: { tag: string; zh: string; examples: { said: string; better: string }[] }[];
  cards: { ja: string; zh: string }[];
  scenes: string[];
}) {
  return haikuFirst(
    PodcastSchema,
    `${COACH}
Write the script of a personal 3-minute audio show the learner listens to on her commute, without looking at the screen.
- Commentary in Chinese, example sentences in English. Keep the Chinese short and get to the English examples quickly.
- Take 1-2 of her weak points and contrast what she actually said with the right way.
- Put her saved expressions in example sentences several times as repeat. Keep repeat sentences short and usable as is at the shop or in daily life.
- Match the examples to the situations she is practising.
- If there are no weak points or saved expressions, pick common ${LEVEL} expressions for the shop floor and daily life.`,
    `Weak points:
${a.weak.map((w) => `- ${w.tag} (${w.zh})${w.examples.map((e) => ` said: ${e.said} → right: ${e.better}`).join("")}`).join("\n") || "(none)"}
Saved expressions:
${a.cards.map((c) => `- ${c.ja} (${c.zh})`).join("\n") || "(none)"}
Situations she is practising: ${a.scenes.join(", ") || "(none)"}`,
  );
}

// 趣味电台 (lib/radio.ts) when Gemini isn't available.
export function makeRadioWithClaude<S extends z.ZodType>(schema: S, system: string, content: string) {
  // A show of 30-40 lines with notes, in JSON: 5000 tokens cut it off.
  return haikuFirst(schema, system, content, 14000);
}

// 问 AI: the learner selected a word, phrase or line they don't get; explain just that, in context.
const ExplainSchema = z.object({
  reading: z.string().describe("The pronunciation of the selected part in IPA if it is one English word, else empty"),
  meaning_zh: z.string().describe("What it means in this context (Chinese, 1-2 sentences)"),
  points: z
    .array(
      z.object({
        ja: z.string().describe("Heading only: the word or pattern itself (English, 5 words at most, no explanation). E.g. 'run out of', 'be supposed to'"),
        zh: z.string().describe("Explanation (Chinese, 1-2 sentences)"),
      }),
    )
    .describe("1-4 words or grammar points worth breaking down. If the selection is one word, one point on how that word is used"),
  nuance_zh: z.string().describe("Feel, situation, other ways to say it (Chinese, 1-2 sentences). Empty if nothing special"),
  example: z.object({ ja: z.string().describe("Another example for daily life or work (English, short)"), zh: z.string() }),
});

export type Explain = z.infer<typeof ExplainSchema>;

export function explainSelection(a: { pick: string; line: string; before?: string; topic: string }) {
  return haikuFirst(
    ExplainSchema,
    `${COACH}
The learner is reading a screen of an English-learning app (a radio script, an exercise, an example, feedback) and selected a part she doesn't get. There is no question text. Explain only the selected part, as it means in this context. If Chinese was selected, explain mainly how to say it in English. No preamble or general talk.`,
    `Screen: ${a.topic}
${a.before ? `Line before: ${a.before}\n` : ""}Sentence containing the selection: ${a.line}
Selection: ${a.pick}`,
  );
}

// ---- 讲三遍: tell today's story three times, to three people ----

// After the first telling: the one thing to work on in the next two, from what the learner actually said.
// Corrected between the first and second telling only, and on one thing, as in Tran & Saito's 4/3/2 +
// delayed CF. When the learner got stuck mid-sentence, that is the one thing: the words they were
// looking for, preferring ones the next story can use too (de Jong & Perfetti), and a way around the
// word with easy words (communication strategies, Dörnyei 1995).
const Carried = z
  .enum(["right", "wrong", "unused"])
  .describe("Used the point correctly where it fit: right. Got it wrong: wrong. No place to use it or avoided it: unused (not right). unused if there is no point");
const RetellFixSchema = z.object({
  stall: z.object({
    you_said: z.string().describe("What she said just before getting stuck (as transcribed, short). Empty if no stall is shown"),
    better: z.string().describe(`A natural way to say what she was trying to say there (English, 1 sentence, ${LEVEL}). Prefer general phrases she can use in the next story too. Empty if no stall is shown`),
    around: z.string().describe("If she got stuck on one word, a way to say it without that word, with easy words (English). Empty if not needed"),
    zh: z.string().describe("Chinese translation of better (Simplified). Only the translation: it is used to say the English from Chinese. Empty if no stall is shown"),
  }),
  fix: z.object({
    you_said: z.string().describe("The English she actually said (just that bit). Empty if there is nothing to fix"),
    better: z.string().describe("A natural way to say that bit. Empty if you_said is empty"),
  }),
  focus_zh: z
    .string()
    .describe("The one thing to mind in the next two tellings. One sentence in Simplified Chinese, 30 characters at most (e.g. 「讲过去的事，动词用过去式，比如 went、saw。」). English only for the words being quoted. If nothing needs fixing, one line on how to tell more (also in Chinese)"),
  point: z.object({
    tag: z.string().describe("Name of the grammar point or expression (English, short). If it has no grammar name, the corrected words themselves (e.g. 'used to', 'it was delicious'). Empty if you_said is empty"),
    zh: z.string().describe("What it is (Chinese, 1 sentence). Empty if tag is empty"),
  }),
  carried: Carried,
});
export type RetellFix = z.infer<typeof RetellFixSchema>;
export type RetellStall = { before: string; after: string; secs: number };

type FixArgs = { topic: string; said: string; known?: string[]; carry?: { focus_zh: string; better: string }; stall?: RetellStall };

export async function retellFix(a: FixArgs) {
  // parse() already asks once more when the tip comes back in English; if it still does, fall back to a
  // plain Chinese line around the corrected words.
  const r = await retellFixOnce(a);
  const f = { ...r, stall: { ...r.stall, zh: await cardZh(r.stall.better, r.stall.zh) } };
  if (!inEnglish(f.focus_zh) && !inEnglish(f.point.zh)) return f;
  return {
    ...f,
    focus_zh: f.fix.better ? `下一遍这样说：「${f.fix.better}」` : "下一遍多讲一点细节。",
    point: { ...f.point, zh: inEnglish(f.point.zh) ? "" : f.point.zh },
  };
}

function retellFixOnce(a: FixArgs) {
  return haikuFirst(
    RetellFixSchema,
    `${COACH}
The learner is telling, in her own words, a story she heard (on the news or the radio). She will tell the same story twice more, to other people.
Look at the transcript of the first telling (word for word as heard; (…2.1s…) is a silence of a second or more, (…stuck 2.1s…) is a silence in the middle of a sentence) and:
- If a stall is shown, write in stall what she was trying to say there.
- Pick exactly one thing to fix in the next two tellings for fix: errors that block meaning > errors that keep coming back > unnatural phrasing. If an error in her weak-point record shows up again today, prefer it.
Don't judge the content or length of the story. Restarts, "um", "uh" and repeats are not errors.
If there is a point carried over from an earlier day, write in carried whether she used it correctly. If it isn't fixed yet, you may pick it as today's one thing.
focus_zh, point.zh and stall.zh are read by the learner on screen: always Simplified Chinese, short.${knownLine(a.known)}`,
    `Story topic: ${a.topic}
${a.carry ? `Point carried over from an earlier day: ${a.carry.focus_zh} (example of the right form: ${a.carry.better})\n` : ""}${a.stall ? `Longest stall (${a.stall.secs}s): "${a.stall.before}" (stuck) "${a.stall.after}"\n` : ""}First telling: ${a.said}`,
    3000,
    "medium",
  );
}

// After each telling: how each keyword on screen was used. A word goes only once it has been used
// right and without a stall in two tellings in a row (counted across days, runs), and then a word the
// learner hasn't reached for yet takes its place.
const KEY_RUNS_DONE = 2;
const RetellKeysSchema = z.object({
  rated: z
    .array(
      z.object({
        ja: z.string().describe("The keyword, as written"),
        use: z
          .enum(["fluent", "shaky", "unused"])
          .describe(
            "fluent: said the word (any form) with the right meaning and form, with no stall (…), restart or um right before or after, naturally inside a sentence. shaky: used it but got it wrong, stalled, restarted, hesitated or it was unnatural. unused: didn't use it. When unsure, shaky",
          ),
      }),
    )
    .describe("For every current keyword, how it was used in this telling"),
  spare: z
    .array(z.object({ ja: z.string().describe("The word (as written, short)"), kana: z.string().describe("Its pronunciation in IPA") }))
    .describe(
      "3 new words to swap in for keywords, most useful first. Prefer the candidate words: ones she hasn't used yet that help tell this story. A word she tried to say and couldn't comes first. No word that is already a current keyword",
    ),
});
export type RetellKeys = { keys: { ja: string; kana: string }[]; done: string[]; runs: Record<string, number> };

type KeysArgs = { topic: string; keys: { ja: string; kana?: string; runs?: number }[]; pool: { ja: string; kana?: string }[]; said: string[] };

export async function retellKeys(a: KeysArgs): Promise<RetellKeys> {
  const r = await haikuFirst(
    RetellKeysSchema,
    `${COACH}
The learner tells the same story three times to different people. Keywords that help her tell it are on screen. Judge strictly how each keyword was used in the latest telling (fluent only when she really handled it). In the transcript (…2.1s…) is a silence and (…stuck…) a stall mid-sentence.
If there are no keywords, put in spare the words she tried and failed to say, or that would let her say more.`,
    `Story topic: ${a.topic}
Current keywords: ${a.keys.length ? a.keys.map((k) => k.ja).join(", ") : "(none)"}
Candidate words: ${a.pool.map((k) => k.ja).join(", ") || "(none)"}
${a.said.map((t, i) => `${i === a.said.length - 1 ? "Latest telling" : `Telling ${i + 1}`}: ${t}`).join("\n")}`,
    1500,
    "low",
  );
  const use = new Map(r.rated.map((x) => [x.ja.toLowerCase(), x.use]));
  const runs = Object.fromEntries(
    a.keys.map((k) => {
      const u = use.get(k.ja.toLowerCase()) ?? "unused";
      return [k.ja, u === "fluent" ? (k.runs ?? 0) + 1 : u === "shaky" ? 0 : (k.runs ?? 0)];
    }),
  );
  const spare = r.spare
    .map((k) => ({ ja: k.ja.trim(), kana: k.kana.trim() }))
    .filter((k) => k.ja && k.ja.length <= 30 && !a.keys.some((x) => x.ja.toLowerCase() === k.ja.toLowerCase()));
  // A word only goes once there is one to take its place, and the new one takes its place in the row.
  const done: string[] = [];
  const keys = a.keys.map((k) => {
    if (runs[k.ja] < KEY_RUNS_DONE || !spare.length) return { ja: k.ja, kana: k.kana ?? "" };
    done.push(k.ja);
    return spare.shift()!;
  });
  // No keywords at all (a story from the learner's own day): the words they reached for.
  if (!a.keys.length) keys.push(...spare.slice(0, 3));
  return { keys, done, runs };
}

// After the third telling: whether the point stuck, and the learner's own story said naturally, to hear
// as "this is you, a little further on" rather than as a correction.
const RetellEndSchema = z.object({
  used: Carried.describe("In the third telling, used the point correctly where it fit: right. Got it wrong: wrong. No place or avoided: unused. unused if there was no point"),
  praise_zh: z.string().describe("One concrete thing that got better from the first to the third telling (Chinese, 1 sentence). A real difference, not flattery"),
  natural: z
    .array(
      z.object({
        you: z.string().describe("A stretch she actually said in the third telling (as transcribed; um/uh may be left out)"),
        ja: z.string().describe(`A natural way to say that stretch. Same content. ${LEVEL} vocabulary, spoken English`),
        zh: z.string().describe("Chinese translation of ja (Simplified). Only the translation"),
      }),
    )
    .describe("The third telling cut in order into 3-5 stretches, each pairing what she said with a natural way to say it. A stretch with nothing to fix may have you and ja the same"),
});
export type RetellEnd = z.infer<typeof RetellEndSchema>;

export function retellEnd(a: { topic: string; first: string; last: string; focus: string }) {
  return haikuFirst(
    RetellEndSchema,
    `${COACH}
The learner told a story she heard three times, to three different people. Look at the transcripts (word for word as heard) of the first and third tellings.`,
    `Story topic: ${a.topic}
Point given after the first telling: ${a.focus || "(none)"}
First telling: ${a.first}
Third telling: ${a.last}`,
    3000,
    "medium",
  );
}

// The day after: which of yesterday's natural sentences the learner now used when telling the story
// again. Using a corrected form oneself is what predicts keeping it (Loewen 2005).
const RetellUptakeSchema = z.object({
  used: z
    .array(z.string())
    .describe("Phrases from yesterday's natural versions that she used today in almost the same form (copied from the natural version, 2-8 words). Not ones that are just a topic noun. Empty array if none"),
});

export async function retellUptake(a: { natural: string[]; said: string }) {
  const { used } = await haikuFirst(
    RetellUptakeSchema,
    `${COACH}
The learner told the story she told yesterday once more today. Yesterday she was shown her story said naturally. Compare that with today's transcript.`,
    `Yesterday's natural versions:\n${a.natural.map((x) => `- ${x}`).join("\n")}\nToday: ${a.said}`,
    1000,
  );
  const low = (s: string) => s.toLowerCase();
  return used.filter((u) => a.natural.some((n) => low(n).includes(low(u)))).slice(0, 3);
}

// 讲三遍: Gemini writes each piece of a telling down; reading the pieces is text only, and Haiku does
// it in about half the time Gemini took, while the learner waits.
const RetellReadSchema = z.object({
  cut: z.array(z.boolean()).describe("For each piece in order: true if it stops in the middle of a sentence, false at a sentence or clause boundary"),
  reaction: z.string().describe("What the listener says right after hearing the story (English, 8-15 words)"),
  good: z.string().describe("One English expression she said well, copied exactly from what she said (2-8 words). Empty if none"),
});

// good: one thing said well, word for word from the telling, so the learner knows what to keep saying
// (praise of a specific act, not of the person). Nothing when nothing stands out; never one already
// praised on an earlier day.
export async function retellRead(a: { pieces: string[]; topic: string; listener: string; avoid?: string[] }) {
  return haikuFirst(
    RetellReadSchema,
    `An English learner told someone about "${a.topic}". This is the transcript, cut wherever she was silent for a second or more (mistakes left as they are).
cut: for each piece (${a.pieces.length}, in order), true if the piece stops in the middle of a sentence (she got stuck and the same sentence goes on in the next piece), false if it stops at a sentence or clause boundary (after a full sentence, or after "and", "but", "so", "because" and the like). The last one is false.
reaction: what the listener (${a.listener}) says right after the story, in English. A specific surprised remark or comment on something she clearly said. 8-15 words. Not ending in a question.
good: one English expression she said well, copied from the transcript exactly as is. Prefer natural spoken phrases, connectors or structures she used right, and words that are a bit hard for her. Not one with a mistake in it, not "um", not a single word, not just the topic word.${a.avoid?.length ? ` Already praised, don't pick: ${a.avoid.join(" / ")}.` : ""} Empty if nothing fits.`,
    a.pieces.map((t, i) => `[${i + 1}] ${t}`).join("\n"),
    1000,
  );
}

// ---- 先生: each night, one look at everything the learner said, to set tomorrow's priorities ----

const TeacherSchema = z.object({
  order: z.array(z.string()).describe("Up to 5 weak-point tags to practise from tomorrow, most important first. Copy the tags from the list exactly"),
  hide: z
    .array(z.string())
    .describe("Tags to take off the list: duplicates of the same grammar point (keep only one in order), and ones whose examples aren't her mistakes (speech-recognition slips, tags from unrelated sentences). Empty array if none"),
  why_zh: z.string().describe("Why the first one in order was chosen (Chinese, 1-2 sentences). Concrete, about what she actually said"),
  note_zh: z
    .string()
    .describe("How she has been doing lately (Chinese, 3 sentences at most): one concrete thing that really improved, one thing to mind next. No numbers read out, no flattery"),
  letter_ja: z
    .string()
    .describe("A short letter to the learner (English, 3 sentences at most, easy words). The same as note_zh, as Ms. Moore talking kindly ('You're doing great with...', 'Let's work on ... together'). No greeting line or signature"),
  good: z
    .object({
      before: z.string().describe("How she said it before (her actual words: a first telling, or a sentence she got wrong before)"),
      after: z.string().describe("How she says it now (her actual words, may be cut short)"),
      mark: z.string().describe("The part of after that improved most. Part of after, copied exactly"),
      zh: z.string().describe("What improved (Chinese, 1 sentence, 20 characters at most)"),
    })
    .nullable()
    .describe("One real improvement, shown big on the screen. null if there is nothing earlier to compare with"),
  fix: z
    .object({
      tag: z.string().describe("The first tag in order, as is"),
      said: z.string().describe("A short mistake she actually made (just that part, from 'said' in the record)"),
      better: z.string().describe("The right way (short English, as long as said)"),
      mark: z.string().describe("The part of better that was corrected. Part of better, copied exactly (e.g. 'went')"),
      zh: z.string().describe("Why it is said that way (Chinese, 1 sentence, 20 characters at most)"),
    })
    .nullable()
    .describe("The one thing to fix first tomorrow, shown big on the screen. null if order is empty"),
  news: z
    .string()
    .describe("From 'tomorrow's news', the id of the one article best to tell three times tomorrow (one that practises a current weak point, or is close to work or daily life), copied exactly. Empty if there is no list"),
});
export type TeacherPlan = z.infer<typeof TeacherSchema>;

export async function teacherPlan(record: string): Promise<TeacherPlan> {
  const res = await parse({
    model: SMART,
    max_tokens: 20000,
    system: `You are this learner's own English teacher, Ms. Moore (a calm, kind teacher in her sixties). ${LEARNER}
Every night you read the whole record up to that day and set the priorities for tomorrow's practice. The app uses order to put weak points into drills, calls and the radio's listener letters.
- The weak points in the record were tagged line by line by another AI: the same grammar may appear under different names, and speech-recognition slips may be tagged as her mistakes. Put those in hide.
- Priority: mistakes that cause trouble at work or in daily life > mistakes that keep coming back > recent mistakes. Ones getting better go to the back.
- "better" is also another AI's guess and sometimes mistakes the word she meant. Think from context what she really meant; put tags whose guess is wrong in hide and don't bring them up in note_zh.
- Her words come from speech recognition. Homophones, punctuation and capitals are not mistakes.
- good and fix are shown big on the screen. Cut both short from sentences she actually said, so they are clear at a glance. Leave out fillers like "um", "uh", "like" (keep the words otherwise).
- When there are earlier notes, write as a continuation: if a point you said to fix has lately been said right, bring it up in good; don't keep the same fix for days on end (if it isn't fixed yet, you may show it with a different example).`,
    messages: [{ role: "user", content: record }],
    output_config: { effort: "high", format: zodOutputFormat(TeacherSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error(`AI 返回格式不对（${res.stop_reason}）`);
  return res.parsed_output;
}

// ---- 预演: rehearse a real conversation that is coming up ----

const RehearsePlanSchema = z.object({
  titleZh: z.string().describe("A short name for this conversation (Chinese, 10 characters at most). E.g. 跟店长请假"),
  person: z
    .enum(["yamada", "tanaka", "yui", "sato", "none"])
    .describe("If the other person is a regular: yamada = Mr. Davis (store manager), tanaka = Mrs. Brown (a regular customer), yui = Emily (a friend), sato = Lucy (a coworker). Otherwise none"),
  who: z.string().describe("What to call the other person (English, short). E.g. Mr. Davis, ward office counter, hairdresser"),
  gender: z.enum(["male", "female"]).describe("The other person's gender"),
  aiRole: z.string().describe("The role the AI plays and how they talk (English, 1-2 sentences)"),
  userRole: z.string().describe("The learner's role (English, short)"),
  goalZh: z.string().describe("What the learner will be able to say in this conversation (Chinese, 1-2 sentences)"),
  setup: z.string().describe("The situation and how the other person moves it along (English, 2-4 sentences). Say whether it is face to face or on the phone"),
  opening: z.object({ ja: z.string(), zh: z.string() }).describe("The first line. If the learner starts the conversation, a short opener from the other side (e.g. 'Hi, what's up?')"),
  twists: z
    .array(z.string())
    .describe("3 of them. How the other person reacts each round (English, 1 sentence, a description not a line). Round 1: accepts smoothly. Round 2: asks follow-up questions about reasons or details. Round 3: a small problem comes up (bad timing, a missing document) but it can be solved by talking"),
  lines: z
    .array(z.object({ ja: z.string(), kana: z.string().describe("Leave empty"), zh: z.string() }))
    .describe("3 natural things the learner can say as is in this conversation. Short (12 words at most), the way people really say it"),
});

export type RehearsePlan = z.infer<typeof RehearsePlanSchema>;

export function rehearsePlan(askZh: string) {
  return haikuFirst(
    RehearsePlanSchema,
    `You write English conversation practice. ${LEARNER}
The learner writes a conversation she is about to have for real. Set it up so she can practise it three times with the AI playing the other person.
- Make it a natural conversation that would really happen at the shop or in daily life.
- All three rounds have the same purpose; only the other person's reaction changes (twists).
- Vocabulary and grammar around ${LEVEL}, but keep the expressions people really use.`,
    `The conversation coming up: ${askZh}`,
    3000,
  );
}

const RehearseDebriefSchema = z.object({
  noteZh: z.string().describe("One line (Chinese, 1 sentence). Start by recognising what she actually managed to say"),
  missed: z
    .array(z.object({ ja: z.string(), kana: z.string().describe("Leave empty"), zh: z.string() }))
    .describe("What she couldn't say, or couldn't say well, in the real conversation, made into natural English she can use there. 0-2, short (12 words at most)"),
});

export type RehearseDebrief = z.infer<typeof RehearseDebriefSchema>;

export function rehearseDebrief(a: { askZh: string; report: string }) {
  return haikuFirst(
    RehearseDebriefSchema,
    `${LEARNER} She had a conversation for real that she had practised beforehand. Read her report on how it went (in Chinese or English) and make what she couldn't say sayable next time. If the report mentions nothing she couldn't say, missed is an empty array.`,
    `Conversation practised: ${a.askZh}\nReport: ${a.report}`,
    2000,
    "medium",
  );
}

// ---- 洗脑连播: one short sentence for each grammar point, to hear and say along ----

const ExamplesSchema = z.object({
  items: z.array(
    z.object({
      ja: z.string().describe(`For "translate only" items, that sentence as is. For "write" items, a short natural example using that grammar (1 sentence, about 12 words, ${LEVEL})`),
      zh: z.string().describe("Chinese translation of ja (1 sentence, no explanation)"),
    }),
  ),
});

export async function pointExamples(points: { pattern: string; zh: string; seed?: string }[]) {
  const r = await haikuFirst(
    ExamplesSchema,
    `${COACH}
Make a list of example sentences for the learner to say along with. There are two kinds of item:
- "write": write one example that must use that grammar point or expression. A sentence really said at the shop or in daily life. No symbols (sb, sth, V, /, ...) or bracketed notes.
- "translate only": copy the given English sentence into ja without changing a word, and write its translation in zh.
Return them in the same order and the same number as the input.`,
    points.map((p, i) => (p.seed ? `${i + 1}. translate only: ${p.seed}` : `${i + 1}. write: ${p.pattern} (${p.zh})`)).join("\n"),
    1500,
  );
  return r.items.slice(0, points.length);
}

// The day's news (lib/news.ts): a real story, from the news site's own text, written again as a short
// article for learners, with its Chinese, its words and the skeleton for 讲三遍. Once per article.
const NewsNotesSchema = z.object({
  title: z.string().describe(`The headline in easy English (${LEVEL}, 10 words at most)`),
  title_zh: z.string().describe("Chinese translation of the headline (Simplified, short)"),
  sentences: z
    .array(z.object({ en: z.string().describe(`One sentence of the article in easy, natural news English (${LEVEL}, 8-22 words)`), zh: z.string().describe("Its natural Chinese translation (Simplified). Only the translation") }))
    .describe("The article, 6-9 sentences, in the order a news reader would say them. Only facts from the source; nothing invented"),
  words: z
    .array(z.object({ ja: z.string().describe("A word or phrase from the article (base form: 'rise' not 'rising')"), kana: z.string().describe("Its pronunciation in IPA"), zh: z.string().describe("Chinese meaning (short)") }))
    .describe("3-5 words or phrases worth keeping for work or daily life and common on the TOEIC, needed to talk about this article. Not basic words everyone knows, not names of people, places or countries"),
  keys: z
    .array(z.object({ ja: z.string().describe("A word from the article (base form)"), kana: z.string().describe("Its pronunciation in IPA"), zh: z.string().describe("Chinese meaning (short)") }))
    .describe("3 words that form the skeleton for retelling this article in her own words, in the story's order. Seeing them brings the story back. Not names of people, places or countries"),
  summary: z.array(z.string()).describe(`The article in 3 natural English sentences, as you'd tell a friend (${LEVEL})`),
});
export type NewsNotes = z.infer<typeof NewsNotesSchema>;

export function newsNotes(title: string, text: string): Promise<NewsNotes> {
  return haikuFirst(
    NewsNotesSchema,
    `${LEARNER} Every morning she listens to a short English news article, and in the evening she retells it three times in her own words. From the source story below, write that article in easy English for her, with translations and notes.
Write it fresh in your own words (do not copy the source's sentences), keep only facts the source states, and leave out anything you are not sure of.`,
    `Source headline: ${title}\n\nSource text:\n${text}`,
    6000,
    "low",
  );
}

// 一句一句讲三遍: one news sentence said back from memory. Judged by meaning, from what the learner managed to
// say: where they got stuck, and their own sentence made right (their words, their level) rather than the article's.
// parts: the article's sentence cut in order, each part said or not, for the original shown small underneath.
const SayCheckSchema = z.object({
  verdict: z.enum(["good", "close", "off"]).describe("good: says the same as the original (wording may differ). close: mostly gets across, but part is missing or wrong. off: the important content doesn't get across"),
  mine: z
    .array(z.object({ t: z.string().describe("A part of what she said (copied as is)"), ok: z.boolean().describe("true if the grammar and word use are right and natural, false if wrong or unnatural") }))
    .describe("What she said, cut in order into phrases. Joined with spaces they give exactly what she said"),
  stuck_zh: z.string().describe("Where she got stuck or what she couldn't say, one line in Chinese (25 characters at most). E.g. 「“because of the rain” 这部分没说出来」. Empty if no problem"),
  better: z.string().describe(`Her own sentence, keeping as many of her words and her structure as possible, corrected as little as needed to mean the same as the original. Don't go back to the original. A form she can say at ${LEVEL}. If what she said is already right and enough, what she said as is`),
  better_zh: z.string().describe("What was fixed or added in better, one line in Chinese (25 characters at most). Empty if nothing was changed"),
  parts: z
    .array(z.object({ t: z.string().describe("A part of the original (copied as is)"), ok: z.boolean().describe("true if she said that content (in any wording)") }))
    .describe("The original cut in order into chunks of meaning (phrases). Joined with spaces they give exactly the original"),
});
export type SayCheck = z.infer<typeof SayCheckSchema>;

export async function sayCheck(a: { ja: string; said: string }): Promise<SayCheck> {
  const res = await parse({
    ...smart(2500),
    system: `${COACH}
The learner listens to one news sentence, remembers it, and says it again in her own words. She doesn't need to say it word for word. The aim is to grow what she can say from where she is now.
Compare what she said (speech recognition) with the original: did the meaning get across, where did she get stuck. Show a correction that builds on how she said it.
It comes from speech recognition: homophones, punctuation, capitals and how numbers are written are not mistakes.`,
    messages: [{ role: "user", content: `Original: ${a.ja}\nWhat she said: ${a.said}` }],
    output_config: { effort: "low", format: zodOutputFormat(SayCheckSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error(`AI 返回格式不对（${res.stop_reason}）`);
  return res.parsed_output;
}

// 全文模式: the whole article said from its Chinese, once every sentence was passed one by one. Scored by
// meaning, not word for word; each sentence that wasn't right gets the learner's own words made right, and a
// few expressions worth using next time.
const FullCheckSchema = z.object({
  score: z.number().describe("Whole number 0-100: how well the article's content got across (judged by meaning; not lowered for different wording; lowered for missing sentences, wrong meaning, big grammar errors)"),
  good_zh: z.string().describe("One concrete thing said well, in Chinese (25 characters at most). E.g. 「开头用 “According to...” 很自然」"),
  items: z
    .array(
      z.object({
        n: z.number().describe("Sentence number (from the input)"),
        verdict: z.enum(["good", "close", "off"]).describe("good: the sentence's content got across. close: mostly, but part missing or wrong. off: not said or different content"),
        said: z.string().describe("The part of what she said that matches this sentence (copied). Empty if not said"),
        better: z.string().describe(`If not good: her words, kept as much as possible, corrected as little as needed to mean the same as this sentence (if she didn't say it, a short version she can say at ${LEVEL}). Empty if good`),
        fix_zh: z.string().describe("If not good: what was fixed or added, one line in Chinese (20 characters at most). Empty if good"),
      }),
    )
    .describe("Every sentence, in order"),
  tips: z
    .array(z.object({ ja: z.string().describe("An English expression worth using next time (short: a word from the article or a natural phrase)"), zh: z.string().describe("Chinese meaning and when to use it (20 characters at most)") }))
    .describe("2-3 useful expressions she isn't using yet"),
});
export type FullCheck = z.infer<typeof FullCheckSchema>;

export async function fullCheck(a: { title: string; sentences: { ja: string; zh: string }[]; said: string }): Promise<FullCheck> {
  const res = await parse({
    ...smart(5000),
    system: `${COACH}
The learner has finished the one-sentence-at-a-time practice for a news article, and now told the whole article in English looking only at the Chinese. It doesn't need to be word for word: if the meaning gets across, it is right.
The aim is to build on what she said now so she says it a little better next time. When correcting, keep her wording; don't replace it with the original.
Her words come from speech recognition: homophones, punctuation, capitals and how numbers are written are not mistakes.`,
    messages: [
      {
        role: "user",
        content: `Article: ${a.title}\n${a.sentences.map((s, i) => `${i + 1}. ${s.ja} (${s.zh})`).join("\n")}\n\nWhat she said: ${a.said}`,
      },
    ],
    output_config: { effort: "low", format: zodOutputFormat(FullCheckSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error(`AI 返回格式不对（${res.stop_reason}）`);
  return res.parsed_output;
}

// ---- 电台: an English title for an episode saved with only a Chinese one ----

const TitleSchema = z.object({ ja: z.string().describe("An English title (10 words at most). A natural headline, not a word-for-word translation. Keep a question as a question") });

export async function radioTitleJa(zh: string, opening: string): Promise<string> {
  const { ja } = await haikuFirst(TitleSchema, "Turn the Chinese title of a radio show for English learners into a natural English title with the same content.", `Chinese title: ${zh}\nStart of the show: ${opening}`, 300);
  return ja.trim();
}

// 简单说: the hard lines of an episode said again in easier English. One answer per line, "" for the lines
// that are fine as they are.
const EasySchema = z.object({
  lines: z
    .array(z.object({ n: z.number().describe("The line's number"), easy: z.string().describe("The easier version of that line") }))
    .describe("Only the lines rewritten (leave out lines that aren't hard)"),
});

const EASY_RULES = `- Use only ${LEVEL} words and grammar. Hard words become everyday ones (purchase → buy, approximately → about).
- Same meaning (at least nearly). Keep it spoken, and keep the speaker's tone.
- About as long as the original. Don't add explanations.`;

export async function radioEasy(lines: string[]): Promise<string[]> {
  const ask = () =>
    haikuFirst(
      EasySchema,
      `Of the lines of a radio show an English learner (${LEVEL}) listens to, rewrite only the hard ones in easier English.
- Hard = B2 words or above, idioms, long complex sentences. Leave out lines a ${LEVEL} learner gets at once.
- Rewrite about a fifth of the lines, 8 at most.
${EASY_RULES}
- n is the line's number (the number at the start of the input line).`,
      lines.map((l, i) => `${i + 1}. ${l}`).join("\n"),
      4000,
      "low",
    );
  const { lines: got } = await ask().catch(ask);
  const easy = lines.map(() => "");
  for (const g of got) {
    const i = Math.round(g.n) - 1;
    const e = g.easy.trim();
    if (i >= 0 && i < lines.length && e && e !== lines[i]) easy[i] = e;
  }
  return easy;
}

// One line the learner long-pressed and asked to hear more easily: always said again, as easy as it goes.
const EasyOneSchema = z.object({ easy: z.string().describe("The easier version. If it is already easy enough, the original as is") });

export async function radioEasyOne(line: string, before: string): Promise<string> {
  const { easy } = await haikuFirst(
    EasyOneSchema,
    `Rewrite a line an English learner (${LEVEL}) heard on the radio in easier English with the same meaning.
${EASY_RULES}
- If the line is already easy enough, return it as is.`,
    `${before ? `Line before: ${before}\n` : ""}Line: ${line}`,
    1500,
    "low",
  );
  return easy.trim();
}
