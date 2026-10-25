import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { Scenario } from "@/content/scenarios";
import { helpRules, type HelpCtx } from "@/lib/help-prompt";
import { inJapanese, japaneseZh, variantOk, zhIsTranslation } from "@/lib/variant";

// Only the role-play part of a scenario is needed here.
type Talk = Pick<Scenario, "talk">;

// Haiku for quick plumbing (replies, readings, titles). Judging the learner's Japanese goes to Opus:
// it decides what they learn. effort low where they wait on every line, medium for one review of a
// whole telling. Opus thinks inside max_tokens, so its calls get extra room.
const MODEL = "claude-haiku-5-5";
const SMART = "claude-opus-5-5";
type Effort = "low" | "medium" | "high";
// Compared on real answers (2026-10-19): only Opus took speech-recognition slips as slips, not mistakes.
const smart = (maxTokens: number) => ({ model: SMART, max_tokens: maxTokens + 12000 });
// A key created outside any workspace must name one on every request.
const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
const client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});

// Haiku drifts into Japanese when the instructions are in Japanese, so every call ends with this.
const ZH_RULE = `

【出力の言語】中国語の項目（名前が zh・_zh・Zh で終わるもの：講評、説明、理由、訳）は、必ず簡体字の中国語で書く。日本語で書いてはいけない。
日本語の項目（ja、better、reading、kana、例文、言い換え）は日本語のまま。`;
// …and still writes some of them in Japanese now and then. Such an answer is asked for once more, with
// the fields named; the second answer is used only if it is better. Long writing (radio scripts,
// scenarios) isn't asked again: it would not fit in the request's time.
const parse: typeof client.messages.parse = (async (params: Parameters<typeof client.messages.parse>[0], options?: Parameters<typeof client.messages.parse>[1]) => {
  const system = `${params.system ?? ""}${ZH_RULE}`;
  const first = await client.messages.parse({ ...params, system }, options);
  const bad = params.model === MODEL && params.max_tokens > 4000 ? [] : japaneseZh(first.parsed_output);
  if (!bad.length) return first;
  console.warn("Chinese fields in Japanese, asking again:", bad.join(" "));
  const again = await client.messages
    .parse({ ...params, system: `${system}\n前回は ${bad.join("、")} を日本語で書いてしまいました。これらは必ず中国語（簡体字）で書くこと。` }, options)
    .catch(() => null);
  return again && japaneseZh(again.parsed_output).length < bad.length ? again : first;
}) as unknown as typeof client.messages.parse;

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
    zh: z.string().describe("better の中国語訳（簡体字）。説明ではなく訳だけ。中国語を見て日本語を言う復習に使う。better が空なら空文字"),
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
    ...smart(4000),
    system: `あなたは日本在住の社会人向けの日本語コーチです。学習者は中国人、レベルはN4〜N3。
場面：${s.talk.setup}
学習者の役：${s.talk.userRole}

会話の記録を見て、学習者が次に直すべきことを1つだけ選んでください。
- 学習者の発言は音声認識の結果。認識ミスらしきものは指摘しない。
- 一番効果が大きいもの（意味が通じなくなる誤り ＞ 敬語のレベル ＞ 不自然さ ＞ より短く言える）を1つ。他は書かない。
- 説明は中国語で、具体的に。${knownLine(known)}`,
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
const TranslationSchema = z.object({ zh: z.string().describe("中国語訳（簡体字）。訳だけ。説明・注釈・日本語は書かない") });
async function cardZh(ja: string, zh: string) {
  if (!ja || zhIsTranslation(zh)) return ja ? zh : "";
  try {
    const t = await haikuFirst(TranslationSchema, "日本語の文を自然な中国語（簡体字）に訳してください。", ja, 300);
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
    ...smart(4000),
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
    ...smart(4000),
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
    output_config: { effort: "medium", format: zodOutputFormat(DrillSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error("AI 返回格式不对，请重试");
  // The Chinese is the question: one with Japanese in it shows the answer, so it isn't asked.
  const items = res.parsed_output.items.filter((x) => !inJapanese(x.zh, 2));
  if (!items.length) throw new Error("AI 返回格式不对，请重试");
  return { ...res.parsed_output, items };
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
    3000,
    "low",
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
    3000,
    "low",
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

// After the first telling: the one thing to work on in the next two, from what the learner actually said.
// Corrected between the first and second telling only, and on one thing, as in Tran & Saito's 4/3/2 +
// delayed CF. When the learner got stuck mid-sentence, that is the one thing: the words they were
// looking for, preferring ones the next story can use too (de Jong & Perfetti), and a way around the
// word with easy words (communication strategies, Dörnyei 1995).
const Carried = z
  .enum(["right", "wrong", "unused"])
  .describe("注意点を使う場面で正しく言えた：right。間違えた：wrong。使う場面がなかった・避けた：unused（right にしない）。注意点がなければ unused");
const RetellFixSchema = z.object({
  stall: z.object({
    you_said: z.string().describe("詰まる直前に学習者が言った言葉（文字起こしのまま、短く）。詰まった箇所が示されていなければ空文字"),
    better: z.string().describe("学習者がそこで言おうとしたことの自然な言い方（日本語、1文、N3程度）。次の話でも使える汎用的な言い回しを優先。示されていなければ空文字"),
    around: z.string().describe("詰まったのが特定の単語なら、その単語を使わず簡単な言葉で言い換えた言い方（日本語）。不要なら空文字"),
    zh: z.string().describe("better の中国語訳（簡体字）。説明ではなく訳だけ。中国語を見て日本語を言う練習に使う。示されていなければ空文字"),
  }),
  fix: z.object({
    you_said: z.string().describe("学習者が実際に言った日本語（その一節だけ）。直すところがなければ空文字"),
    better: z.string().describe("その一節の自然な言い方。you_said が空なら空文字"),
  }),
  focus_zh: z
    .string()
    .describe("次の2回で気をつける、たった一つのこと。簡体字の中国語で1文、30字以内（例：「下一遍把动词说完整，用「〜ました」结尾。」）。日本語は「」で引く語だけ。直すところがなければ、もっと話を広げるための一言（これも中国語）"),
  point: z.object({
    tag: z.string().describe("その文法・表現の名前（日本語、短く）。文法の名前で言えなければ、直した言葉そのもの（例：「〜てしまう」「おいしかった」）。you_said が空なら空文字"),
    zh: z.string().describe("その文法・表現が何か（中国語、1文）。tag が空なら空文字"),
  }),
  carried: Carried,
});
export type RetellFix = z.infer<typeof RetellFixSchema>;
export type RetellStall = { before: string; after: string; secs: number };

type FixArgs = { topic: string; said: string; known?: string[]; carry?: { focus_zh: string; better: string }; stall?: RetellStall };

export async function retellFix(a: FixArgs) {
  // parse() already asks once more when the tip comes back in Japanese; if it still does, fall back to a
  // plain Chinese line around the corrected words.
  const r = await retellFixOnce(a, false);
  const f = { ...r, stall: { ...r.stall, zh: await cardZh(r.stall.better, r.stall.zh) } };
  if (!inJapanese(f.focus_zh) && !inJapanese(f.point.zh)) return f;
  return {
    ...f,
    focus_zh: f.fix.better ? `下一遍这样说：「${f.fix.better}」` : "下一遍多讲一点细节。",
    point: { ...f.point, zh: inJapanese(f.point.zh) ? "" : f.point.zh },
  };
}

function retellFixOnce(a: FixArgs, again: boolean) {
  return haikuFirst(
    RetellFixSchema,
    `${COACH}
学習者はラジオで聞いた話を、自分の言葉で人に話しています（同じ話をあと2回、別の人に話します）。
1回目の録音の文字起こし（聞こえたとおりの逐語。（…2.1秒…）は1秒以上黙ったところ、（…詰まった 2.1秒…）は文の途中で黙ったところ）を見て：
- 詰まった箇所が示されていれば、そこで言おうとしたことを stall に書く。
- 次の2回で直すべきことを1つだけ fix に選ぶ。意味が通じなくなる誤り ＞ 何度も出る誤り ＞ 不自然さ の順。弱点記録にある誤りが今日も出ていれば優先。
話の中身や長さは評価しない。言い直し・えっと・繰り返しは誤りとして扱わない。
前の日から持ち越した注意点があれば、それが正しく使えたかを carried に書く。まだ直っていなければ、それを今日の1つに選んでよい。
focus_zh・point.zh・stall.zh は学習者が画面で読む説明なので、必ず簡体字の中国語で、短く書く。${again ? "\n前回の答えは focus_zh が日本語になっていた。今度は必ず中国語で書くこと。" : ""}${knownLine(a.known)}`,
    `話のテーマ：${a.topic}
${a.carry ? `前の日から持ち越した注意点：${a.carry.focus_zh}（正しい形の例：${a.carry.better}）\n` : ""}${a.stall ? `一番長く詰まった箇所（${a.stall.secs}秒）：「${a.stall.before}」（詰まる）「${a.stall.after}」\n` : ""}1回目：${a.said}`,
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
        ja: z.string().describe("キーワード（表記のまま）"),
        use: z
          .enum(["fluent", "shaky", "unused"])
          .describe(
            "fluent：その語（活用形でよい）を正しい意味・形で、直前直後に詰まり（…）や言い直し・えっとがなく、文の中で自然に言えた。shaky：使ったが、間違えた・詰まった・言い直した・言いよどんだ・不自然。unused：使っていない。迷ったら shaky",
          ),
      }),
    )
    .describe("今のキーワード全部について、今回の話での使い方"),
  spare: z
    .array(z.object({ ja: z.string().describe("語（表記どおり、短く）"), kana: z.string().describe("読み（ひらがな）") }))
    .describe(
      "キーワードと入れ替えるための新しい語を、役に立つ順に3個。候補の語を優先し、学習者がまだ使っていない、この話を言うのに役立つ語。学習者が言おうとして言えなかった語があればそれを最優先。今のキーワードと同じ語は入れない",
    ),
});
export type RetellKeys = { keys: { ja: string; kana: string }[]; done: string[]; runs: Record<string, number> };

type KeysArgs = { topic: string; keys: { ja: string; kana?: string; runs?: number }[]; pool: { ja: string; kana?: string }[]; said: string[] };

export async function retellKeys(a: KeysArgs): Promise<RetellKeys> {
  const r = await haikuFirst(
    RetellKeysSchema,
    `${COACH}
学習者は同じ話を3回、別の人に話します。画面には話の助けになるキーワードが出ています。最新の回で、それぞれのキーワードがどう使えたかを厳しめに判定してください（本当に使いこなせた時だけ fluent）。文字起こしの（…2.1秒…）は黙ったところ、（…詰まった…）は文の途中で詰まったところ。
キーワードがない場合は、学習者が言おうとして言えなかった語・言えたらもっと話せる語を spare に入れる。`,
    `話のテーマ：${a.topic}
今のキーワード：${a.keys.length ? a.keys.map((k) => k.ja).join("、") : "（なし）"}
候補の語：${a.pool.map((k) => k.ja).join("、") || "（なし）"}
${a.said.map((t, i) => `${i === a.said.length - 1 ? "最新の回" : `${i + 1}回目`}：${t}`).join("\n")}`,
    1500,
    "low",
  );
  const use = new Map(r.rated.map((x) => [x.ja, x.use]));
  const runs = Object.fromEntries(
    a.keys.map((k) => {
      const u = use.get(k.ja) ?? "unused";
      return [k.ja, u === "fluent" ? (k.runs ?? 0) + 1 : u === "shaky" ? 0 : (k.runs ?? 0)];
    }),
  );
  const spare = r.spare
    .map((k) => ({ ja: k.ja.trim(), kana: k.kana.trim() }))
    .filter((k) => k.ja && k.ja.length <= 16 && !a.keys.some((x) => x.ja === k.ja));
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
  used: Carried.describe("3回目で、指摘した点を使う場面で正しく言えた：right。間違えた：wrong。使う場面がなかった・避けた：unused。指摘がなければ unused"),
  praise_zh: z.string().describe("1回目から3回目で良くなった具体的な一点（中国語、1文）。お世辞ではなく、実際の違いを"),
  natural: z
    .array(
      z.object({
        you: z.string().describe("3回目で学習者が実際に言った一節（文字起こしのまま。えっと等は省いてよい）"),
        ja: z.string().describe("その一節の自然な言い方。内容は変えない。N3程度の語彙で、話し言葉で"),
        zh: z.string().describe("ja の中国語訳（簡体字）。説明ではなく訳だけ"),
      }),
    )
    .describe("3回目の話を前から順に3〜5か所に区切り、学習者の言い方と自然な言い方を対にしたもの。直すところがない一節は you と ja が同じでよい"),
});
export type RetellEnd = z.infer<typeof RetellEndSchema>;

