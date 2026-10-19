import { NextResponse } from "next/server";
import { judgeAnswer, retellFix, smartModel } from "@/lib/claude";

// Temporary: the same real answers judged by each model, to choose one. Removed after the comparison.
export const maxDuration = 300;

const judges = [
  { zh: "请给我一个袋子。", ja: "袋を一枚お願いします。", where: "便利店", said: "作ろう。を一枚お願いします。" },
  { zh: "给我点提示嘛！", ja: "ヒントちょうだい！", where: "朋友", said: "ヒント状態。" },
  { zh: "不被提醒的话还真注意不到呢。", ja: "言われないと気づかないよね。", where: "朋友", said: "言われないで。傷がないよね。" },
  { zh: "好的。中午之前我先汇报一次情况。", ja: "承知しました。お昼までに一度状況を報告します。", where: "对课长", said: "はい。わかりました。" },
];
const tellings = [
  {
    topic: "面包本来就能吃，为何叫“食面包”？",
    said: "はい、今日ラジオで食パンてー話を聞いたんですけど、えっとびっくりしたのは、えっと最初、えーパンは、えっと職じゃなくて、えっと、別の用、別の用のものですね。はい。えっとえっと、 最初 は、 えとテッサン、テッサン、えっと、用のパンです。はい。えーと、消しパン、えー、ということ、です。そうですね。えーと、だから、えーとえっと、食パンはえーけしぱんよりえっとーえーちょっとえーえーっとー、ちかいますねはい",
  },
  {
    topic: "最近吃过的好吃的东西",
    said: "はい、最近、えっと、食べたのは、えー、しゃぶしゃぶです。はい。えっと、実は、えー、妻と一緒に、えっと、えー、食べて、えー行ったんですね。はい。えーめっちゃ美味しいです。はい。えっとー結局、えーいっぱいたべちゃたんです。",
  },
];

async function timed<T>(model: string, run: () => Promise<T>) {
  const t = Date.now();
  try {
    const out = await smartModel.run(model, run);
    return { secs: (Date.now() - t) / 1000, out };
  } catch (e) {
    return { secs: (Date.now() - t) / 1000, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  const models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
  const rows = await Promise.all(
    models.map(async (model) => ({
      model,
      judge: await Promise.all(judges.map((j) => timed(model, () => judgeAnswer(j)))),
      retell: await Promise.all(tellings.map((t) => timed(model, () => retellFix(t)))),
    })),
  );
  return NextResponse.json(rows);
}
