import { people } from "@/content/calls";
import { vertexAccess } from "@/lib/vertex-tts";

// 三回話す's ears: Gemini on Vertex AI (billed to the Google Cloud credit) writes down a telling word
// for word, mistakes, restarts and えっと included, so the one fix is about what was really said and
// not about what the recogniser misheard. The client cuts the recording at every silence of a second
// or more and sends the pieces in order, so the model also says which silences fell in the middle of
// a sentence (stuck) rather than between sentences (planning the next one, as native speakers do too).
// The listener's reaction comes back in the same call, about what was actually told.

export type HeardRun = { text: string; kana: string; cut: boolean };
export type Heard = { runs: HeardRun[]; reaction: string };

const MODEL = "gemini-3.8-flash";

const schema = {
  type: "OBJECT",
  properties: {
    runs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { text: { type: "STRING" }, kana: { type: "STRING" }, cut: { type: "BOOLEAN" } },
        required: ["text", "kana", "cut"],
      },
    },
    reaction: { type: "STRING" },
  },
  required: ["runs", "reaction"],
};

const styleOf = (id: string) => {
  const p = people.find((x) => x.id === id);
  return p ? `${p.name}。${p.persona.split("話し方：")[1] ?? ""}` : "友達。くだけた話し方";
};

export async function hearRuns(a: { clips: string[]; listener: string; topic: string }): Promise<Heard> {
  const { project, token } = await vertexAccess();
  const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${MODEL}:generateContent`;
  const prompt = `日本語学習者（中国語が母語、日本語は中級の手前）が、聞いた話を人に話している録音です。話のテーマ：${a.topic}
録音は、1秒以上黙ったところで切ってあり、【1】から【${a.clips.length}】まで順に続いています。部分の数と同じ ${a.clips.length} 個を runs に入れてください。
各部分について：
- text：聞こえたとおりに一字一句書く。これは学習者の間違いを見つけるための記録なので、文法や言葉の間違い（時制・活用・助詞の誤りなど）、言い直し、言いかけ、「えっと」「あの」も、聞こえた音のまま書く。前後の文脈に合わせて直したり補ったりしてはいけない（例：過去の話でも「行きます」と聞こえたら「行きます」と書く）。聞き取れない音は書かない。何も話していなければ空文字。
- kana：text の読みを、ひらがな・カタカナ・「ー」だけで、ひと続きに書く。
- cut：この部分が文の途中で止まっている（言葉に詰まった、次の部分で同じ文が続く）なら true。文や節の切れ目（〜です。〜ました。〜て、〜けど、〜から、〜ので、〜たら などのあと）で止まったなら false。最後の部分は false。
reaction：聞き手（${styleOf(a.listener)}）が、話を聞き終わってすぐ言う一言の日本語。学習者がはっきり言った内容に具体的に触れる驚きや感想。15〜30字。質問で終わらない。`;
  const parts: object[] = [{ text: prompt }];
  a.clips.forEach((data, i) => parts.push({ text: `【${i + 1}】` }, { inlineData: { mimeType: "audio/mp3", data } }));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json", responseSchema: schema },
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Gemini hear ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reply = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const out = (reply.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("");
  const heard = JSON.parse(out) as Heard;
  if (!Array.isArray(heard.runs) || heard.runs.length !== a.clips.length) {
    throw new Error(`Gemini hear: ${heard.runs?.length} pieces for ${a.clips.length}`);
  }
  heard.runs[heard.runs.length - 1].cut = false;
  return heard;
}
