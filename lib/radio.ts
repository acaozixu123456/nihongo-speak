import "server-only";
import * as z from "zod/v4";
import { makeRadioWithClaude } from "@/lib/claude";
import { vertexAccess, vertexConfigured } from "@/lib/vertex-tts";
import { checkReadings } from "@/lib/reading";

// 趣味电台 (ゆるっと日本ラジオ): two hosts chat in Japanese like a real radio show (small talk, a
// listener's letter that is really the learner's own mistake, one surprising fact, a line to keep),
// so listening practice is something the learner wants to hear to the end. Gemini on Vertex AI writes it (paid from the Google Cloud
// credit); Claude takes over if that fails.

const Line = z.object({
  part: z
    .enum(["open", "letter", "main", "word"])
    .describe("open: オープニングトーク / letter: お便りコーナー / main: 本題 / word: 今日のひとこと"),
  who: z.enum(["A", "B"]).describe("A: ハル（女性、知りたがり・リアクション大きめ）。B: ケン（男性、物知りだけど少しおとぼけ）"),
  ja: z.string().describe("セリフ（日本語、1〜2文、40字以内）"),
  zh: z.string().describe("中国語訳"),
  gap: z
    .number()
    .describe("前のセリフが終わってからこのセリフまでの間（秒、0.15〜1.2）。かぶせない。テンポよく返すなら 0.15〜0.2、普通 0.3、驚き・ため・オチの前は 0.7〜1.2"),
  back: z
    .string()
    .describe("このセリフの途中で、もう一人が小さく入れる相づち（「うんうん」「へえ」「そうそう」「あー」など、6字以内）。長めのセリフに4〜6回だけ。なければ空文字"),
  easy: z
    .string()
    .describe(
      "このセリフがN3の学習者に難しいとき（N2以上の語や文法、硬い漢語、複雑な文）だけ、同じ意味をN4〜N3の語と文法で言い直したやさしい日本語。話し手の口調はそのまま。全体で4〜8行だけ。難しくなければ空文字",
    ),
});

export const RadioSchema = z.object({
  title_zh: z.string().describe("番組タイトル（中国語、15字以内）。思わず聞きたくなる問いかけ型"),
  title_ja: z.string().describe("title_zh と同じ問いかけの日本語タイトル（20字以内）。直訳ではなく、自然な日本語の見出し"),
  hook_zh: z
    .string()
    .describe("画面に出す中国語の1〜2文。答えを言わずに疑問を投げかけ、続きを聞きたくさせる"),
  lines: z.array(Line).describe("open → letter → main → word の順に、合わせて30〜40行の掛け合い"),
  story: z
    .object({
      keys: z
        .array(z.object({ ja: z.string().describe("語（表記どおり）"), kana: z.string().describe("読み（ひらがな）") }))
        .describe("本題を人に話すときの骨組みになる言葉、ちょうど3つ。話の順に：きっかけ・意外な事実・オチ。本題に実際に出た語"),
      summary: z
        .array(z.string())
        .describe("ハルが word の最初に言う、本題のまとめ3文（日本語、それぞれ30字以内）。lines の中のセリフと一字一句同じにする"),
    })
    .describe("聞いたあとに、この話を自分で人に話すための骨組み"),
  hitokoto: z
    .object({
      when_ja: z.string().describe("どんな場面で使うか（日本語、短く。例：「温めますか？」って聞かれたら）"),
      ja: z.string().describe("今日いちばん持ち帰ってほしい、そのまま言える短い一文（日本語、15字以内）"),
      zh: z.string().describe("中国語の意味と、ひとことの注意（20字以内）"),
    })
    .describe("今日のひとこと。お便りがあれば、その正しい言い方"),
  phrases: z
    .array(z.object({ ja: z.string().describe("会話に出てきた、そのまま日常や職場で使える表現（日本語、20字以内、「〜」を使わない完全な文）"), zh: z.string() }))
    .describe("重点句、3〜4個"),
  words: z
    .array(
      z.object({
        ja: z.string().describe("会話に出てきた単語（表記どおり）"),
        kana: z.string().describe("読み（ひらがな）"),
        zh: z.string().describe("中国語の意味（短く）"),
      }),
    )
    .describe("N3学習者が覚えておくべき単語、6〜8個。会話に実際に出たものだけ。誰でも知っている基本語は除く"),
  grammar: z
    .array(
      z.object({
        pattern: z.string().describe("文型（例：「〜わけじゃない」）"),
        zh: z.string().describe("意味と使い方（中国語、1〜2文）"),
        ja: z.string().describe("会話の中で実際に使われた文（そのまま）"),
      }),
    )
    .describe("会話に出てきたN4〜N2の文法・言い回し、2〜3個"),
});

