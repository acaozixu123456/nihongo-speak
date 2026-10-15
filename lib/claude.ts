import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { Scenario } from "@/content/scenarios";

// Only the role-play part of a scenario is needed here.
type Talk = Pick<Scenario, "talk">;

const MODEL = "claude-sonnet-5-5";
const client = new Anthropic();

export type Turn = { role: "user" | "assistant"; text: string };

function roleplaySystem(s: Talk) {
  return `あなたは日本語の会話練習の相手です。学習者は日本に住んで働いている中国人で、日本語レベルはJLPT N4〜N3です。

場面：${s.talk.setup}
あなたの役：${s.talk.aiRole}
学習者の役：${s.talk.userRole}

ルール：
- 役になりきって、実際の日本の職場・生活と同じ自然な話し方で答える。教科書的すぎる表現は避ける。
- 1回の発話は1〜3文。学習者が話す番を多く作る。
- 語彙と文法はN3程度に抑えるが、話し方は自然なまま（よく使う縮約形はそのまま使ってよい）。
- 学習者の日本語が不自然でも、会話の中では直さない。意味が通じなければ、実際の相手のように聞き返す。
- 学習者の発言は音声認識の結果なので、多少の誤認識は文脈から補って理解する。
- 場面の目的が自然に終わったら、会話を締めくくる一言を言う。`;
}

function toMessages(history: Turn[]): Anthropic.MessageParam[] {
  // The API needs a user turn first; the scenario opens with the AI speaking.
  return [
    { role: "user", content: "（会話を始めてください）" },
    ...history.map((t) => ({ role: t.role, content: t.text })),
  ];
}

function checkStop(stop: string | null) {
  if (stop === "refusal") throw new Error("模型拒绝了这次请求，请换个说法再试");
}

const ReplySchema = z.object({
  ja: z.string().describe("役としての日本語の返答"),
  zh: z.string().describe("返答の自然な中国語訳"),
  finished: z.boolean().describe("場面の会話が終わったら true"),
});

