// One NHKやさしいことばニュース article as the app keeps it: NHK's text with its readings, cut into
// sentences, with our notes. Shared by the server (lib/news.ts) and the phone (lib/client/news.ts).

export type Seg = { t: string; r?: string; name?: true };
// say: what the voice is given (names by their reading); p: starts a new paragraph.
// scene_image: one picture of the whole situation of the sentence (who, to whom, where), drawn for it
// (lib/pictures.ts); missing when none could be drawn that shows it right.
export type NewsSentence = { segs: Seg[]; ja: string; say: string; zh: string; p?: true; scene_image?: string };
// A word as a card: picture (image_url), the Chinese gloss (zh) and the word with its reading. look: a thing
// shown as itself (a clear photo), or a word shown by one moment it is used in.
export type NewsWord = { ja: string; kana: string; zh: string; image_url?: string; look?: "thing" | "scene" };

export type NewsArticle = {
  id: string; // NHK's news_id
  day: string; // the day NHK put it out (JST), YYYY-MM-DD
  at: string; // when, "YYYY-MM-DD HH:MM:SS"
  rank: number; // NHK's order within the day
  title: Seg[];
  title_ja: string;
  title_say?: string; // what the voice is given for the title: NHK's readings for its kanji (a headline has few particles to guess from)
  title_zh: string;
  sentences: NewsSentence[];
  words: NewsWord[];
  keys: NewsWord[]; // the skeleton for 三回話す, in the story's order
  summary: string[]; // the story in three sentences, a model for telling it
  url: string;
  image?: true; // NHK's picture for the story is kept, at /api/news/img/<id>
  pics?: number; // pictures for the sentences and words: how many runs have tried (lib/pictures.ts); PICS_DONE once all are
};

export const PICS_DONE = 99;

// How the sentences are shown while they are said. none: no text, the sentence's picture; kana: the sentence
// in kana only; kanji: NHK's text with its readings; zh: the Chinese alone. One layer at a time.
export type CaptionMode = "none" | "kana" | "kanji" | "zh";
export const CAPTION_MODES: CaptionMode[] = ["none", "kana", "kanji", "zh"];
export const CAPTION_LABEL: Record<CaptionMode, string> = { none: "なし", kana: "かな", kanji: "漢字", zh: "中文" };
// The sentence in kana: every word with a reading said by it.
export const kanaOf = (segs: Seg[]) => segs.map((s) => s.r ?? s.t).join("");

// The anchor's voice: Gemini's Sulafat, Azure's Nanami behind it.
export const NEWS_VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";
// The voices each article can be switched to: women (Gemini's Sulafat, Leda, Aoede), then men (Charon, Iapetus,
// Achird). An ear used to many voices copes with new ones far better than one used to a single voice.
export const NEWS_VOICES = [
  NEWS_VOICE,
  "ja-JP-MayuNeural",
  "ja-JP-AoiNeural",
  "ja-JP-Masaru:DragonHDLatestNeural|ja-JP-KeitaNeural",
  "ja-JP-DaichiNeural",
  "ja-JP-KeitaNeural",
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
// Articles are kept this many days (NHK's copyright: for studying, not to build a library).
export const NEWS_DAYS = 14;