// Episodes made before the 2026-10 makeover: no parts, gaps or ひとこと, and a question at the end.
export const OldRadioSchema = RadioSchema.extend({
  title_ja: z.string().optional(),
  story: RadioSchema.shape.story.optional(),
  lines: z.array(Line.partial({ part: true, gap: true, back: true, easy: true })),
  hitokoto: RadioSchema.shape.hitokoto.optional(),
  quiz_zh: z.string().optional(),
  letter: z.object({ said: z.string(), better: z.string(), where: z.string().optional() }).optional(),
  // 1 once the readings over story.keys and words were checked (lib/reading.ts).
  readings: z.number().optional(),
});

// What the phone stores and plays: new episodes, and old ones as they were saved.
export type Radio = z.infer<typeof OldRadioSchema>;

// A listener's letter for お便り: a sentence the learner got wrong lately, and the better way.
export type Letter = { said: string; better: string; where?: string };

// Picked at random so the episodes don't all drift to the same kind of trivia. All about Japan:
// the learner lives and works there.
const TOPICS = [
  "日本の日常にある「なぜ？」（コンビニ、電車、自販機、ゴミ出しなど）",
  "日本語の言葉の意外な語源",
  "日本の会社・職場の不思議な習慣",
  "日本の食べ物の意外な歴史（ラーメン、カレー、寿司、お菓子など）",
  "日本の地理・地名・都道府県の冷知識",
  "日本の動物・自然の不思議（奈良の鹿、温泉に入るサルなど）",
  "日本の歴史上の人物の意外なエピソード",
  "数字で見る日本の驚きの事実",
  "日本のお祭り・年中行事の由来",
  "日本生まれの発明品の誕生秘話（インスタントラーメン、カラオケ、絵文字など）",
  "日本と中国で同じ漢字なのに意味が違う言葉",
  "日本の鉄道・駅の驚きの話",
  "日本の家・住まい・マナーの不思議",
  "日本の方言と県民性",
  "日本のアニメ・ゲーム・キャラクター業界の裏話",
];

