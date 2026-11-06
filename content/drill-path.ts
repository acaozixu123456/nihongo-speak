import { seedKey } from "@/lib/drill-model";

// 型ドリル's list of what to practise, in the order it comes up in a day of work and life in Japan:
// the forms said every few minutes first, then the ones that carry reasons and plans, then the work
// patterns, then speaking with and for other people. Each opens a ladder of its own; one said fast
// all through unlocks its 升级 (中級, then 会話).
// kind: the つなぐ items, built into a sentence their own way (see lib/claude.ts LADDER_KINDS):
// joshi a verb with the particle it takes, ireru a sentence put inside another, tsunagu sentences joined.
export type BuildKind = "joshi" | "ireru" | "tsunagu";
export type PathItem = { seed: string; zh: string; kind?: BuildKind };
export type PathStage = { name: string; items: PathItem[]; kind?: BuildKind };

// 組み立て: what came out wrong most in the learner's own retellings and calls (2026-10/11): the
// particle a verb takes (会議が参加 → 会議に参加), a sentence inside another in plain form (作りたいです
// と言っていました → 作ると言っていました, 使用のパン → 使うパン), and sentences joined instead of each
// ended with はい (それで・例えば never said, 〜て left hanging).
const BUILD: { name: string; kind: BuildKind; items: PathItem[] }[] = [
  {
    name: "助詞",
    kind: "joshi",
    items: [
      { seed: "に参加する", zh: "参加……（用に）" },
      { seed: "に行く・に着く", zh: "去／到……" },
      { seed: "に乗る・を降りる", zh: "坐／下（车）" },
      { seed: "に会う", zh: "见（人）" },
      { seed: "に入る・を出る", zh: "进／出" },
      { seed: "に住む・で働く", zh: "住在／在……工作" },
      { seed: "が分かる・ができる", zh: "懂／会（用が）" },
      { seed: "に聞く・に言う", zh: "问人／跟人说" },
    ],
  },
  {
    name: "文に入れる",
    kind: "ireru",
    items: [
      { seed: "〜る＋名詞", zh: "动词直接修饰名词（用的面包）" },
      { seed: "〜予定です", zh: "预定……" },
      { seed: "〜とき", zh: "……的时候" },
      { seed: "〜た＋名詞", zh: "（昨天买的）书" },
      { seed: "〜のは〜です", zh: "……的是……" },
      { seed: "〜のか", zh: "（为什么）……呢" },
      { seed: "〜ために", zh: "为了……" },
      { seed: "〜って", zh: "（他）说……" },
    ],
  },
  {
    name: "つなぐ",
    kind: "tsunagu",
    items: [
      { seed: "〜て、最後まで", zh: "用て连起来，说完" },
      { seed: "それで", zh: "所以／然后" },
      { seed: "例えば", zh: "比如" },
      { seed: "だから", zh: "所以" },
      { seed: "でも", zh: "但是" },
      { seed: "実は〜んです", zh: "其实……" },
      { seed: "そのあと", zh: "那之后" },
      { seed: "結局", zh: "结果／最后" },
    ],
  },
];
export const BUILD_PATH: PathStage[] = BUILD.map((st) => ({ ...st, items: st.items.map((x) => ({ ...x, kind: st.kind })) }));

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

// The first list, then the 組み立て one taken round the three kinds (a particle, a sentence inside one,
// a join, the next particle…), so one kind never runs three times in a row.
export const FORM_ITEMS = DRILL_PATH.flatMap((s) => s.items);
export const BUILD_ITEMS: PathItem[] = Array.from({ length: Math.max(...BUILD_PATH.map((s) => s.items.length)) }, (_, k) =>
  BUILD_PATH.map((s) => s.items[k]).filter(Boolean),
).flat();
export const PATH_ITEMS = [...FORM_ITEMS, ...BUILD_ITEMS];

// How a ladder is built for this word: one of the 組み立て kinds, or the usual one.
export const kindOf = (seed: string): BuildKind | undefined => BUILD_ITEMS.find((x) => seedKey(x.seed) === seedKey(seed))?.kind;
