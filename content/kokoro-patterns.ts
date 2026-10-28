// 心で答える: the fixed sentence patterns (型) every answer is built from. A small set on purpose: the
// same 型 comes back in different questions all week, so it becomes automatic. ＿ is what the
// learner fills in; the rest is said as is.
// ex: a whole everyday sentence built on the 型, said in lap 1 instead of the 型 itself: a 型 read
// piece by piece came out with question-like rises (「原因は？」「か？どうか」).
export type Pattern = { id: string; form: string; zh: string; ex: string };

export const PATTERNS: Pattern[] = [
  { id: "toki", form: "＿とき、＿てしまいました。", zh: "……的时候，不小心……了", ex: "急いでいたとき、傘を電車に忘れてしまいました。" },
  { id: "genin", form: "原因は＿ことです。", zh: "原因是……", ex: "原因は、設定ファイルが古かったことです。" },
  { id: "node", form: "＿ので、＿ことにしました。", zh: "因为……，决定……", ex: "雨が降っていたので、タクシーで帰ることにしました。" },
  { id: "mazu", form: "まず＿て、それから＿ます。", zh: "先……，然后……", ex: "まずメールを確認して、それから会議の準備をします。" },
  { id: "yotei", form: "＿予定です。", zh: "打算／预定……", ex: "来週、お客さんと打ち合わせをする予定です。" },
  { id: "youni", form: "＿ようにしています。", zh: "（平时）尽量……", ex: "毎日、早めに寝るようにしています。" },
  { id: "tara", form: "＿たら、＿ました。", zh: "……之后，发现……", ex: "ログを見たら、エラーが出ていました。" },
  { id: "kadouka", form: "＿かどうか確認します。", zh: "确认是不是……", ex: "データが正しいかどうか確認します。" },
  { id: "moratta", form: "＿に＿てもらいました。", zh: "请……帮我……了", ex: "先輩にコードを見てもらいました。" },
  { id: "hazu", form: "＿はずです。", zh: "应该……", ex: "その資料は、もう送ったはずです。" },
  { id: "tokoro", form: "今、＿ているところです。", zh: "现在正在……", ex: "今、テストの結果をまとめているところです。" },
  { id: "tame", form: "＿ために、＿ました。", zh: "为了……，……了", ex: "早く終わらせるために、朝から作業しました。" },
  { id: "kedo", form: "＿ていたんですが、＿。", zh: "本来在……，但是……", ex: "テストをしていたんですが、途中で止まってしまいました。" },
  { id: "you", form: "＿みたいです。", zh: "好像……", ex: "明日は雨みたいです。" },
  { id: "koto", form: "＿ことになりました。", zh: "（被）定下来要……", ex: "来月から新しいプロジェクトに入ることになりました。" },
  { id: "naito", form: "＿ないといけません。", zh: "必须……", ex: "今日中に報告書を出さないといけません。" },
  { id: "temitara", form: "＿てみたら、＿。", zh: "试着……之后，……", ex: "設定を変えてみたら、うまく動きました。" },
  { id: "omotta", form: "思ったより＿。", zh: "比想象的……", ex: "思ったより時間がかかりました。" },
  { id: "shi", form: "＿し、＿し、＿。", zh: "又……又……，所以……", ex: "安いし、近いし、よくその店に行きます。" },
  { id: "tsumori", form: "＿つもりです。", zh: "打算……", ex: "週末はゆっくり休むつもりです。" },
];

export const patternById = (id: string) => PATTERNS.find((p) => p.id === id);

// Who speaks: 森先生's voice (SENSEI_VOICE) asks, the answer voice answers and says the examples.
export const ASK_VOICE = "ja-JP-MoriNeural|ja-JP-MayuNeural";
export const ANSWER_VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";

// What 森先生 says before laps 2 and 3.
export const OPENERS = ["二周目。今度はことばだけ。", "最後です。今度は一人で。"];