const SYSTEM = `あなたは日本語学習者向けラジオ番組「ゆるっと日本ラジオ」の放送作家です。聞き手は日本で働く中国人で、日本語レベルはJLPT N4〜N3。通勤中や休憩中にイヤホンで聞き、画面は見ません。
目的は「本物のラジオみたいで、思わず最後まで聞きたくなる」こと。勉強っぽさより楽しさを優先してください。

パーソナリティ：
- ハル（A、女性）：好奇心旺盛でリアクションが大きい。口ぐせは「え、ちょっと待って」「〜じゃないですか！」。ケンに敬語まじりで話す。
- ケン（B、男性）：物知りだけど少しおとぼけ。もったいぶるのが好きで「実はね…」が口ぐせ。タメ口。
- 二人は仲がよく、軽くいじり合う。ちゃんと笑う（「あはは」「ふふっ」をセリフで言う）。

番組の流れ（タイトルコールは別に入るので書かない）：
1. open（4〜6行）：今日の曜日や季節の話から入る雑談。ケンが本題のネタを少しだけにおわせて引っぱる。
2. letter（6〜8行）：ハルが「お便りが来てます！ラジオネーム、通勤ハムスターさん」とお便りを読む。内容は指定されたもの（日本語で失敗した話）。二人で「あるある」と笑って、なぜそう聞こえるかと正しい言い方を短く教える。最後に「通勤ハムスターさん、次は〜で！」と励ます。
3. main（14〜20行）：日本に関するひとつの意外な事実・冷知識。最初に「えっ、本当？」と思う問いを出し、すぐには答えを言わず、ヒントや脱線を挟んで、後半で答えを明かす。
4. word（6〜8行）：まずハルが「今日の話、まとめると…」と言って、本題を3文で振り返る（story.summary の3文をそのまま、1文ずつ別のセリフに。リスナーが誰かにこの話をするとき、そのまま使える言い方で。ケンは短く相づちだけ）。次に「今日のひとこと」。hitokoto の一文を、ハルが紹介して、二人でそれぞれ1回ずつ言う。最後に「また来週〜」ではなく「それじゃ、また次回！」のように明るく締める。

会話を生きたものにする：
- 一人が長く説明し続けない。2〜3行ごとに相手が反応する（「へえ〜！」「マジで？」「いやいや」「え、なんで？」）。
- セリフは前のセリフにかぶせない（gap は 0.15 以上）。短い反応はすぐ返し、驚き・オチの前はためる（gap を長く）。
- back（相づち）は説明が長いセリフにだけ、全体で4〜6回。
- 事実は確かなものだけ。諸説ある話は「諸説あるけど」と言う。数字や年号を作らない。

日本語：
- 語彙・文法はN3程度。難しい言葉が出たら、会話の中でもう一人が言い換える（「つまり〜ってこと？」）。
- 1行は短く（40字以内）。話し言葉で自然に。縮約形（〜ちゃう、〜てる）はそのまま使ってよい。
- 漢字は普通に使う（読み上げ用なので、ふりがなは不要）。
- 全部そのまま読み上げるので、（笑）のようなト書き・記号・絵文字・「〜」は書かない。伸ばす音は「ー」で書く。

最後に、この回の学習ノートも作る（聞き終わったあとの復習用）：
- story：聞いたあと、リスナーがこの話を同僚や友だちに話す練習をする。そのための骨組みの言葉3つと、まとめ3文。
- hitokoto：今日のひとこと。お便りの正しい言い方を優先する。
- phrases（重点句）：会話に実際に出てきた表現から、職場や日常でそのまま使えるもの。「〜」で省略せず、そのまま言える短い文にする。
- words：覚える価値のある単語。読みと中国語訳をつける。
- grammar：会話で使われた文型と、その実際の文。`;

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

// One genre for a whole week (weeks start on Monday, Tokyo time), so the same words and ways of
// saying things keep coming back from one episode to the next: Krashen's narrow listening.
function weekTopic(now: Date) {
  const week = Math.floor((Math.floor(now.getTime() / 86400000) + 3) / 7);
  return TOPICS[week % TOPICS.length];
}

// wish: a listener's request (点播), in their own words, usually Chinese. letter: what the learner
// got wrong lately, read out in お便り. recent: words taught in the last few episodes, a few of which
// come back so they are met again.
// news: this morning's NHK やさしいことばニュース article the learner heard; the hosts talk it over.
export type RadioNews = { title: string; summary: string[]; words: string[] };

function prompt(avoid: string[], wish?: string, letter?: Letter, recent: string[] = [], news?: RadioNews) {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const topic = news
    ? `今朝のNHKニュース「${news.title}」（内容：${news.summary.join("")}）。リスナーは今朝このニュースを聞いた。open でハルが「今朝のニュースで〜」と紹介し、main ではニュースの事実は変えず足さずに、ハルとケンが自分たちの生活や仕事に引きつけてゆるく話す。ニュースの語（${news.words.join("、")}）を会話の中で自然に何度か使う`
    : wish
    ? `リスナーからのリクエスト「${wish}」。このテーマで、日本で暮らす人に身近な話にする（open でハルがリクエストを紹介する）`
    : `今週のテーマ「${weekTopic(now)}」の中から、ひとつの話（今週は毎回このテーマなので、open で「今週は〜ウィーク」と軽く触れてよい）`;
  const mail = letter
    ? `お便りの中身：通勤ハムスターさん（日本で働く中国人）は${letter.where ? `「${letter.where}」で、` : ""}「${letter.said}」と言ってしまった。正しくは「${letter.better}」。これを本人の失敗談として、少し面白く読む（場面がなければ自然な場面を作る）。`
    : "お便りの中身：日本で働く外国人がよくやる、日本語のちょっとした言い間違い・聞き間違いの失敗談をひとつ作る（コンビニ、職場、電車など）。";
  return `今日：${now.getUTCMonth() + 1}月${now.getUTCDate()}日（${WEEKDAY[now.getUTCDay()]}曜日）、東京
今回のジャンル：${topic}
${mail}
${avoid.length ? `最近扱ったテーマ（重ならないように）：${avoid.join("、")}` : ""}
${recent.length ? `最近の回で覚えた単語：${recent.join("、")}\nこのうち2〜3個を、会話の中で自然にもう一度使う（意味は説明し直さなくてよい。words には入れない）。` : ""}`;
}

