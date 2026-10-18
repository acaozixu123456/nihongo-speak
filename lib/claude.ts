import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { Scenario } from "@/content/scenarios";
import { variantOk } from "@/lib/variant";

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

// After a conversation: one thing to fix next time, with the line that shows it, and one phrase to
// keep. Not a list: the learner acts on one point, and that point goes into the weak points.
const FeedbackSchema = z.object({
  overall_zh: z.string().describe("一言の講評（中国語、1文）。まず言えた点を認める"),
  focus_zh: z.string().describe("次に話すとき直すべき一番大事なこと、1つだけ（中国語、1〜2文）。何をどう言えばいいか具体的に"),
  fix: z.object({
    you_said: z.string().describe("focus_zh を一番よく表す、学習者が実際に言った日本語。該当がなければ空文字"),
    better: z.string().describe("その場面でより自然な言い方。you_said が空なら空文字"),
    why_zh: z.string().describe("なぜそう言うのか（中国語、短く）。空ならば空文字"),
  }),
  point: z.object({
    tag: z.string().describe("focus_zh にあたる文法・表現の名前（日本語、短く）。例：「〜てもらえますか（依頼）」「敬語：いらっしゃいます」。文法・表現で言えないなら空文字"),
    zh: z.string().describe("その文法・表現が何か（中国語、1文）。tag が空なら空文字"),
  }),
  phrases: z
    .array(z.object({ ja: z.string(), reading: z.string(), zh: z.string() }))
    .describe("この場面で次も使える表現を1個だけ"),
  memory_ja: z
    .string()
    .describe("相手が次の電話で話題にできる、学習者について分かったこと（日本語、1〜2文、学習者の予定・事情・好みなど）。特にないなら空文字"),
});

