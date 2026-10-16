import "server-only";
import * as z from "zod/v4";
import { makeRadioWithClaude } from "@/lib/claude";
import { vertexAccess, vertexConfigured } from "@/lib/vertex-tts";

// 趣味电台: two hosts chat in Japanese about one surprising fact, so listening practice is something
// the learner wants to hear to the end. Gemini on Vertex AI writes it (paid from the Google Cloud
// credit); Claude takes over if that fails.

export const RadioSchema = z.object({
  title_zh: z.string().describe("番組タイトル（中国語、15字以内）。思わず聞きたくなる問いかけ型"),
  hook_zh: z
    .string()
    .describe("冒頭で中国語のナレーターが言う1〜2文。答えを言わずに疑問を投げかけ、続きを聞きたくさせる"),
  lines: z
    .array(
      z.object({
        who: z.enum(["A", "B"]).describe("A: ハル（女性、知りたがり・ツッコミ役）。B: ケン（男性、物知り・ボケ役）"),
        ja: z.string().describe("セリフ（日本語、1〜2文、40字以内）"),
        zh: z.string().describe("中国語訳"),
      }),
    )
    .describe("18〜26行の掛け合い"),
  phrases: z
    .array(z.object({ ja: z.string().describe("会話に出てきた、そのまま日常や職場で使える表現（日本語、20字以内、「〜」を使わない完全な文）"), zh: z.string() }))
    .describe("3個"),
  quiz_zh: z.string().describe("最後に中国語のナレーターが出す、今日の話に関する一問（答えは言わない、1文）"),
});

export type Radio = z.infer<typeof RadioSchema>;

// Picked at random so the episodes don't all drift to the same kind of trivia.
const TOPICS = [
  "日本の日常にある「なぜ？」（コンビニ、電車、自販機、ゴミ出しなど）",
  "日本語の言葉の意外な語源",
  "日本の会社・職場の不思議な習慣",
  "食べ物の意外な歴史（ラーメン、カレー、寿司、お菓子など）",
  "日本の地理・地名の冷知識",
  "動物や体の不思議な科学",
  "歴史上の人物の意外なエピソード",
  "数字で見る日本の驚きの事実",
  "日本のお祭り・年中行事の由来",
  "身近な発明品の意外な誕生秘話",
  "日本と中国で同じ漢字なのに意味が違う言葉",
  "世界の変わった法律やルール",
];

const SYSTEM = `あなたは日本語学習者向けポッドキャストの放送作家です。聞き手は日本で働く中国人で、日本語レベルはJLPT N4〜N3。通勤中や仕事中にイヤホンで聞き、画面は見ません。
目的は「思わず最後まで聞きたくなる」こと。勉強っぽさより面白さを優先してください。

構成：
- 2人のパーソナリティ、ハル（A、女性、好奇心旺盛で反応が大きい）とケン（B、男性、物知りだけど少しおとぼけ）の掛け合い。
- テーマはひとつの意外な事実・冷知識。最初に「えっ、本当？」と思う問いを出し、すぐには答えを言わず、ヒントや脱線を挟んで、後半で答えを明かす。
- 「へえ〜！」「マジで？」「いやいや」のような自然なリアクション、軽いボケとツッコミ、ちょっとした笑いを入れる。最後に記憶に残るひとことでまとめる。
- 事実は確かなものだけ。諸説ある話は「諸説あるけど」と言う。数字や年号を作らない。

日本語：
- 語彙・文法はN3程度。難しい言葉が出たら、会話の中でもう一人が言い換える（「つまり〜ってこと？」）。
- 1行は短く（40字以内）。話し言葉で自然に。縮約形（〜ちゃう、〜てる）はそのまま使ってよい。
- 漢字は普通に使う（読み上げ用なので、ふりがなは不要）。
- 全部そのまま読み上げるので、（笑）のようなト書き・記号・絵文字は書かない。笑いはセリフで表す（「あはは」など）。

phrases には会話に実際に出てきた表現から、職場や日常でそのまま使えるものを選ぶ。「〜」で省略せず、そのまま言える短い文にする。`;

function prompt(avoid: string[]) {
  const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  return `今回のジャンル：${topic}
${avoid.length ? `最近扱ったテーマ（重ならないように）：${avoid.join("、")}` : ""}`;
}

// Same model family as the voices: Gemini 3.8 Flash, global location.
const MODEL = "gemini-3.8-flash";

async function withGemini(avoid: string[]): Promise<Radio> {
  const { project, token } = await vertexAccess();
  const { $schema, ...schema } = z.toJSONSchema(RadioSchema) as Record<string, unknown>;
  void $schema;
  const res = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt(avoid) }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 1 },
      }),
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  type Reply = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const reply = (await res.json()) as Reply;
  const text = (reply.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("");
  return RadioSchema.parse(JSON.parse(text));
}

export async function makeRadio(avoid: string[]): Promise<Radio & { by: "gemini" | "claude" }> {
  if (vertexConfigured()) {
    try {
      return { ...(await withGemini(avoid)), by: "gemini" };
    } catch (e) {
      console.warn("radio: Gemini failed, using Claude", e);
    }
  }
  return { ...(await makeRadioWithClaude(RadioSchema, SYSTEM, prompt(avoid))), by: "claude" };
}