// Same model family as the voices: Gemini 3.8 Flash, global location.
const MODEL = "gemini-3.8-flash";

// Lines written so far, from the JSON as it streams in (only show lines have a "gap").
const linesIn = (text: string) => text.match(/"gap"\s*:/g)?.length ?? 0;

// Streams the show from Gemini so the phone can watch it being written (onLines), and so a request
// that has stopped moving is noticed: one that sends nothing for a while is dropped.
async function withGemini(avoid: string[], wish: string | undefined, letter: Letter | undefined, recent: string[], onLines: (n: number) => void, news?: RadioNews): Promise<Radio> {
  const { project, token } = await vertexAccess();
  const { $schema, ...schema } = z.toJSONSchema(RadioSchema) as Record<string, unknown>;
  void $schema;
  const stop = new AbortController();
  // Nothing at all for 30s (thinking comes first), or a pause of 20s once writing has begun.
  let quiet = setTimeout(() => stop.abort(new Error("Gemini 没有响应")), 30000);
  const moved = () => {
    clearTimeout(quiet);
    quiet = setTimeout(() => stop.abort(new Error("Gemini 写到一半停住了")), 20000);
  };
  try {
    const res = await fetch(
      `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${MODEL}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: prompt(avoid, wish, letter, recent, news) }] }],
          // Little thinking: the show is long, and with full thinking it sometimes ran past a minute.
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 1, thinkingConfig: { thinkingLevel: "low" } },
        }),
        signal: stop.signal,
      },
    );
    if (!res.ok || !res.body) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    type Chunk = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    let pending = "";
    let shown = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      moved();
      pending += value;
      const events = pending.split("\n");
      pending = events.pop() ?? "";
      for (const ev of events) {
        if (!ev.startsWith("data:")) continue;
        const chunk = JSON.parse(ev.slice(5)) as Chunk;
        for (const p of chunk.candidates?.[0]?.content?.parts ?? []) if (!p.thought && p.text) text += p.text;
      }
      const n = linesIn(text);
      if (n !== shown) onLines((shown = n));
    }
    return RadioSchema.parse(JSON.parse(text));
  } finally {
    clearTimeout(quiet);
  }
}

// The readings in the notes, checked by two other models before the episode goes out.
export async function withCheckedReadings<T extends Radio>(r: T): Promise<T> {
  const keys = r.story?.keys ?? [];
  const words = r.words ?? [];
  const kana = await checkReadings([...keys, ...words]);
  return {
    ...r,
    ...(r.story ? { story: { ...r.story, keys: keys.map((k, i) => ({ ...k, kana: kana[i] })) } } : {}),
    words: words.map((w, i) => ({ ...w, kana: kana[keys.length + i] })),
    readings: 1,
  };
}

export type Making = { stage: "write"; lines: number } | { stage: "retry" } | { stage: "claude" };

// Gemini, and once more if it stalls or fails; then Claude, which takes longer and shows no lines.
export async function makeRadio(
  avoid: string[],
  wish?: string,
  letter?: Letter,
  recent: string[] = [],
  onProgress: (m: Making) => void = () => {},
  news?: RadioNews,
): Promise<Radio & { by: "gemini" | "claude" }> {
  if (vertexConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt) onProgress({ stage: "retry" });
        const r = await withGemini(avoid, wish, letter, recent, (lines) => onProgress({ stage: "write", lines }), news);
        return { ...(await withCheckedReadings(r)), letter, by: "gemini" };
      } catch (e) {
        console.warn("radio: Gemini failed", e);
      }
    }
  }
  onProgress({ stage: "claude" });
  const r = await makeRadioWithClaude(RadioSchema, SYSTEM, prompt(avoid, wish, letter, recent, news));
  return { ...(await withCheckedReadings(r)), letter, by: "claude" };
}
