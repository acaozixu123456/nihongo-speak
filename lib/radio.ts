import "server-only";
import * as z from "zod/v4";
import { makeRadioWithClaude } from "@/lib/claude";
import { vertexAccess, vertexConfigured } from "@/lib/vertex-tts";
import { LEARNER, LEVEL } from "@/lib/learner";

// 趣味电台 (Easy Talk Radio): two hosts chat in English like a real radio show (small talk, a
// listener's letter that is really the learner's own mistake, one surprising fact, a line to keep),
// so listening practice is something the learner wants to hear to the end. Gemini on Vertex AI writes it (paid from the Google Cloud
// credit); Claude takes over if that fails.

const Line = z.object({
  part: z.enum(["open", "letter", "main", "word"]).describe("open: opening chat / letter: listener's letter / main: the main story / word: phrase of the day"),
  who: z.enum(["A", "B"]).describe("A: Amy (woman, curious, big reactions). B: Ben (man, knows a lot but a bit goofy)"),
  ja: z.string().describe("The line (English, 1-2 sentences, 20 words at most)"),
  zh: z.string().describe("Chinese translation"),
  gap: z
    .number()
    .describe("Seconds from the end of the previous line to this one (0.15-1.2). No overlapping. Quick comebacks 0.15-0.2, normal 0.3, before a surprise, a pause or a punchline 0.7-1.2"),
  back: z
    .string()
    .describe("A small backchannel the other host slips in during this line ('uh-huh', 'right', 'wow', 'oh', 'yeah', 2 words at most). Only on 4-6 longer lines in all. Otherwise empty"),
  easy: z
    .string()
    .describe(`Only when this line is hard for a ${LEVEL} learner (B2 words or above, idioms, complex sentences): the same meaning in ${LEVEL} words and grammar, in the speaker's tone. Only 4-8 lines in all. Otherwise empty`),
});

export const RadioSchema = z.object({
  title_zh: z.string().describe("The show's title (Chinese, 15 characters at most). A question that makes you want to listen"),
  title_ja: z.string().describe("The same question as title_zh as a natural English title (10 words at most). Not a word-for-word translation"),
  hook_zh: z.string().describe("1-2 Chinese sentences shown on screen. Raise the question without giving the answer, so she wants to hear the rest"),
  lines: z.array(Line).describe("open → letter → main → word, 30-40 lines of back-and-forth in all"),
  story: z
    .object({
      keys: z
        .array(z.object({ ja: z.string().describe("The word (as written)"), kana: z.string().describe("Its pronunciation in IPA") }))
        .describe("Exactly 3 words that form the skeleton for telling the main story to someone, in the story's order: how it starts, the surprising fact, the punchline. Words actually used in the main story"),
      summary: z
        .array(z.string())
        .describe("The 3-sentence summary of the main story Amy says at the start of word (English, 15 words at most each). Exactly the same as those lines in lines"),
    })
    .describe("The skeleton for telling this story to someone after listening"),
  hitokoto: z
    .object({
      when_ja: z.string().describe("When to use it (English, short. E.g. 'When a customer asks for a discount')"),
      ja: z.string().describe("The one short sentence you most want her to take home today, sayable as is (English, 8 words at most)"),
      zh: z.string().describe("Chinese meaning and one small tip (20 characters at most)"),
    })
    .describe("Phrase of the day. If there was a letter, the right way to say it"),
  phrases: z
    .array(z.object({ ja: z.string().describe("A phrase from the conversation she can use as is at the shop or in daily life (English, 12 words at most, a complete sentence, no '...')"), zh: z.string() }))
    .describe("Key phrases, 3-4"),
  words: z
    .array(
      z.object({
        ja: z.string().describe("A word from the conversation (as written)"),
        kana: z.string().describe("Its pronunciation in IPA"),
        zh: z.string().describe("Chinese meaning (short)"),
      }),
    )
    .describe("6-8 words worth learning, especially ones common on the TOEIC. Only words actually said. Leave out basic words everyone knows"),
  grammar: z
    .array(
      z.object({
        pattern: z.string().describe("The pattern (e.g. 'used to + verb')"),
        zh: z.string().describe("Meaning and use (Chinese, 1-2 sentences)"),
        ja: z.string().describe("The sentence it was actually used in (as is)"),
      }),
    )
    .describe("2-3 grammar points or set phrases used in the conversation"),
});

// Episodes made before the show had parts, gaps or a phrase of the day (none in this app, kept so the
// phone's saved episodes all read the same way).
export const OldRadioSchema = RadioSchema.extend({
  title_ja: z.string().optional(),
  story: RadioSchema.shape.story.optional(),
  lines: z.array(Line.partial({ part: true, gap: true, back: true, easy: true })),
  hitokoto: RadioSchema.shape.hitokoto.optional(),
  quiz_zh: z.string().optional(),
  letter: z.object({ said: z.string(), better: z.string(), where: z.string().optional() }).optional(),
  readings: z.number().optional(),
});

// What the phone stores and plays.
export type Radio = z.infer<typeof OldRadioSchema>;

// A listener's letter: a sentence the learner got wrong lately, and the better way.
export type Letter = { said: string; better: string; where?: string };

// Picked by the week so the episodes don't all drift to the same kind of trivia. Close to the learner's
// life: the shop, customers from abroad, offices and the kind of world the TOEIC is set in.
const TOPICS = [
  "the surprising stories behind famous brands and shops",
  "why shops and supermarkets are laid out the way they are (the psychology of shopping)",
  "customer service around the world: tipping, bowing, 'have a nice day'",
  "the strange history of everyday things (receipts, price tags, shopping bags, credit cards)",
  "office life around the world: meetings, emails, small talk",
  "travel and airports: surprising facts",
  "food from around the world and how it got its name",
  "English words with surprising origins",
  "numbers that will surprise you about money and shopping",
  "famous inventions that happened by accident",
  "what tourists in Japan find surprising",
  "hotels, restaurants and the hospitality business behind the scenes",
  "how English differs in the US, the UK and Australia",
  "jobs that exist in other countries but not in Japan or China",
  "the science of habits, sleep and learning",
];

