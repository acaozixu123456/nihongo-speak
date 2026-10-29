import { ZH_VOICE } from "@/content/narration";

// 心で答える: the fixed sentence patterns (型) every answer is built from. A small set on purpose: the
// same 型 comes back in different questions all week, so it becomes automatic. ＿ is what the
// learner fills in; the rest is said as is.
export type Pattern = { id: string; form: string; zh: string };

export const PATTERNS: Pattern[] = [
  { id: "toki", form: "＿とき、＿てしまいました。", zh: "……的时候，不小心……了" },
  { id: "genin", form: "原因は＿ことです。", zh: "原因是……" },
  { id: "node", form: "＿ので、＿ことにしました。", zh: "因为……，决定……" },
  { id: "mazu", form: "まず＿て、それから＿ます。", zh: "先……，然后……" },
  { id: "yotei", form: "＿予定です。", zh: "打算／预定……" },
  { id: "youni", form: "＿ようにしています。", zh: "（平时）尽量……" },
  { id: "tara", form: "＿たら、＿ました。", zh: "……之后，发现……" },
  { id: "kadouka", form: "＿かどうか確認します。", zh: "确认是不是……" },
  { id: "moratta", form: "＿に＿てもらいました。", zh: "请……帮我……了" },
  { id: "hazu", form: "＿はずです。", zh: "应该……" },
  { id: "tokoro", form: "今、＿ているところです。", zh: "现在正在……" },
  { id: "tame", form: "＿ために、＿ました。", zh: "为了……，……了" },
  { id: "kedo", form: "＿ていたんですが、＿。", zh: "本来在……，但是……" },
  { id: "you", form: "＿みたいです。", zh: "好像……" },
  { id: "koto", form: "＿ことになりました。", zh: "（被）定下来要……" },
  { id: "naito", form: "＿ないといけません。", zh: "必须……" },
  { id: "temitara", form: "＿てみたら、＿。", zh: "试着……之后，……" },
  { id: "omotta", form: "思ったより＿。", zh: "比想象的……" },
  { id: "shi", form: "＿し、＿し、＿。", zh: "又……又……，所以……" },
  { id: "tsumori", form: "＿つもりです。", zh: "打算……" },
];

export const patternById = (id: string) => PATTERNS.find((p) => p.id === id);

// Who speaks: 森先生's voice (SENSEI_VOICE) asks, 摸鱼模式's Chinese voice says what to answer (laps 1
// and 2), the answer voice says the answer.
export const ASK_VOICE = "ja-JP-MoriNeural|ja-JP-MayuNeural";
export const HINT_VOICE = ZH_VOICE;
export const ANSWER_VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";

// What 森先生 says before laps 2 and 3.
export const OPENERS = ["二周目です。", "最後です。今度は一人で。"];