export function retellEnd(a: { topic: string; first: string; last: string; focus: string }) {
  return haikuFirst(
    RetellEndSchema,
    `${COACH}
学習者はラジオで聞いた話を、同じ内容で3回、別の人に話しました。1回目と3回目の文字起こし（聞こえたとおりの逐語）を見てください。`,
    `話のテーマ：${a.topic}
1回目のあとに伝えた注意：${a.focus || "（なし）"}
1回目：${a.first}
3回目：${a.last}`,
    3000,
    "medium",
  );
}

// The day after: which of yesterday's natural sentences the learner now used when telling the story
// again. Using a corrected form oneself is what predicts keeping it (Loewen 2005).
const RetellUptakeSchema = z.object({
  used: z
    .array(z.string())
    .describe("昨日の自然な言い方の中にあって、今日の話で学習者がほぼ同じ形で使った言い回し（自然な言い方からそのまま抜き出す、2〜15字）。話題の名詞だけのものは入れない。なければ空配列"),
});

export async function retellUptake(a: { natural: string[]; said: string }) {
  const { used } = await haikuFirst(
    RetellUptakeSchema,
    `${COACH}
学習者は昨日話した話を、今日もう一度話しました。昨日、学習者の話を自然な言い方に直したものを見せています。今日の文字起こしと比べてください。`,
    `昨日の自然な言い方：\n${a.natural.map((x) => `・${x}`).join("\n")}\n今日：${a.said}`,
    1000,
  );
  return used.filter((u) => a.natural.some((n) => n.includes(u))).slice(0, 3);
}