export async function roleplayReply(s: Talk, history: Turn[]) {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: roleplaySystem(s),
    messages: toMessages(history),
    output_config: { effort: "low", format: zodOutputFormat(ReplySchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  return res.parsed_output;
}

const HintSchema = z.object({
  suggestions: z
    .array(z.object({ ja: z.string(), zh: z.string() }))
    .describe("学習者が次に言えそうな日本語を2〜3案。短くて言いやすいものから"),
});

export async function hint(s: Talk, history: Turn[], wantZh?: string) {
  const ask = wantZh
    ? `学習者は次にこう言いたい（中国語）：「${wantZh}」。この場面で自然な日本語の言い方を提案してください。`
    : "学習者が次に何と言えばいいか詰まっています。この場面で自然な返答を提案してください。";
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: `${roleplaySystem(s)}

今は会話の外から、学習者のコーチとして手伝います。役としては答えません。`,
    messages: [
      ...toMessages(history),
      { role: "user", content: ask },
    ],
    output_config: { effort: "low", format: zodOutputFormat(HintSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  return res.parsed_output;
}

const FeedbackSchema = z.object({
  overall_zh: z.string().describe("全体の講評（中国語、2〜4文）。良かった点と一番直すべき点"),
  corrections: z
    .array(
      z.object({
        you_said: z.string().describe("学習者が実際に言った日本語"),
        better: z.string().describe("その場面でより自然な言い方"),
        why_zh: z.string().describe("なぜそう言うのか（中国語、短く）"),
      }),
    )
    .describe("直す価値のある発言だけ。自然だったものは含めない"),
  phrases: z
    .array(z.object({ ja: z.string(), reading: z.string(), zh: z.string() }))
    .describe("この場面で覚えておくと役立つ表現を3〜5個"),
});

export async function feedback(s: Talk, history: Turn[]) {
  const transcript = history
    .map((t) => `${t.role === "user" ? "学習者" : "相手"}：${t.text}`)
    .join("\n");
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: `あなたは日本在住の社会人向けの日本語コーチです。学習者は中国人、レベルはN4〜N3。
場面：${s.talk.setup}
学習者の役：${s.talk.userRole}

会話の記録を見て、学習者の日本語を添削してください。
- 学習者の発言は音声認識の結果。認識ミスらしきものは指摘しない。
- 文法の誤りだけでなく、敬語のレベル、日本の職場・生活での自然さ、より短く言える表現も見る。
- 説明は中国語で、具体的に。`,
    messages: [{ role: "user", content: transcript }],
    output_config: { effort: "medium", format: zodOutputFormat(FeedbackSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  return res.parsed_output;
}

export type Reply = z.infer<typeof ReplySchema>;
export type Hint = z.infer<typeof HintSchema>;
export type Feedback = z.infer<typeof FeedbackSchema>;

// ---- AI-written scenarios ----

const GeneratedSchema = z.object({
  title: z.string().describe("場面の日本語タイトル（15字以内）"),
  titleZh: z.string().describe("場面の中国語タイトル（15字以内）"),
  icon: z.string().describe("場面を表す絵文字1つ"),
  summaryZh: z.string().describe("場面の説明（中国語、1文）"),
  characters: z
    .array(z.object({ name: z.string(), gender: z.enum(["male", "female"]) }))
    .describe("登場人物（2〜3人）。学習者が演じる人物も含む"),
  lines: z
    .array(
      z.object({
        speaker: z.string().describe("characters の name のどれか"),
        ja: z.string(),
        kana: z.string().describe("ja の全文をひらがなで"),
        zh: z.string().describe("自然な中国語訳"),
      }),
    )
    .describe("場面の会話。10〜14行"),
  talk: z.object({
    aiRole: z.string().describe("ロールプレイで AI が演じる役と話し方（日本語）"),
    aiCharacter: z.string().describe("AI が演じる人物の name"),
    userRole: z.string().describe("学習者の役（日本語）"),
    goalZh: z.string().describe("ロールプレイで学習者が達成すること（中国語、1〜2文）"),
    setup: z.string().describe("ロールプレイの状況説明。AI がどう進めるかも含めて（日本語、2〜4文）"),
    opening: z.object({ ja: z.string(), zh: z.string() }).describe("AI の最初の一言"),
  }),
});

export type Generated = z.infer<typeof GeneratedSchema>;

export async function generateScenario(topic: string, category: "work" | "life") {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: `あなたは日本語教材の作者です。学習者は日本に住んで${category === "work" ? "IT企業で働いている" : "生活している"}中国人で、日本語レベルはJLPT N4〜N3です。
学習者が実際に出会う場面の、聞き取りと会話の練習用教材を作ってください。
- 会話は実際の日本の${category === "work" ? "職場" : "生活"}で本当に聞くような自然な話し方にする。教科書的すぎない。
- 語彙と文法は N3 程度。ただし実際によく使う表現（縮約形、あいづち、クッション言葉）は入れる。
- 学習者が演じる人物のセリフも入れて、学習者がそのまま使える言い方の手本にする。
- ロールプレイは会話の続きではなく、同じ場面をもう一度、学習者が自分の言葉で話す練習にする。`,
    messages: [{ role: "user", content: `場面：${topic}` }],
    output_config: { effort: "medium", format: zodOutputFormat(GeneratedSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  return res.parsed_output;
}

// ---- Speaking diary ----

const DiarySchema = z.object({
  comment_zh: z.string().describe("講評（中国語、1〜3文）。内容に一言反応してから、一番良かった点と一番直すべき点"),
  natural: z
    .array(z.object({ ja: z.string(), kana: z.string(), zh: z.string() }))
    .describe("学習者の話を、意味を変えずに自然な日本語に直したもの。1文ずつ。学習者のレベルで言える長さに"),
  corrections: z
    .array(z.object({ you_said: z.string(), better: z.string(), why_zh: z.string() }))
    .describe("直す価値のある箇所だけ（最大5個）。認識ミスらしきものは含めない"),
});

export type DiaryFeedback = z.infer<typeof DiarySchema>;

export async function diaryFeedback(prompt: string, text: string) {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: `あなたは日本在住の社会人向けの日本語コーチです。学習者は中国人、レベルはN4〜N3。
学習者が「${prompt}」というお題で、1分間日本語で話しました。下はその音声認識の結果です。
- 認識ミスらしきものは文脈から補って、指摘しない。
- natural は、学習者が言いたかったことを、日本人が普段話すような自然な日本語で。難しすぎる言葉は使わない。
- 説明は中国語で、具体的に。`,
    messages: [{ role: "user", content: text }],
    output_config: { effort: "medium", format: zodOutputFormat(DiarySchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  return res.parsed_output;
}
