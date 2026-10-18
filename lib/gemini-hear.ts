import { people } from "@/content/calls";
import { vertexAccess } from "@/lib/vertex-tts";

// 三回話す's ears: Gemini on Vertex AI (billed to the Google Cloud credit) writes down a telling word
// for word, mistakes, restarts and えっと included, so the one fix is about what was really said and
// not about what the recogniser misheard. The client cuts the recording at every silence of a second
// or more. Each piece is written down on its own: given the whole story, the model "heard" what fits
// it (a past-tense story turned a spoken 行きます into 行きました every time), alone it writes what was
// said. A second, text-only call then says which silences fell in the middle of a sentence (stuck)
// rather than between sentences (planning the next one, as native speakers do too), and gives the
// listener's reaction to what was actually told.

export type HeardRun = { text: string; kana: string; cut: boolean };
// ms: how long writing down and reading took, to watch the wait after a telling.
export type Heard = { runs: HeardRun[]; reaction: string; ms: [number, number] };

const MODEL = "gemini-3.8-flash";
// Pieces written down at once; a telling has up to a few dozen.
const PARALLEL = 16;
// Writing down what was heard needs no thinking; with the model's default it took ~8s a piece.
// Dropped (and not asked for again) if this model turns the setting away.
let thinking: object | null = { thinkingLevel: "minimal" };

type Reply = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
  }[];
};

async function ask<T>(parts: object[], schema: object, timeoutMs: number): Promise<T> {
  const { project, token } = await vertexAccess();
  const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${MODEL}:generateContent`;
  const send = (t: object | null) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: schema,
          ...(t && { thinkingConfig: t }),
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  let res = await send(thinking);
  if (res.status === 400 && thinking) {
    console.warn(`Gemini hear: thinking setting refused: ${(await res.text()).slice(0, 200)}`);
    thinking = null;
    res = await send(null);
  }
  if (!res.ok) throw new Error(`Gemini hear ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reply = (await res.json()) as Reply;
  const out = (reply.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("");
  return JSON.parse(out) as T;
}

const pieceSchema = {
  type: "OBJECT",
  properties: { text: { type: "STRING" }, kana: { type: "STRING" } },
  required: ["text", "kana"],
};

const PIECE = `日本語学習者の発話の一部分の録音です。学習者の間違いを見つけるための記録なので：
- text：聞こえた音のとおりに一字一句書く。文法や言葉の間違い（時制・活用・助詞など）、言い直し、言いかけ、「えっと」「あの」もそのまま。直したり補ったりしない。聞き取れない音は書かない。何も話していなければ空文字。
- kana：text の読みを、ひらがな・カタカナ・「ー」だけで、ひと続きに書く。`;

// Now and then a request hangs until its timeout (a telling of ten pieces failed outright twice in four
// tries). If one hasn't answered in `after` ms a second starts alongside it and the first answer wins;
// one that fails before the second went out is tried again straight away.
function hedged<T>(go: () => Promise<T>, after: number): Promise<T> {
  return new Promise<T>((ok, fail) => {
    let sent = 0;
    let failed = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      sent++;
      go().then(
        (v) => {
          clearTimeout(timer);
          ok(v);
        },
        (e) => {
          console.warn("hear, one try failed:", e);
          failed++;
          if (sent < 2) {
            clearTimeout(timer);
            start();
          } else if (failed === 2) fail(e);
        },
      );
    };
    start();
    timer = setTimeout(() => sent < 2 && start(), after);
  });
}

function piece(clip: string): Promise<{ text: string; kana: string }> {
  const parts = [{ text: PIECE }, { inlineData: { mimeType: "audio/mp3", data: clip } }];
  return hedged(() => ask(parts, pieceSchema, 25000), 9000);
}

const readSchema = {
  type: "OBJECT",
  properties: {
    cut: { type: "ARRAY", items: { type: "BOOLEAN" } },
    reaction: { type: "STRING" },
  },
  required: ["cut", "reaction"],
};

const styleOf = (id: string) => {
  const p = people.find((x) => x.id === id);
  return p ? `${p.name}。${p.persona.split("話し方：")[1] ?? ""}` : "友達。くだけた話し方";
};

export async function hearRuns(a: { clips: string[]; listener: string; topic: string }): Promise<Heard> {
  const t0 = Date.now();
  const pieces: { text: string; kana: string }[] = new Array(a.clips.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, a.clips.length) }, async () => {
      while (next < a.clips.length) {
        const i = next++;
        pieces[i] = await piece(a.clips[i]);
      }
    }),
  );
  const t1 = Date.now();
  const told = pieces.map((p, i) => `【${i + 1}】${p.text}`).join("\n");
  const read = await hedged(
    () =>
      ask<{ cut: boolean[]; reaction: string }>(
        [
          {
            text: `日本語学習者が話のテーマ「${a.topic}」について人に話しました。1秒以上黙ったところで区切った文字起こしです（間違いもそのまま）：
${told}
cut：各部分（${pieces.length} 個、順に）について、その部分が文の途中で止まっている（言葉に詰まった、次の部分で同じ文が続く）なら true、文や節の切れ目（〜です。〜ました。〜て、〜けど、〜から、〜ので、〜たら などのあと）で止まったなら false。最後は false。
reaction：聞き手（${styleOf(a.listener)}）が、話を聞き終わってすぐ言う一言の日本語。学習者がはっきり言った内容に具体的に触れる驚きや感想。15〜30字。質問で終わらない。`,
          },
        ],
        readSchema,
        25000,
      ),
    9000,
  );
  const runs = pieces.map((p, i) => ({
    text: p.text,
    kana: p.kana,
    cut: i < pieces.length - 1 && !!read.cut?.[i],
  }));
  return { runs, reaction: read.reaction ?? "", ms: [t1 - t0, Date.now() - t1] };
}