// 三回話す: Gemini writes each piece of a telling down; reading the pieces is text only, and Haiku does
// it in about half the time Gemini took (3-4s against 7s), while the learner waits.
const RetellReadSchema = z.object({
  cut: z.array(z.boolean()).describe("各部分について順に：文の途中で止まっていれば true、文や節の切れ目なら false"),
  reaction: z.string().describe("聞き手が話を聞き終わってすぐ言う一言（日本語、15〜30字）"),
  good: z.string().describe("学習者の発話からそのまま抜き出した、うまく言えた日本語の表現一つ（3〜15字）。なければ空文字"),
});

// good: one thing said well, word for word from the telling, so the learner knows what to keep saying
// (praise of a specific act, not of the person). Nothing when nothing stands out; never one already
// praised on an earlier day.
export async function retellRead(a: { pieces: string[]; topic: string; listener: string; avoid?: string[] }) {
  return haikuFirst(
    RetellReadSchema,
    `日本語学習者がテーマ「${a.topic}」について人に話しました。1秒以上黙ったところで区切った文字起こしです（間違いもそのまま）。
cut：各部分（${a.pieces.length} 個、順に）について、その部分が文の途中で止まっている（言葉に詰まった、次の部分で同じ文が続く）なら true、文や節の切れ目（〜です。〜ました。〜て、〜けど、〜から、〜ので、〜たら などのあと）で止まったなら false。最後は false。
reaction：聞き手（${a.listener}）が、話を聞き終わってすぐ言う一言の日本語。学習者がはっきり言った内容に具体的に触れる驚きや感想。15〜30字。質問で終わらない。
good：学習者がうまく言えた日本語の表現を一つ、文字起こしからそのまま（一字も変えずに）抜き出す。自然な口語の言い回し、正しく使えた接続や文型、学習者には難しめの語を優先。間違いを含むもの、「えっと」、単語一つだけのもの、テーマや要点の語をそのまま言っただけのものは選ばない。${a.avoid?.length ? `次はもう褒めたので選ばない：${a.avoid.join("、")}。` : ""}ふさわしいものがなければ空文字。`,
    a.pieces.map((t, i) => `【${i + 1}】${t}`).join("\n"),
    1000,
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

// careful: Opus instead of Haiku, the third opinion when the other two don't agree on a word.
export async function kanaReading(text: string, careful = false): Promise<string | null> {
  const { kana } = await haikuFirst(ReadingSchema, "日本語の読み方をひらがなだけで答える。記号や数字も読みに直す。", text, careful ? 2000 : 300, careful ? "low" : undefined);
  return /^[぀-ヿ\s、。！？・ー]+$/.test(kana.trim()) ? kana.trim() : null;
}

// ---- ラジオ: a Japanese title for episodes made before titles were written in both languages ----

const TitleSchema = z.object({ ja: z.string().describe("日本語のタイトル（20字以内）。直訳ではなく自然な見出し。問いかけの形はそのまま") });

export async function radioTitleJa(zh: string, opening: string): Promise<string> {
  const { ja } = await haikuFirst(
    TitleSchema,
    "日本語学習者向けラジオ番組の中国語タイトルを、同じ内容の自然な日本語タイトルにする。",
    `中国語タイトル：${zh}\n番組の冒頭：${opening}`,
    300,
  );
  return ja.trim();
}

// やさしく: the hard lines of an episode saved before the script came with easy versions, said again
// in N4-N3 Japanese. One answer per line, "" for the lines that are fine as they are.
const EasySchema = z.object({
  lines: z
    .array(z.object({ n: z.number().describe("セリフの番号"), easy: z.string().describe("そのセリフのやさしい言い直し") }))
    .describe("言い直したセリフだけ（難しくないセリフは入れない）"),
});

export async function radioEasy(lines: string[]): Promise<string[]> {
  const ask = () =>
    haikuFirst(
      EasySchema,
      `日本語学習者（JLPT N4〜N3）が聞くラジオのセリフのうち、難しいものだけを、やさしい日本語に言い直す。
- 難しい＝N2以上の語や文法、硬い漢語（均一、開発、復活など）、長くて複雑な文。N3の学習者がすぐ分かるセリフは入れない。
- 言い直すのは全体の2割ほど、多くても8行。
- 意味は同じ（少なくともほぼ同じ）にして、N4〜N3の語と文法だけを使う。話し言葉のまま、話し手の口調（タメ口／です・ます）も同じにする。
- 長さは元と同じくらい。説明を足しすぎない。
- n はセリフの番号（入力の行頭の数字）。`,
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
const EasyOneSchema = z.object({ easy: z.string().describe("やさしい言い直し。すでに十分やさしければ元のまま") });

export async function radioEasyOne(line: string, before: string): Promise<string> {
  const { easy } = await haikuFirst(
    EasyOneSchema,
    `日本語学習者（JLPT N4〜N3）がラジオで聞いたセリフを、同じ意味のやさしい日本語に言い直す。
- N4〜N3の語と文法だけを使う。難しい漢語は和語や説明的な言い方に（均一に→全部同じように）。
- 意味は同じ（少なくともほぼ同じ）にする。話し言葉のまま、話し手の口調も同じにする。
- 長さは元と同じくらい。説明を足しすぎない。
- すでに十分やさしいセリフなら、元のまま返す。`,
    `${before ? `前のセリフ：${before}\n` : ""}セリフ：${line}`,
    1500,
    "low",
  );
  return easy.trim();
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
    "medium",
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

// ---- 先生: each night, one look at everything the learner said, to set tomorrow's priorities ----

const TeacherSchema = z.object({
  order: z
    .array(z.string())
    .describe("明日から練習する弱点の tag を、優先する順に最大5個。下の一覧の tag を一字も変えずに書く"),
  hide: z
    .array(z.string())
    .describe("一覧から外す tag：同じ文法・表現の重複（残す方だけ order に入れる）、例が学習者の誤りではないもの（音声認識の誤り、関係のない文から付いたもの）。なければ空配列"),
  why_zh: z.string().describe("order の一番目を選んだ理由（中国語、1〜2文）。実際の発言に触れて具体的に"),
  note_zh: z
    .string()
    .describe("最近の様子（中国語、3文以内）：実際に伸びた点を具体的に一つ、次に気をつけることを一つ。数字の読み上げやお世辞は書かない"),
  letter_ja: z
    .string()
    .describe("学習者への短い手紙（日本語、3文以内、N3で分かる言葉）。note_zh と同じ内容を、森先生として優しく話しかける口調で（「〜ですね」「一緒に〜しましょう」）。宛名や署名は書かない"),
  good: z
    .object({
      before: z.string().describe("前の言い方（学習者の実際の発言をそのまま。三回話すの1回目や、前に間違えた文）"),
      after: z.string().describe("良くなった言い方（学習者の実際の発言をそのまま、短く切り出してよい）"),
      mark: z.string().describe("after の中で特に良くなった部分。after の一部を一字も変えずに"),
      zh: z.string().describe("何が良くなったか（中国語、1文、20字以内）"),
    })
    .nullable()
    .describe("実際に伸びた点を一つ、画面に大きく出す。前の発言と比べられるものがなければ null"),
  fix: z
    .object({
      tag: z.string().describe("order の一番目の tag をそのまま"),
      said: z.string().describe("学習者が実際に言った短い間違い（記録の「言った」から、その部分だけ）"),
      better: z.string().describe("正しい言い方（said と同じ長さの短い日本語）"),
      mark: z.string().describe("better の中で直した部分。better の一部を一字も変えずに（例：に）"),
      zh: z.string().describe("なぜそう言うか（中国語、1文、20字以内）"),
    })
    .nullable()
    .describe("明日まず直すことを一つ、画面に大きく出す。order が空なら null"),
  news: z
    .string()
    .describe("「明日のニュース」から、明日三回話すのに一番いい記事の id を一つ、一字も変えずに（今の弱点を使う練習になるもの・仕事や生活の話に近いもの）。一覧がなければ空文字"),
});
export type TeacherPlan = z.infer<typeof TeacherSchema>;

export async function teacherPlan(record: string): Promise<TeacherPlan> {
  const res = await parse({
    model: SMART,
    max_tokens: 20000,
    system: `あなたはこの学習者の担任の日本語の先生、森先生です（60代の、穏やかで優しい女性の先生）。学習者は日本に住んでIT企業で働いている中国人で、日本語は N4〜N3。仕事と生活で話せるようになりたい。
毎晩、その日までの記録を全部読んで、明日の練習の優先順位を決めます。アプリは order の順に弱点を練習・電話・ラジオのお便りに出します。
- 記録の弱点は、発言ごとに別の AI が付けたもので、同じ文法が違う名前で何度も付いていたり、音声認識の誤りを学習者の誤りとして付けていたりする。そういうものは hide に入れる。
- 優先するのは、仕事や生活で困る誤り ＞ 何度も出ている誤り ＞ 最近の誤り。直ってきたものは後ろに。
- 「正しくは」も別の AI の推測で、学習者が言おうとした語を取り違えていることがある（例：「ちかいます」は文脈によって「近いです」ではなく「違います」）。前後の文脈から本当に言いたかったことを考え、推測が外れている tag は hide に入れ、note_zh でも取り上げない。
- 学習者の発言は音声認識の結果。同音の漢字違いや句読点は誤りではない。
- good と fix は画面に大きく出る。どちらも学習者が実際に言った文から短く切り出し、一目で分かるようにする。「え」「えー」「あの」などのフィラーは除く（言葉はそのまま）。
- 「これまでのメモ」がある時は続きとして書く：前に直そうと言った点が最近正しく言えていれば good で取り上げ、同じ fix を何日も続けない（まだ直っていなければ、別の例文で出してよい）。`,
    messages: [{ role: "user", content: record }],
    output_config: { effort: "high", format: zodOutputFormat(TeacherSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error(`AI 返回格式不对（${res.stop_reason}）`);
  return res.parsed_output;
}

// NHKやさしいことばニュース: each article's Chinese, its words and the skeleton for 三回話す, once when it is
// fetched (lib/news.ts). The text comes with NHK's readings in （）; the words keep those readings.
const NewsNotesSchema = z.object({
  title_zh: z.string().describe("見出しの中国語訳（簡体字、短く）"),
  zh: z.array(z.object({ n: z.number(), zh: z.string().describe("その文の自然な中国語訳（簡体字）。訳だけ") })).describe("全部の文の訳。n は入力の文番号"),
  words: z
    .array(z.object({ ja: z.string().describe("本文に出てくる形の語・表現（読みの（）は付けない）"), kana: z.string().describe("読み（ひらがな）。本文の（）の読みに合わせる"), zh: z.string().describe("中国語の意味（短く）") }))
    .describe("覚えておくと仕事や生活で使える語・表現を3〜5個。N3〜N2 レベルで、この記事の内容を話すのに必要なもの。ja は辞書形（広がっています→広がる、捕まえた→捕まえる）。N4 までの基本語（情報、参加する、天気など）と人名・地名・国名は入れない"),
  keys: z
    .array(z.object({ ja: z.string().describe("本文の語（辞書形の名詞か動詞。読みの（）は付けない）"), kana: z.string().describe("読み（ひらがな）"), zh: z.string().describe("中国語の意味（短く）") }))
    .describe("この記事を自分の言葉で話すときの骨組みになる語を3個、話の順番に。見れば話の流れを思い出せるもの。辞書形（盗んだり→盗む）。人名・地名・国名・カタカナの固有名詞は入れない"),
  summary: z.array(z.string()).describe("記事の内容を、友だちに話すような自然な日本語の3文で（N4〜N3 の語と文法、です・ます）"),
});
export type NewsNotes = z.infer<typeof NewsNotesSchema>;

export function newsNotes(title: string, sentences: string[]): Promise<NewsNotes> {
  return haikuFirst(
    NewsNotesSchema,
    `学習者は日本に住んでIT企業で働いている中国人（日本語 N4〜N3）。毎朝 NHK のやさしい日本語のニュースを聞き、夜にその内容を自分の言葉で3回話す練習をする。そのための訳と語のメモを作る。
本文の（）は NHK が付けた読み。読みはそれに従う。`,
    `見出し：${title}\n\n${sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    6000,
    "low",
  );
}

// 一文ずつ三回話す: one NHK sentence said back from memory. Judged by meaning, from what the learner managed to
// say: where they got stuck, and their own sentence made right (their words, their level) rather than NHK's.
// parts: the NHK sentence cut in order, each part said or not, for the original shown small underneath.
const SayCheckSchema = z.object({
  verdict: z.enum(["good", "close", "off"]).describe("good：元の文と同じ内容が伝わる（言い方が違ってもよい）。close：大筋は伝わるが、一部が抜けた・間違えた。off：大事な内容が伝わらない"),
  mine: z
    .array(z.object({ t: z.string().describe("学習者の発話の一部分（そのまま抜き出す）"), ok: z.boolean().describe("文法・語の使い方が正しく自然なら true。間違い・不自然なら false") }))
    .describe("学習者の発話を、頭から順に文節程度に切ったもの。全部つなげると学習者の発話と一字一句同じになること"),
  stuck_zh: z.string().describe("どこで詰まったか・何が言えなかったかを中国語で一言（25字以内）。例：「“…かどうか测试”这部分没说出来」。問題なければ空文字"),
  better: z.string().describe("学習者の言い方を土台に、できるだけ学習者の語と文の形を残して、元の文と同じ意味になるよう最小限直した日本語。元の文に戻さない。N4〜N3 で言える形。学習者の発話がそのまま正しく十分なら、学習者の発話をそのまま"),
  better_zh: z.string().describe("better で何を直した・足したかを中国語で一言（25字以内）。直していなければ空文字"),
  parts: z
    .array(z.object({ t: z.string().describe("元の文の一部分（そのまま抜き出す）"), ok: z.boolean().describe("その内容を学習者が（言い方は違っても）言えたら true") }))
    .describe("元の文を、頭から順に意味のまとまり（文節程度）に切ったもの。全部つなげると元の文と一字一句同じになること"),
});
export type SayCheck = z.infer<typeof SayCheckSchema>;

export async function sayCheck(a: { ja: string; said: string }): Promise<SayCheck> {
  const res = await parse({
    ...smart(2500),
    system: `${COACH}
学習者はニュースの一文を聞いて、覚えて、自分の口で言い直す練習をしています。一字一句同じに言う必要はありません。目的は、学習者が今言えるところから少しずつ言えるようにすること。
学習者が言ったこと（音声認識の結果）を元の文と比べて、意味が伝わったか、どこで詰まったかを見て、学習者の言い方を活かした直し方を示してください。
音声認識の結果なので、同音の漢字違い・ひらがなと漢字の違い・句読点・数字の書き方は間違いとして扱わない。`,
    messages: [{ role: "user", content: `元の文：${a.ja}\n学習者が言ったこと：${a.said}` }],
    output_config: { effort: "low", format: zodOutputFormat(SayCheckSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error(`AI 返回格式不对（${res.stop_reason}）`);
  return res.parsed_output;
}

// 全文モード: the whole NHK article said from its Chinese, once every sentence was passed one by one. Scored by
// meaning, not word for word; each sentence that wasn't right gets the learner's own words made right, and a
// few expressions worth using next time.
const FullCheckSchema = z.object({
  score: z.number().describe("0〜100 の整数。記事の内容がどれだけ正しく伝わったか（意味で判断。言い方の違いでは減らさない。抜けた文・意味の違う文・文法の大きな誤りで減らす）"),
  good_zh: z.string().describe("具体的にうまく言えた点を中国語で一言（25字以内）。例：「“〜によると”开头用得很自然」"),
  items: z
    .array(
      z.object({
        n: z.number().describe("文番号（入力の番号）"),
        verdict: z.enum(["good", "close", "off"]).describe("good：その文の内容が伝わった。close：大筋は伝わったが一部抜け・誤り。off：言っていない・違う内容"),
        said: z.string().describe("学習者の発話のうち、この文にあたる部分（そのまま抜き出す）。言っていなければ空文字"),
        better: z.string().describe("good 以外のとき：学習者の言い方を土台に、できるだけその語と形を残して、この文と同じ意味になるよう最小限直した日本語（言っていなければ、N4〜N3 で言える短い言い方）。good なら空文字"),
        fix_zh: z.string().describe("good 以外のとき：何を直した・足したかを中国語で一言（20字以内）。good なら空文字"),
      }),
    )
    .describe("全部の文について、番号順に"),
  tips: z
    .array(z.object({ ja: z.string().describe("次に使うとよい日本語の表現（短く。記事の語や自然な言い回し）"), zh: z.string().describe("中国語の意味と使いどころ（20字以内）") }))
    .describe("学習者がまだ使えていない、覚えると役に立つ表現を2〜3個"),
});
export type FullCheck = z.infer<typeof FullCheckSchema>;

export async function fullCheck(a: { title: string; sentences: { ja: string; zh: string }[]; said: string }): Promise<FullCheck> {
  const res = await parse({
    ...smart(5000),
    system: `${COACH}
学習者は、一文ずつの練習を終えたニュース記事を、中国語訳だけを見て、日本語で通して話しました。一字一句同じである必要はありません。意味が伝われば正解です。
学習者が今言えたところを土台に、次に少し上手に言えるようにするのが目的です。直すときは学習者の言い方を活かし、元の文に置き換えない。
学習者の発話は音声認識の結果です。同音の漢字違い・ひらがなと漢字の違い・句読点・数字の書き方は間違いとして扱わない。`,
    messages: [
      {
        role: "user",
        content: `記事：${a.title}\n${a.sentences.map((s, i) => `${i + 1}. ${s.ja}（${s.zh}）`).join("\n")}\n\n学習者が話したこと：${a.said}`,
      },
    ],
    output_config: { effort: "low", format: zodOutputFormat(FullCheckSchema) },
  });
  checkStop(res.stop_reason);
  if (!res.parsed_output) throw new Error(`AI 返回格式不对（${res.stop_reason}）`);
  return res.parsed_output;
}

// 森先生's help from what Azure wrote down (lib/help-prompt.ts); raced against Gemini listening itself.
const HelpSchema = z.object({ said: z.string(), say: z.string(), added: z.string(), next: z.string(), zh: z.string() });
export async function retellHelp(said: string, c: HelpCtx) {
  const res = await parse({
    model: MODEL,
    max_tokens: 1000,
    // Haiku 5.5 thinks by default (600 tokens ran out before the answer, ~6 s); she has to answer within a
    // couple of seconds, and the line is short.
    thinking: { type: "disabled" },
    system: helpRules(c, "text"),
    messages: [{ role: "user", content: said || "（まだ何も話していない）" }],
    output_config: { format: zodOutputFormat(HelpSchema) },
  });
  if (!res.parsed_output) throw new Error(`help: ${res.stop_reason}`);
  return res.parsed_output as z.infer<typeof HelpSchema>;
}

// The same help written as plain lines and streamed: each field as soon as its line is complete, so her
// first line (SAY, written first) is voiced while the rest is still being written (~1 s sooner).
export async function* retellHelpLines(said: string, c: HelpCtx): AsyncGenerator<{ key: string; value: string }> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1000,
    thinking: { type: "disabled" },
    system: helpRules(c, "lines"),
    messages: [{ role: "user", content: said || "（まだ何も話していない）" }],
  });
  let buf = "";
  const line = (l: string) => {
    const m = /^\s*(SAY|ADDED|NEXT|ZH)\s*[:：]\s*(.*)$/.exec(l);
    return m ? { key: m[1].toLowerCase(), value: m[2].trim() } : null;
  };
  for await (const ev of stream) {
    if (ev.type !== "content_block_delta" || ev.delta.type !== "text_delta") continue;
    buf += ev.delta.text;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const got = line(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (got) yield got;
    }
  }
  const got = line(buf);
  if (got) yield got;
}
