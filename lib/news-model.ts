// One news article as the app keeps it: a BBC story written again in easy English, cut into sentences,
// with our notes. Shared by the server (lib/news.ts) and the phone (lib/client/news.ts). ja is the English.

// A piece of a sentence (r and name are from the Japanese app's readings, unused here).
export type Seg = { t: string; r?: string; name?: true };
// say: what the voice is given; p: starts a new paragraph.
// voice: only on a radio line said back (its host's voice).
export type NewsSentence = { segs: Seg[]; ja: string; say: string; zh: string; p?: true; voice?: string };
export type NewsWord = { ja: string; kana: string; zh: string };

export type NewsArticle = {
  id: string; // from the BBC story's address
  day: string; // the day the BBC put it out (JST), YYYY-MM-DD
  at: string; // when, "YYYY-MM-DD HH:MM:SS"
  rank: number; // its order within the day
  title: Seg[];
  title_ja: string;
  title_say?: string; // what the voice is given for the title
  title_zh: string;
  sentences: NewsSentence[];
  words: NewsWord[];
  keys: NewsWord[]; // the skeleton for 三回話す, in the story's order
  summary: string[]; // the story in three sentences, a model for telling it
  url: string; // the BBC story it was written from
  image?: true; // the story's picture is kept, at /api/news/img/<id>
};

// The anchor's voice: Gemini's Sulafat, Azure's Ava behind it.
export const NEWS_VOICE = "en-US-Ava:DragonHDLatestNeural|en-US-AvaNeural";
// The voices each article can be switched to: women (Gemini's Sulafat, Leda, Aoede), then men (Charon, Iapetus,
// Achird). An ear used to many voices copes with new ones far better than one used to a single voice, and
// the TOEIC itself is read by many different voices.
export const NEWS_VOICES = [
  NEWS_VOICE,
  "en-US-EmmaNeural",
  "en-US-JennyNeural",
  "en-US-Andrew:DragonHDLatestNeural|en-US-AndrewNeural",
  "en-US-BrianNeural",
  "en-US-DavisNeural",
];
export const VOICE_LABEL = ["女1", "女2", "女3", "男1", "男2", "男3"];
// The voice picked for an article, else the anchor's.
export const newsVoice = (pick?: string) => (pick && NEWS_VOICES.includes(pick) ? pick : NEWS_VOICE);
// The same place in the other half of the list: a man for a woman and the other way round.
export const otherVoice = (voice: string) => NEWS_VOICES[(Math.max(0, NEWS_VOICES.indexOf(voice)) + 3) % NEWS_VOICES.length];
// How fast the pass without the text goes, as a share of the voice's own pace; the pass with it is always 1.
export const NEWS_PACES = [1, 1.15, 0.9, 1.25];

// The same article always gets the same pace; the articles of a day get different ones, and the next day
// starts elsewhere.
const dayNo = (a: NewsArticle) => Math.floor(Date.parse(`${a.day}T00:00:00Z`) / 86_400_000) || 0;
export const newsPace = (a: NewsArticle) => NEWS_PACES[(dayNo(a) * 3 + a.rank) % NEWS_PACES.length];
// Articles are kept this many days (written from the BBC's stories: for studying, not to build a library).
export const NEWS_DAYS = 14;
