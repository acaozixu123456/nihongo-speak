import "server-only";
import * as z from "zod/v4";
import { COACH, makeRadioWithClaude } from "@/lib/claude";
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
            "meaning: 日本語を見て中国語の意味を選ぶ。listen: 音声だけ聞いて中国語の意味を選ぶ。pick: 中国語を見て日本語を選ぶ。fill: 新しい場面の日本語の文の空欄（＿＿）に入るものを選ぶ。order: 中国語を見て日本語のパーツを並べる。say: 中国語を見て日本語を声に出して言う。reading: 単語（漢字）を見て正しい読みを選ぶ（word の項目だけ）。judge: 項目を使った日本語の文が自然か不自然かを判断する（半分くらいは、ありがちな誤用の文にする）。dictate: 音声だけ聞いて、聞こえた文をパーツで並べる",
          ),
        about: z.string().describe("この問題で練習する項目。与えられた項目の ja をそのまま一字一句コピーする"),
        ja: z.string().describe("meaning/listen/reading/judge/dictate: 出題する日本語（reading は単語そのもの、dictate は読み上げる文で answer と同じ）。fill: ＿＿ を1つ含む、新しい日常・職場の場面の文。それ以外は空文字"),
        zh: z.string().describe("pick/order/say: 出題する中国語。fill/judge/dictate: 文の中国語訳（judge で不自然な文なら、言いたかった意味）。meaning/listen/reading: 空文字"),
        answer: z.string().describe("正解。meaning/listen は中国語、pick/fill は日本語、order/say/dictate は完成した日本語の文、reading はひらがな、judge は「自然」か「不自然」"),
        options: z
          .array(z.string())
          .describe("meaning/listen/pick/fill: もっともらしいが間違いの選択肢3個（正解と同じ言語・同じくらいの長さ）。reading: 長音・促音・濁点などを変えた紛らわしい読み3個。judge: 不自然な文なら [正しい言い方の日本語文] を1個、自然な文なら空。order/dictate: 紛らわしい余分なパーツ1〜2個。say: 空"),
        tiles: z.array(z.string()).describe("order/dictate のみ：answer を順番どおり3〜6個のパーツに分けたもの（つなげると answer と完全に一致）。それ以外は空"),
        explain_zh: z.string().describe("答えたあとに見せる一言解説（中国語、1文、なぜそうなるか・使い方のコツ）"),
      }),
    )
    .describe("各項目ちょうど2問"),
});

export type Game = z.infer<typeof GameSchema>;

export type GameItem = { ja: string; zh: string; kind: string; note?: string; level: number };

const SYSTEM = `${COACH}
学習者がポッドキャストで出会った単語・重点句・文法・質問した部分を、ゲーム形式で練習して、意味を本当に理解し、自分で使えるようにします。項目ごとのレベル（0〜5）で問題形式を選ぶ：
- レベル0〜1（初めて・まだ不安定）：meaning・listen・reading（単語）で意味と読みを確認し、もう1問は pick。
- レベル2〜3：fill・order・judge・dictate のどれかで、新しい場面の中で使わせる。
- レベル4〜5：say（自分で言う）と dictate か listen。
全体で、できるだけ多くの種類の形式を混ぜる。order・dictate・say の answer は1文だけ（15〜30字）。
同じ項目の2問は必ず違う形式にする（意味 → 使う、のように角度を変える）。
- kind が weak の項目は、学習者が会話で何度も間違えた文法・表現（注に実際の間違いと正しい言い方）。レベルに関わらず fill・judge・order・say から2つ選び、その文法を自分で正しく使わせる。judge では学習者がしがちな誤用の文を出し、explain_zh でなぜ間違いかを一言で。
- fill・order・say の文は元の文のコピーではなく、学習者の日常や職場（日本在住、IT系）で実際に使う新しい場面の短い文（N3程度）にする。
- 間違いの選択肢は、ありがちな勘違い（似た語、似た文型、助詞違い、似た意味の中国語）にする。明らかに無関係なものは出さない。
- 中国語は簡体字。`;

const prompt = (topic: string | undefined, items: GameItem[]) => `${topic ? `番組のテーマ：${topic}\n` : ""}項目：
${items.map((x) => `- [${x.kind}・レベル${x.level}] ${x.ja}${x.note ? `（${x.note}）` : ""}：${x.zh}`).join("\n")}`;

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
  const fix = (qs: Game["questions"]) =>
    qs.map((q) => ({ ...q, about: items.find((x) => q.about === x.ja || q.about.startsWith(x.ja) || q.about.includes(x.ja))?.ja ?? q.about }));
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
