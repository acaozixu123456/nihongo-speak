// 型ドリル's list of what to practise, in the order it comes up in a day of work and life in Japan:
// the forms said every few minutes first, then the ones that carry reasons and plans, then the work
// patterns, then speaking with and for other people. Each opens a ladder of its own; one said fast
// all through unlocks its 升级 (中級, then 会話).
export type PathItem = { seed: string; zh: string };
export type PathStage = { name: string; items: PathItem[] };

export const DRILL_PATH: PathStage[] = [
  {
    name: "基本",
    items: [
      { seed: "〜ます", zh: "礼貌说法" },
      { seed: "〜てください", zh: "请……" },
      { seed: "〜たいです", zh: "想……" },
      { seed: "〜んですが", zh: "那个……（开口铺垫）" },
      { seed: "〜ています", zh: "正在……／一直……" },
      { seed: "〜ましょう", zh: "……吧" },
      { seed: "〜ませんか", zh: "要不要……" },
      { seed: "〜てもいいですか", zh: "可以……吗" },
      { seed: "〜ないでください", zh: "请不要……" },
    ],
  },
  {
    name: "日常",
    items: [
      { seed: "〜ので", zh: "因为……" },
      { seed: "〜けど", zh: "虽然……但是" },
      { seed: "〜と思います", zh: "我觉得……" },
      { seed: "〜てから", zh: "……之后再" },
      { seed: "〜たら", zh: "……的话／……之后" },
      { seed: "〜ないといけない", zh: "必须……" },
      { seed: "〜つもりです", zh: "打算……" },
      { seed: "〜たことがあります", zh: "……过" },
      { seed: "〜前に", zh: "……之前" },
      { seed: "〜かもしれません", zh: "可能……" },
    ],
  },
  {
    name: "仕事",
    items: [
      { seed: "〜ておきます", zh: "事先……好" },
      { seed: "〜てしまう", zh: "不小心……了" },
      { seed: "〜てみます", zh: "试着……" },
      { seed: "〜かどうか", zh: "是不是……" },
      { seed: "〜ことにしました", zh: "决定……" },
      { seed: "〜ことになりました", zh: "定下来要……" },
      { seed: "〜はずです", zh: "应该……" },
      { seed: "〜なくてもいいです", zh: "不用……也行" },
      { seed: "〜みたいです", zh: "好像……" },
      { seed: "〜ようにしています", zh: "尽量……" },
      { seed: "〜ても", zh: "即使……也" },
      { seed: "〜ば", zh: "如果……" },
    ],
  },
  {
    name: "人と",
    items: [
      { seed: "〜てもらえますか", zh: "能帮我……吗" },
      { seed: "〜ていただけますか", zh: "能请您……吗" },
      { seed: "〜てもらいました", zh: "请人帮我……了" },
      { seed: "〜てくれました", zh: "（别人）为我……了" },
      { seed: "〜と言っていました", zh: "（某人）说过……" },
      { seed: "〜させてください", zh: "请让我……" },
      { seed: "〜でしょうか", zh: "……吗（客气）" },
      { seed: "お〜します", zh: "我来为您……" },
      { seed: "〜ところです", zh: "正要／刚刚……" },
    ],
  },
];

export const PATH_ITEMS = DRILL_PATH.flatMap((s) => s.items);
