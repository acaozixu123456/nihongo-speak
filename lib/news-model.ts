// One NHKやさしいことばニュース article as the app keeps it: NHK's text with its readings, cut into
// sentences, with our notes. Shared by the server (lib/news.ts) and the phone (lib/client/news.ts).

export type Seg = { t: string; r?: string; name?: true };
// say: what the voice is given (names by their reading); p: starts a new paragraph.
export type NewsSentence = { segs: Seg[]; ja: string; say: string; zh: string; p?: true };
export type NewsWord = { ja: string; kana: string; zh: string };

export type NewsArticle = {
  id: string; // NHK's news_id
  day: string; // the day NHK put it out (JST), YYYY-MM-DD
  at: string; // when, "YYYY-MM-DD HH:MM:SS"
  rank: number; // NHK's order within the day
  title: Seg[];
  title_ja: string;
  title_zh: string;
  sentences: NewsSentence[];
  words: NewsWord[];
  keys: NewsWord[]; // the skeleton for 三回話す, in the story's order
  summary: string[]; // the story in three sentences, a model for telling it
  url: string;
};

// The anchor's voice: Gemini's Sulafat, Azure's Nanami behind it.
export const NEWS_VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";
// Articles are kept this many days (NHK's copyright: for studying, not to build a library).
export const NEWS_DAYS = 14;