const SYSTEM = `You are the writer of "Easy Talk Radio", a radio show for English learners. ${LEARNER} She listens with earphones on her way to work or on a break, without looking at the screen.
The goal: it should feel like a real radio show she wants to hear to the end. Fun comes before "study".

Hosts:
- Amy (A, woman): curious, big reactions. Often says "Wait, what?" and "No way!".
- Ben (B, man): knows a lot but is a bit goofy. Loves building suspense: "Okay, so here's the thing...".
- They are good friends and tease each other a little. They laugh for real (say "haha" in the line).

Show order (the title call is added separately, don't write it):
1. open (4-6 lines): small talk about the day or the season. Ben teases the main topic a little.
2. letter (6-8 lines): Amy says "We got a letter! It's from our listener, Busy Bee." and reads it. Its content is given below (a small mistake she made in English). The two laugh ("happens to everyone!"), briefly explain why it sounds odd, and give the right way. End with "Busy Bee, next time try: ...!" to cheer her on.
3. main (14-20 lines): one surprising fact. Start with a question that makes you go "really?", don't answer at once, add hints and side stories, reveal the answer in the second half.
4. word (6-8 lines): first Amy says "So, to sum up today's story..." and goes over the main story in 3 sentences (the 3 sentences of story.summary exactly, one per line, in words a listener can use as is to tell this story to someone. Ben only gives short reactions). Then the "phrase of the day": Amy introduces the hitokoto sentence and each host says it once. End brightly, e.g. "See you next time!".

Make the conversation alive:
- Nobody explains for long. Every 2-3 lines the other reacts ("Really?", "No way!", "Come on!", "Wait, why?").
- Lines don't overlap (gap 0.15 or more). Short reactions come back fast; pause before a surprise or a punchline (longer gap).
- back (backchannels) only on lines that explain at length, 4-6 in all.
- Only facts you are sure of. If accounts differ, say "some people say". Don't make up numbers or dates.

English:
- Vocabulary and grammar around ${LEVEL}. When a harder word comes up, the other host rephrases it in the talk ("So you mean...?").
- Keep each line short (20 words at most). Natural spoken English; contractions are fine.
- Everything is read out loud, so no stage directions like (laughs), no symbols, emoji or "...".

Last, also write the study notes for this episode (for review after listening):
- story: after listening she practises telling this story to a coworker or friend. 3 skeleton words and a 3-sentence summary.
- hitokoto: the phrase of the day. Prefer the right way from the letter.
- phrases: phrases actually used, that she can use as is at the shop or in daily life. Complete sentences, no "...".
- words: words worth learning, with IPA and Chinese, TOEIC words first.
- grammar: patterns used and the sentences they were used in.`;

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// One genre for a whole week (weeks start on Monday, Tokyo time), so the same words and ways of
// saying things keep coming back from one episode to the next: Krashen's narrow listening.
function weekTopic(now: Date) {
  const week = Math.floor((Math.floor(now.getTime() / 86400000) + 3) / 7);
  return TOPICS[week % TOPICS.length];
}

// wish: a listener's request, in their own words, usually Chinese. letter: what the learner got wrong
// lately, read out as the listener's letter. recent: words taught in the last few episodes, a few of
// which come back so they are met again.
// news: this morning's news article the learner heard; the hosts talk it over.
export type RadioNews = { title: string; summary: string[]; words: string[] };

function prompt(avoid: string[], wish?: string, letter?: Letter, recent: string[] = [], news?: RadioNews) {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const topic = news
    ? `This morning's news "${news.title}" (content: ${news.summary.join(" ")}). The listener heard this news this morning. In open, Amy brings it up ("So I heard on the news this morning..."); in main, without changing or adding to the facts, Amy and Ben chat about it casually, tying it to their own work and life. Use the news words (${news.words.join(", ")}) naturally several times`
    : wish
    ? `A listener's request: "${wish}". Make it close to the life of someone working in a shop in Japan (Amy introduces the request in open)`
    : `One story from this week's theme "${weekTopic(now)}" (every episode this week has this theme, so in open they may mention "It's ... week!")`;
  const mail = letter
    ? `The letter: Busy Bee (a Chinese woman working in a shop in Japan) ${letter.where ? `was at "${letter.where}" and ` : ""}said "${letter.said}". The right way is "${letter.better}". Read it as her own little mistake, a bit funny (make up a natural situation if none is given).`
    : "The letter: make up one small, funny English mistake a shop worker made with a foreign customer (at the register, giving directions, on the phone).";
  return `Today: ${WEEKDAY[now.getUTCDay()]}, ${MONTH[now.getUTCMonth()]} ${now.getUTCDate()}
This episode's genre: ${topic}
${mail}
${avoid.length ? `Recent topics (don't repeat): ${avoid.join(" / ")}` : ""}
${recent.length ? `Words learned in recent episodes: ${recent.join(", ")}\nUse 2-3 of them again naturally in the conversation (no need to explain them again; don't put them in words).` : ""}`;
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
        return { ...r, letter, by: "gemini" };
      } catch (e) {
        console.warn("radio: Gemini failed", e);
      }
    }
  }
  onProgress({ stage: "claude" });
  const r = await makeRadioWithClaude(RadioSchema, SYSTEM, prompt(avoid, wish, letter, recent, news));
  return { ...r, letter, by: "claude" };
}
