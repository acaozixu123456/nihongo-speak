import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { Scenario } from "@/content/scenarios";

// Only the role-play part of a scenario is needed here.
type Talk = Pick<Scenario, "talk">;

// Haiku everywhere: fast, and cheap enough to run on every utterance.
const MODEL = "claude-haiku-5-5";
// A key created outside any workspace must name one on every request.
const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
const client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});

// Haiku drifts into Japanese when the instructions are in Japanese, so every call ends with this.
const ZH_RULE = `

【出力の言語】中国語の項目（名前が zh・_zh・Zh で終わるもの：講評、説明、理由、訳）は、必ず簡体字の中国語で書く。日本語で書いてはいけない。
日本語の項目（ja、better、reading、kana、例文、言い換え）は日本語のまま。`;
const parse: typeof client.messages.parse = ((params, options) =>
  client.messages.parse({ ...params, system: `${params.system ?? ""}${ZH_RULE}` }, options)) as typeof client.messages.parse;

export type Turn = { role: "user" | "assistant"; text: string };

export function roleplaySystem(s: Talk) {
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
    .describe("学習者が次に言えそうな日本語を2〜3案。短くて言いやすいものから"),
});

export async function hint(s: Talk, history: Turn[], wantZh?: string) {
  const ask = wantZh
    ? `学習者は次にこう言いたい（中国語）：「${wantZh}」。この場面で自然な日本語の言い方を提案してください。`
    : "学習者が次に何と言えばいいか詰まっています。この場面で自然な返答を提案してください。";
  const res = await parse({
    model: MODEL,
    max_tokens: 2000,
    system: `${roleplaySystem(s)}

今は会話の外から、学習者のコーチとして手伝います。役としては答えません。`,
    messages: [
      ...toMessages(history),
      { role: "user", content: ask },
    ],
    output_config: { format: zodOutputFormat(HintSchema) },
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
  const res = await parse({
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
    output_config: { format: zodOutputFormat(FeedbackSchema) },
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

export type Photo = { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };

// `topic` is either a situation to practise or what happened when the learner couldn't get the words out;
// `photo` is a picture from their day (a sign, a menu, an email) to build the scene around.
export async function generateScenario(topic: string, category: "work" | "life", photo?: Photo) {
  const res = await parse({
    model: MODEL,
    max_tokens: 16000,
    system: `あなたは日本語教材の作者です。学習者は日本に住んで${category === "work" ? "IT企業で働いている" : "生活している"}中国人で、日本語レベルはJLPT N4〜N3です。
学習者が実際に出会う場面の、聞き取りと会話の練習用教材を作ってください。
- 会話は実際の日本の${category === "work" ? "職場" : "生活"}で本当に聞くような自然な話し方にする。教科書的すぎない。
- 語彙と文法は N3 程度。ただし実際によく使う表現（縮約形、あいづち、クッション言葉）は入れる。
- 学習者が演じる人物のセリフも入れて、学習者がそのまま使える言い方の手本にする。
- ロールプレイは会話の続きではなく、同じ場面をもう一度、学習者が自分の言葉で話す練習にする。
- 学習者が「実際にあったこと」「言えなかったこと」を書いてきたら、その場面をできるだけ忠実に再現し、学習者が言えなかったことを言えるようにするセリフを必ず入れる。
- 写真があれば、写真に写っているもの（看板、メニュー、書類、メール、画面など）の内容を読み取り、それについて学習者が実際に話す場面にする。`,
    messages: [
      {
        role: "user",
        content: [
          ...(photo ? [{ type: "image" as const, source: { type: "base64" as const, media_type: photo.mediaType, data: photo.data } }] : []),
          { type: "text" as const, text: `${photo ? "学習者が撮った写真です。\n" : ""}場面：${topic || "（写真の状況で）"}` },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(GeneratedSchema) },
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
  const res = await parse({
    model: MODEL,
    max_tokens: 8000,
    system: `あなたは日本在住の社会人向けの日本語コーチです。学習者は中国人、レベルはN4〜N3。
学習者が「${prompt}」というお題で、1分間日本語で話しました。下はその音声認識の結果です。
- 認識ミスらしきものは文脈から補って、指摘しない。
- natural は、学習者が言いたかったことを、日本人が普段話すような自然な日本語で。難しすぎる言葉は使わない。
- 説明は中国語で、具体的に。`,
    messages: [{ role: "user", content: text }],
    output_config: { format: zodOutputFormat(DiarySchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  return res.parsed_output;
}

// ---- Judging one spoken answer (瞬间说 / 复习) ----

const JudgeSchema = z.object({
  verdict: z
    .enum(["good", "ok", "off"])
    .describe("good: その場面でそのまま通じる自然な言い方。ok: 意味は通じるが直したい所がある。off: 意味が違う・通じない・ほとんど言えていない"),
  summary_zh: z.string().describe("一言の講評（中国語、1文）。まず言えた点を認める"),
  right_zh: z.string().describe("良かった点（中国語、短く）。なければ空文字"),
  fixes: z
    .array(z.object({ you_said: z.string(), better: z.string(), why_zh: z.string() }))
    .describe("直すべき箇所だけ（最大3個）。音声認識の誤りらしきものは含めない。good なら空配列"),
  others: z
    .array(z.object({ ja: z.string(), zh: z.string().describe("どんな時に使うか（中国語、短く）") }))
    .describe("同じ意味の別の言い方を2個。丁寧さやくだけ具合が違うもの、より短いものなど"),
  points: z
    .array(
      z.object({
        tag: z.string().describe("文法・表現の名前（日本語、短く）。例：「〜てもらえますか（依頼）」「謙譲語：承知しました」「助詞：に／で」"),
        zh: z.string().describe("その文法・表現が何か（中国語、1文）"),
        ok: z.boolean().describe("学習者がこの点を正しく使えたら true。言えなかった・間違えた・避けたら false"),
      }),
    )
    .describe("模範解答の中心となる文法・表現を1〜3個。学習者の発言でそれぞれ使えたかどうか。語彙だけの違いや認識ミスは含めない"),
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
    model: MODEL,
    max_tokens: 4000,
    system: `あなたは日本在住の社会人向けの日本語コーチです。学習者は中国人、レベルはN4〜N3。
学習者は中国語を見て、すぐに日本語で言う練習をしています。模範解答と一字一句同じである必要はありません。
まず、学習者の発言が「言いたいこと（中国語）」と同じ内容かを確かめてください。別のことを言っている・大事な部分が抜けているなら、日本語として自然でも必ず off にする。
同じ内容で、その場面で意味が通じて自然なら good にしてください。言い方の違いだけで減点しない。
学習者の発言は音声認識の結果です。同音の漢字違い、句読点、小さな認識ミスは学習者の誤りとして扱わない。
説明は中国語で、短く具体的に。
points は学習者の弱点を記録するために使います。同じ文法・表現には毎回同じ tag を使ってください。${
      a.known?.length ? `\n既に使った tag：${a.known.join("、")}\n当てはまるものがあれば、この表記をそのまま使う。` : ""
    }`,
    messages: [
      {
        role: "user",
        content: `場面：${a.where || "（なし）"}
言いたいこと（中国語）：${a.zh}
模範解答：${a.ja}
学習者が言ったこと：${a.said}`,
      },
    ],
    output_config: { format: zodOutputFormat(JudgeSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error(`AI 返回格式不对（${res.stop_reason}），请重试`);
  return res.parsed_output;
}

// ---- Targeted drill for one weak point ----

const DrillSchema = z.object({
  explain_zh: z
    .string()
    .describe("この文法・表現の使い方の説明（中国語、3〜5文）。学習者の間違いがなぜ間違いかに触れ、言うときのコツを入れる"),
  pattern: z.string().describe("形の要約。例：「Vて ＋ もらえますか」"),
  items: z
    .array(
      z.object({
        zh: z.string().describe("学習者に見せる中国語（言いたいこと）"),
        ja: z.string().describe("その文法・表現を使った自然な日本語。25字以内"),
        reading: z.string().describe("ja の全文をひらがなで"),
        where: z.string().describe("場面（中国語、10字以内）。例：「对课长」「便利店」"),
      }),
    )
    .describe("瞬間的に言う練習用の文を6個。易しいものから。仕事と生活の場面を混ぜる"),
});

export type Drill = z.infer<typeof DrillSchema>;

export async function makeDrill(w: { tag: string; zh: string; examples: { said: string; better: string }[] }) {
  const res = await parse({
    model: MODEL,
    max_tokens: 4000,
    system: `あなたは日本在住の社会人向けの日本語コーチです。学習者は中国人、レベルはN4〜N3。日本で働き、生活しています。
学習者が話すときに何度も間違えた文法・表現について、短い説明と、中国語を見て瞬間的に日本語で言う練習問題を作ってください。
- 練習文はその文法・表現を必ず使い、実際の職場や生活でそのまま使える自然な言い方にする。
- 語彙は N3 程度。1文で短く。`,
    messages: [
      {
        role: "user",
        content: `文法・表現：${w.tag}（${w.zh}）
学習者の最近の間違い：
${w.examples.map((e) => `- 言った：${e.said} → 正しくは：${e.better}`).join("\n") || "（記録なし）"}`,
      },
    ],
    output_config: { format: zodOutputFormat(DrillSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  return res.parsed_output;
}

// ---- Haiku coach: quick feedback on every other kind of speaking ----

const COACH = `あなたは日本在住の社会人向けの日本語コーチです。学習者は中国人、レベルはN4〜N3。日本で働き、生活しています。
説明は中国語で、短く具体的に。学習者の発言は音声認識の結果なので、同音の漢字違いや句読点は誤りとして扱わない。`;

const PointsSchema = z
  .array(
    z.object({
      tag: z.string().describe("文法・表現の名前（日本語、短く）。例：「〜てもらえますか（依頼）」「助詞：に／で」"),
      zh: z.string().describe("その文法・表現が何か（中国語、1文）"),
      ok: z.boolean().describe("学習者が正しく使えたら true、間違えた・避けたら false"),
    }),
  )
  .describe("学習者の発言の中心となる文法・表現を0〜2個。語彙だけの違いや認識ミスは含めない");

function knownLine(known?: string[]) {
  return known?.length
    ? `\n学習者の弱点記録で既に使った tag：${known.join("、")}\n同じ文法・表現なら、この表記をそのまま使う。`
    : "";
}

// Short coaching calls; one retry so the learner still gets feedback after a hiccup.
async function haikuFirst<S extends z.ZodType>(schema: S, system: string, content: string, maxTokens = 3000): Promise<z.infer<S>> {
  const run = async () => {
    const res = await parse({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(schema) },
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

// 模仿说話: turn Azure's word scores into one thing to fix.
const ShadowCoachSchema = z.object({
  tip_zh: z.string().describe("次の1回で直すべき一番大事な点（中国語、1〜2文）。どの語のどの音か、どう言えばいいかを具体的に"),
  words: z
    .array(z.object({ word: z.string(), kana: z.string().describe("その語の読み（ひらがな）"), why_zh: z.string().describe("どこがずれやすいか、コツ（中国語、短く）") }))
    .describe("注意すべき語を最大3個。点数が低い語や、中国語話者が間違えやすい長音・促音・撥音・拗音を優先"),
  score_doubt: z
    .boolean()
    .describe("認識結果が手本とほぼ同じなのに総合点が極端に低い（50未満など）、つまり採点の不具合が疑われるなら true"),
  doubt_zh: z.string().describe("score_doubt が true のとき、学習者への一言（中国語）。そうでなければ空文字"),
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
学習者は手本の音声を聞いて、同じ文をまねして言う練習（シャドーイング）をしています。
発音評価の点数と認識結果を見て、次の1回で何を直せばいいかを1つに絞って伝えてください。点数をそのまま読み上げない。`,
    `手本：${a.ja}
読み：${a.kana || "（なし）"}
認識結果：${a.said}
${
  s
    ? `総合 ${s.pron}・正確さ ${s.accuracy}・流暢さ ${s.fluency}・完全さ ${s.completeness}
語ごと：${s.words.map((w) => `${w.word}(${w.accuracy}${w.errorType !== "None" ? `,${w.errorType}` : ""})`).join(" ")}`
    : "発音評価なし"
}`,
  );
}

// 对话: a quiet note on each line the learner says, without breaking the conversation.
const TurnCheckSchema = z.object({
  verdict: z.enum(["good", "ok", "off"]).describe("good: この場面で自然。ok: 通じるが直したい所がある。off: 意味が通じない・場面に合わない"),
  better: z.string().describe("より自然な言い方（日本語、1文）。good なら空文字"),
  why_zh: z.string().describe("一言の説明（中国語、1文）。good なら褒める一言"),
  points: PointsSchema,
});

export type TurnCheck = z.infer<typeof TurnCheckSchema>;

export function checkTurn(s: Talk, history: Turn[], known?: string[]) {
  const said = history[history.length - 1]?.text ?? "";
  const before = history.slice(-5, -1);
  return haikuFirst(
    TurnCheckSchema,
    `${COACH}
学習者はロールプレイで会話をしています。学習者の最後の発言だけを見て、その場面で自然かどうかを判定してください。
言い方の違いだけで減点しない。丁寧さが相手や場面に合っているかは見る。${knownLine(known)}`,
    `場面：${s.talk.setup}
相手：${s.talk.aiRole}
学習者の役：${s.talk.userRole}
目標：${s.talk.goalZh}
直前の会話：
${before.map((t) => `${t.role === "user" ? "学習者" : "相手"}：${t.text}`).join("\n") || "（なし）"}
学習者の発言：${said}`,
  );
}

// 复习: a fresh sentence built on the same pattern, so a card isn't memorised as one fixed string.
const VariantSchema = z.object({
  zh: z.string().describe("学習者に見せる中国語（言いたいこと）"),
  ja: z.string().describe("元の文と同じ文法・表現を使い、内容や場面を少し変えた自然な日本語。元の文と同じくらいの長さ"),
  reading: z.string().describe("ja の全文をひらがなで"),
  pattern_zh: z.string().describe("元の文と共通する文法・表現（中国語、短く）"),
});

export type Variant = z.infer<typeof VariantSchema>;

export function makeVariant(c: { ja: string; zh: string }) {
  return haikuFirst(
    VariantSchema,
    `${COACH}
学習者が覚えた文の復習用に、同じ文法・表現を使った別の文を1つ作ってください。語彙は N3 程度。職場や日常生活でそのまま使える文にする。`,
    `元の文：${c.ja}
意味：${c.zh}`,
  );
}

// 通勤播客: a short daily audio episode built from the learner's own weak points and saved phrases.
const PodcastSchema = z.object({
  title_zh: z.string().describe("今日のエピソードのタイトル（中国語、15字以内）"),
  segments: z
    .array(
      z.object({
        kind: z
          .enum(["zh", "ja", "repeat"])
          .describe("zh: 中国語の解説（パーソナリティが話す）。ja: 日本語の例文を読み上げる。repeat: 日本語の文を読み、聞き手が心の中で繰り返す間を空けて、もう一度読む"),
        text: z.string().describe("読み上げる文。zh は中国語1〜3文、ja と repeat は日本語1文（30字以内）"),
        zh: z.string().describe("ja と repeat のときの中国語訳。zh のときは空文字"),
      }),
    )
    .describe("全体で約3分。20〜30個。最初に今日のテーマを中国語で紹介し、最後に中国語で一言励ます"),
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
学習者が通勤電車で聞く、約3分の個人向け音声番組の台本を作ってください。画面は見ない前提です。
- 解説は中国語、例文は日本語。中国語の解説は短く、すぐ日本語の例文に行く。
- 学習者の弱点（文法・表現）を1〜2個取り上げ、実際に言い間違えた文と正しい言い方を対比する。
- 保存した表現を使った例文を repeat で何度か入れる。repeat の文は短く、そのまま職場や生活で使える文にする。
- 例文の場面は学習者が練習している場面に合わせる。
- 弱点や保存した表現がなければ、職場と生活でよく使う N3 の表現を選ぶ。`,
    `弱点：
${a.weak.map((w) => `- ${w.tag}（${w.zh}）${w.examples.map((e) => ` 言った：${e.said} → 正：${e.better}`).join("")}`).join("\n") || "（なし）"}
保存した表現：
${a.cards.map((c) => `- ${c.ja}（${c.zh}）`).join("\n") || "（なし）"}
練習している場面：${a.scenes.join("、") || "（なし）"}`,
  );
}

// 趣味电台 (lib/radio.ts) when Gemini isn't available.
export function makeRadioWithClaude<S extends z.ZodType>(schema: S, system: string, content: string) {
  return haikuFirst(schema, system, content, 5000);
}

// 问 AI: the learner selected a word, phrase or line they don't get; explain just that, in context.
const ExplainSchema = z.object({
  reading: z.string().describe("選ばれた部分の読み（ひらがな）。中国語だけが選ばれた場合は空文字"),
  meaning_zh: z.string().describe("この文脈での意味（中国語、1〜2文）"),
  points: z
    .array(z.object({ ja: z.string().describe("見出しだけ：語や文型そのもの（日本語、15字以内、説明は書かない）。例：「もったいぶる」「〜とか」"), zh: z.string().describe("説明（中国語、1〜2文）") }))
    .describe("分解して説明すべき語や文法、1〜4個。選ばれた部分が単語ひとつなら、その語の使い方を1個"),
  nuance_zh: z.string().describe("語感・場面・言い換え（中国語、1〜2文）。とくになければ空文字"),
  example: z.object({ ja: z.string().describe("日常や職場で使える別の例文（日本語、短く）"), zh: z.string() }),
});

export type Explain = z.infer<typeof ExplainSchema>;

export function explainSelection(a: { pick: string; line: string; before?: string; topic: string }) {
  return haikuFirst(
    ExplainSchema,
    `${COACH}
学習者は日本語のポッドキャストの文稿を読んでいて、分からない部分を選んで質問しています。質問文はありません。選ばれた部分だけを、その文脈での意味として説明してください。前置きや一般論は不要。`,
    `番組のテーマ：${a.topic}
${a.before ? `直前のセリフ：${a.before}\n` : ""}選ばれた部分を含む文：${a.line}
選ばれた部分：${a.pick}`,
  );
}