export async function feedback(s: Talk, history: Turn[], known?: string[]) {
  const transcript = history
    .map((t) => `${t.role === "user" ? "学習者" : "相手"}：${t.text}`)
    .join("\n");
  const res = await parse({
    model: MODEL,
    max_tokens: 4000,
    system: `あなたは日本在住の社会人向けの日本語コーチです。学習者は中国人、レベルはN4〜N3。
場面：${s.talk.setup}
学習者の役：${s.talk.userRole}

会話の記録を見て、学習者が次に直すべきことを1つだけ選んでください。
- 学習者の発言は音声認識の結果。認識ミスらしきものは指摘しない。
- 一番効果が大きいもの（意味が通じなくなる誤り ＞ 敬語のレベル ＞ 不自然さ ＞ より短く言える）を1つ。他は書かない。
- 説明は中国語で、具体的に。${knownLine(known)}`,
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

// ---- Judging one spoken answer (瞬间说 / 复习) ----

const JudgeSchema = z.object({
  verdict: z
    .enum(["good", "ok", "off"])
    .describe("good: その場面でそのまま通じる自然な言い方。ok: 意味は通じるが直したい所がある。off: 意味が違う・通じない・ほとんど言えていない"),
  summary_zh: z.string().describe("一言の講評（中国語、1文）。まず言えた点を認める"),
  right_zh: z.string().describe("良かった点（中国語、短く）。なければ空文字"),
  fixes: z
    .array(z.object({ you_said: z.string(), better: z.string(), why_zh: z.string() }))
    .describe("直すべき箇所を一番大事なもの1個だけ。音声認識の誤りらしきものは含めない。good なら空配列"),
  others: z
    .array(z.object({ ja: z.string(), zh: z.string().describe("どんな時に使うか（中国語、短く）") }))
    .describe("同じ意味の別の言い方を1個。丁寧さやくだけ具合が違うもの、より短いものなど"),
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

export const COACH = `あなたは日本在住の社会人向けの日本語コーチです。学習者は中国人、レベルはN4〜N3。日本で働き、生活しています。
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
  ja: z
    .string()
    .describe("元の文と同じ文法・表現を使い、内容や場面を少し変えた自然な日本語の1文。元の文が短い一言でも、何について言うのかが分かる具体的な文にする（40字以内）"),
  zh: z
    .string()
    .describe("上の ja を一語も省かずそのまま中国語に訳した文（1文、40字以内）。ja の内容（誰が・何を・どうした）が全部入っていること。学習者はこれを見て日本語で言う。出題の説明・指示・文法の解説・「翻訳して」などは絶対に書かない"),
  reading: z.string().describe("ja の全文をひらがなで"),
  pattern_zh: z.string().describe("元の文と共通する文法・表現（中国語、短く）"),
});

export type Variant = z.infer<typeof VariantSchema>;

export async function makeVariant(c: { ja: string; zh: string }) {
  const ask = () =>
    haikuFirst(
      VariantSchema,
      `${COACH}
学習者が覚えた文の復習用に、同じ文法・表現を使った別の文を1つ作ってください。語彙は N3 程度。職場や日常生活でそのまま使える文にする。
zh は画面に大きく出る「言いたいこと」です。ja の中国語訳だけを書き、指示や説明は書かないこと。
元の文が短い一言なら、場面が分かる具体的な文に広げる。例：元の文「助かります！」→ ja「資料を送ってもらえると助かります。」zh「你能把资料发给我的话就帮大忙了。」`,
      `元の文：${c.ja}
意味：${c.zh}`,
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
  // A show of 30-40 lines with notes, in JSON: 5000 tokens cut it off.
  return haikuFirst(schema, system, content, 14000);
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
学習者は日本語学習アプリの画面（ラジオの文稿、練習問題、例文、講評など）を読んでいて、分からない部分を選んで質問しています。質問文はありません。選ばれた部分だけを、その文脈での意味として説明してください。中国語の部分が選ばれたら、その日本語での言い方を中心に説明する。前置きや一般論は不要。`,
    `画面：${a.topic}
${a.before ? `直前のセリフ：${a.before}\n` : ""}選ばれた部分を含む文：${a.line}
選ばれた部分：${a.pick}`,
  );
}

// ---- 三回話す: tell today's episode three times, to three people ----

// After the first telling: the one point to fix in the next two, from what the learner actually said.
// Corrected between the first and second telling only, and on one form, as in Tran & Saito's 4/3/2 + delayed CF.
const RetellFixSchema = z.object({
  fix: z.object({
    you_said: z.string().describe("学習者が実際に言った日本語（その一節だけ）。直すところがなければ空文字"),
    better: z.string().describe("その一節の自然な言い方。you_said が空なら空文字"),
  }),
  focus_zh: z.string().describe("次の2回で気をつける、たった一つのこと（中国語、1文、具体的に）。直すところがなければ、もっと話を広げるための一言"),
  point: z.object({
    tag: z.string().describe("その文法・表現の名前（日本語、短く）。文法の名前で言えなければ、直した言葉そのもの（例：「〜てしまう」「おいしかった」）。you_said が空なら空文字"),
    zh: z.string().describe("その文法・表現が何か（中国語、1文）。tag が空なら空文字"),
  }),
  carried: z.boolean().describe("前の日から持ち越した注意点が、1回目で正しく使えていれば true。使う場面がなく誤りもなければ true。持ち越しがなければ true"),
});
export type RetellFix = z.infer<typeof RetellFixSchema>;

export function retellFix(a: { topic: string; said: string; known?: string[]; carry?: { focus_zh: string; better: string } }) {
  return haikuFirst(
    RetellFixSchema,
    `${COACH}
学習者はラジオで聞いた話を、自分の言葉で人に話しています（同じ話をあと2回、別の人に話します）。
1回目の録音の文字起こしを見て、次の2回で直すべきことを1つだけ選んでください。意味が通じなくなる誤り ＞ 何度も出る誤り ＞ 不自然さ の順。
話の中身や長さは評価しない。言い直し・えっと・繰り返しは誤りとして扱わない。
前の日から持ち越した注意点があれば、それが正しく使えたかも見る。まだ直っていなければ、それを今日の1つに選んでよい。${knownLine(a.known)}`,
    `話のテーマ：${a.topic}
${a.carry ? `前の日から持ち越した注意点：${a.carry.focus_zh}（正しい形の例：${a.carry.better}）\n` : ""}1回目：${a.said}`,
  );
}

// After the third telling: whether the point stuck, and the learner's own story said naturally, to hear
// as "this is you, a little further on" rather than as a correction.
const RetellEndSchema = z.object({
  used: z.boolean().describe("3回目で、指摘した点が正しく使えていれば true。その文法を使う場面がなかった場合も、誤りがなければ true"),
  praise_zh: z.string().describe("1回目から3回目で良くなった具体的な一点（中国語、1文）。お世辞ではなく、実際の違いを"),
  natural: z
    .array(
      z.object({
        you: z.string().describe("3回目で学習者が実際に言った一節（文字起こしのまま。えっと等は省いてよい）"),
        ja: z.string().describe("その一節の自然な言い方。内容は変えない。N3程度の語彙で、話し言葉で"),
        zh: z.string(),
      }),
    )
    .describe("3回目の話を前から順に3〜5か所に区切り、学習者の言い方と自然な言い方を対にしたもの。直すところがない一節は you と ja が同じでよい"),
});
export type RetellEnd = z.infer<typeof RetellEndSchema>;

export function retellEnd(a: { topic: string; first: string; last: string; focus: string }) {
  return haikuFirst(
    RetellEndSchema,
    `${COACH}
学習者はラジオで聞いた話を、同じ内容で3回、別の人に話しました。1回目と3回目の文字起こしを見てください。`,
    `話のテーマ：${a.topic}
1回目のあとに伝えた注意：${a.focus || "（なし）"}
1回目：${a.first}
3回目：${a.last}`,
  );
}

// 三回話す's speed is counted in morae, the unit Japanese speech rate is measured in: the transcript
// writes the same word as 今日 (2 characters) one time and きょう (3) the next, so characters drift.
const RetellKanaSchema = z.object({ kana: z.string().describe("文字起こし全体の読み。ひらがなとカタカナと「ー」だけで、ひと続きに書く") });

// One call per text: asked for several at once (as a list), Haiku split the reading into single kana.
export async function retellKana(texts: string[]): Promise<string[]> {
  return Promise.all(
    texts.map(async (t) => {
      const { kana } = await haikuFirst(
        RetellKanaSchema,
        "日本語の文字起こしを、読みのとおりにかなだけで書き直す。漢字・数字・ローマ字は読みに直し、句読点や記号は書かない（読み上げない）。言い直しや「えっと」もそのまま残す。",
        t,
        3000,
      );
      return kana;
    }),
  );
}

// ---- Readings for the speech model ----

// The kana reading of text written only in kanji (細菌 → さいきん), so Gemini TTS doesn't read it
// in Chinese. Backs up Gemini's own answer in /api/tts. Null when no clean reading comes back.
const ReadingSchema = z.object({ kana: z.string().describe("読み方（ひらがなだけ）") });

export async function kanaReading(text: string): Promise<string | null> {
  const { kana } = await haikuFirst(ReadingSchema, "日本語の読み方をひらがなだけで答える。記号や数字も読みに直す。", text, 300);
  return /^[぀-ヿ\s、。！？・ー]+$/.test(kana.trim()) ? kana.trim() : null;
}

// ---- 洗脑歌: lyrics as they are sung ----

const SungSchema = z.object({
  lines: z.array(z.string().describe("その行を、歌うとおりにかなだけで書いたもの")),
});

// Lyria sings kanji with the wrong reading (細菌 as しょーべる…, 工面 as こうめ), so it is given the
// lyrics in kana only. Particles are written as they sound (は→わ, へ→え) so it doesn't sing "ha".
export async function sungKana(lines: string[]): Promise<string[]> {
  const { lines: out } = await haikuFirst(
    SungSchema,
    `日本語の歌詞を、歌手がそのまま歌える「かなだけ」の歌詞に書き直す。
- 漢字はすべて、その文脈での正しい読みのひらがなにする。外来語・カタカナ語はカタカナのまま。
- 助詞の「は」「へ」は発音どおり「わ」「え」と書く。「を」はそのまま。
- 区切りのスペース、！や？などの記号、繰り返しは元のまま残す。言葉を足したり削ったりしない。
- 1行に1つ、同じ数・同じ順で返す。`,
    lines.map((l, i) => `${i + 1}. ${l}`).join("\n"),
    3000,
  );
  if (out.length !== lines.length) throw new Error("歌词注音行数不对");
  const kana = /^[぀-ヿ\s、。！？!?…〜ー・,.「」]+$/;
  return out.map((k, i) => (kana.test(k.trim()) ? k.trim() : lines[i]));
}

// ---- 予行演習: rehearse a real conversation that is coming up ----

const RehearsePlanSchema = z.object({
  titleZh: z.string().describe("この会話の短い名前（中国語、10字以内）。例：跟课长请假"),
  person: z
    .enum(["yamada", "tanaka", "yui", "sato", "none"])
    .describe("相手がいつもの人物なら：yamada＝山田課長（上司）、tanaka＝取引先の田中様、yui＝友達のゆい、sato＝同僚の佐藤さん。ほかの相手なら none"),
  who: z.string().describe("相手の呼び名（日本語、短く）。例：山田課長、区役所の窓口、美容師さん"),
  gender: z.enum(["male", "female"]).describe("相手の性別"),
  aiRole: z.string().describe("AI が演じる相手の役と話し方（日本語、1〜2文）"),
  userRole: z.string().describe("学習者の役（日本語、短く）"),
  goalZh: z.string().describe("学習者がこの会話で言えるようになること（中国語、1〜2文）"),
  setup: z.string().describe("場面の説明と、相手がどう進めるか（日本語、2〜4文）。対面か電話かも書く"),
  opening: z.object({ ja: z.string(), zh: z.string() }).describe("会話の最初の一言。学習者から話しかける場面なら、相手の短い呼びかけ（例：「はい、どうしました？」）"),
  twists: z
    .array(z.string())
    .describe("3つ。各回の相手がどう反応するかの説明（日本語、1文。セリフではなく「〜する」の形で）。1回目：スムーズに受け入れる。2回目：理由や詳しいことを追加で質問する。3回目：小さな問題が起きる（都合が悪い、書類が足りない、など）が、話し合えば解決できる"),
  lines: z
    .array(z.object({ ja: z.string(), kana: z.string().describe("ja の全文をひらがなで"), zh: z.string() }))
    .describe("この会話で学習者がそのまま使える自然な言い方を3つ。短く（25字以内）、実際の日本でよく使う言い方"),
});

export type RehearsePlan = z.infer<typeof RehearsePlanSchema>;

export function rehearsePlan(askZh: string) {
  return haikuFirst(
    RehearsePlanSchema,
    `あなたは日本語の会話練習の作者です。学習者は日本に住んでIT企業で働いている中国人で、日本語レベルはJLPT N4〜N3です。
学習者が「これから実際にする会話」を書いてきます。その会話を、AI が相手役になって3回練習できるように設定を作ってください。
- 本当にその場で起きそうな、自然な日本の職場・生活の会話にする。
- 3回とも同じ用件で、相手の反応だけが変わる（twists）。
- 語彙と文法は N3 程度。ただし実際によく使う表現はそのまま使う。`,
    `これからする会話：${askZh}`,
    3000,
  );
}

const RehearseDebriefSchema = z.object({
  noteZh: z.string().describe("一言（中国語、1文）。まず実際に話せたことを認める"),
  missed: z
    .array(z.object({ ja: z.string(), kana: z.string().describe("ja の全文をひらがなで"), zh: z.string() }))
    .describe("学習者が実際の会話で言えなかったこと・うまく言えなかったことを、その場で使える自然な日本語にしたもの。0〜2個、短く（25字以内）"),
});

export type RehearseDebrief = z.infer<typeof RehearseDebriefSchema>;

export function rehearseDebrief(a: { askZh: string; report: string }) {
  return haikuFirst(
    RehearseDebriefSchema,
    `学習者（日本に住む中国人、日本語 N4〜N3）が、前もって練習した会話を実際にしてきました。どうだったかの報告（中国語か日本語）を読んで、言えなかったことを次に言えるようにする。報告に言えなかったことが無ければ missed は空配列。`,
    `練習した会話：${a.askZh}\n報告：${a.report}`,
    2000,
  );
}

// ---- 洗脑连播: one short sentence for each grammar point, to hear and say along ----

const ExamplesSchema = z.object({
  items: z.array(
    z.object({
      ja: z.string().describe("「訳すだけ」の項目はその文をそのまま。「作る」の項目は、その文法を使った短く自然な例文（1文、20字以内が目安、N4〜N3）"),
      zh: z.string().describe("ja の中国語訳（1文、説明は書かない）"),
    }),
  ),
});

export async function pointExamples(points: { pattern: string; zh: string; seed?: string }[]) {
  const r = await haikuFirst(
    ExamplesSchema,
    `${COACH}
学習者が声に出して真似する例文のリストを作ります。項目は2種類：
- 「作る」：その文法・表現を必ず使った例文を1つ作る。職場や日常生活で実際に言う文。記号（N、V、／、〜）や括弧書きの説明は入れない。
- 「訳すだけ」：書かれた日本語の文を一字も変えずに ja に写し、zh に訳を書く。
入力と同じ順番、同じ数で返す。`,
    points.map((p, i) => (p.seed ? `${i + 1}. 訳すだけ：${p.seed}` : `${i + 1}. 作る：${p.pattern}（${p.zh}）`)).join("\n"),
    1500,
  );
  return r.items.slice(0, points.length);
}
