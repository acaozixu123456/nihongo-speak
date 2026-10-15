export type Line = {
  speaker: string;
  voice: string;
  ja: string;
  kana: string;
  zh: string;
};

export type Scenario = {
  id: string;
  title: string;
  titleZh: string;
  category: "work" | "life";
  level: string;
  summaryZh: string;
  lines: Line[];
  talk: {
    aiRole: string;
    aiVoice: string;
    userRole: string;
    goalZh: string;
    setup: string;
    opening: { ja: string; zh: string };
  };
};

// Azure voice ids, optionally with "@style". Only Nanami has speaking styles in
// Japanese, so she plays the AI's conversation partners in her casual "chat" and
// polite "customerservice" styles. All of these are in the free F0 tier.
const KACHO = "ja-JP-NanamiNeural@chat";
const SATO = "ja-JP-MayuNeural";
const SUZUKI = "ja-JP-DaichiNeural";
const KANRI = "ja-JP-NanamiNeural@customerservice";

export const scenarios: Scenario[] = [
  {
    id: "asakai",
    title: "朝会での進捗報告",
    titleZh: "早会汇报进度",
    category: "work",
    level: "N3",
    summaryZh: "开发团队的早会：汇报昨天做了什么、今天做什么、有什么卡住的问题。",
    lines: [
      {
        speaker: "山田課長",
        voice: KACHO,
        ja: "おはようございます。じゃあ、朝会を始めます。佐藤さんからお願いします。",
        kana: "おはようございます。じゃあ、ちょうかいをはじめます。さとうさんからおねがいします。",
        zh: "早上好。那么开始早会。佐藤先请。",
      },
      {
        speaker: "佐藤",
        voice: SATO,
        ja: "はい。昨日はログイン画面の修正を終わらせて、今レビュー待ちです。",
        kana: "はい。きのうはログインがめんのしゅうせいをおわらせて、いまレビューまちです。",
        zh: "好的。昨天把登录页面的修改做完了，现在在等评审。",
      },
      {
        speaker: "佐藤",
        voice: SATO,
        ja: "今日はパスワード再設定の機能に取りかかる予定です。",
        kana: "きょうはパスワードさいせっていのきのうにとりかかるよていです。",
        zh: "今天打算开始做重置密码的功能。",
      },
      {
        speaker: "山田課長",
        voice: KACHO,
        ja: "了解です。何か困っていることはありますか。",
        kana: "りょうかいです。なにかこまっていることはありますか。",
        zh: "明白。有什么困扰的地方吗？",
      },
      {
        speaker: "佐藤",
        voice: SATO,
        ja: "メール送信のテスト環境がまだ用意できていないので、ちょっと困ってます。",
        kana: "メールそうしんのテストかんきょうがまだよういできていないので、ちょっとこまってます。",
        zh: "发邮件的测试环境还没准备好，有点头疼。",
      },
      {
        speaker: "山田課長",
        voice: KACHO,
        ja: "わかりました。それはインフラチームに確認しておきます。じゃあ、鈴木さん。",
        kana: "わかりました。それはインフラチームにかくにんしておきます。じゃあ、すずきさん。",
        zh: "知道了。这个我去跟基础设施组确认一下。那么，铃木。",
      },
      {
        speaker: "鈴木",
        voice: SUZUKI,
        ja: "はい。昨日は本番で出た不具合を調べてたんですけど、原因がまだはっきりしてなくて。",
        kana: "はい。きのうはほんばんででたふぐあいをしらべてたんですけど、げんいんがまだはっきりしてなくて。",
        zh: "好的。昨天一直在查生产环境出现的bug，不过原因还没完全搞清楚。",
      },
      {
        speaker: "鈴木",
        voice: SUZUKI,
        ja: "たぶんキャッシュまわりだと思うので、今日中には切り分けられると思います。",
        kana: "たぶんキャッシュまわりだとおもうので、きょうじゅうにはきりわけられるとおもいます。",
        zh: "我估计是缓存相关的问题，今天之内应该能定位出来。",
      },
      {
        speaker: "山田課長",
        voice: KACHO,
        ja: "お客さんにも聞かれてるので、わかり次第、共有してもらえますか。",
        kana: "おきゃくさんにもきかれてるので、わかりしだい、きょうゆうしてもらえますか。",
        zh: "客户那边也在问，一有结果能马上同步一下吗？",
      },
      {
        speaker: "鈴木",
        voice: SUZUKI,
        ja: "承知しました。お昼までに一度状況を報告します。",
        kana: "しょうちしました。おひるまでにいちどじょうきょうをほうこくします。",
        zh: "明白了。中午之前我先汇报一次情况。",
      },
    ],
    talk: {
      aiRole: "山田課長（開発チームのマネージャー）",
      aiVoice: KACHO,
      userRole: "チームのエンジニア",
      goalZh: "向课长汇报：昨天做了什么、今天做什么、有没有卡住的问题。说完后课长可能会追问。",
      setup:
        "毎朝10時のチームの朝会。ユーザーは開発チームのエンジニアで、自分の担当タスクの進捗を報告する。課長は報告を聞いて、具体的な点（期限、リスク、他チームとの調整など）を自然に追加で質問する。",
      opening: {
        ja: "おはようございます。じゃあ、朝会を始めましょうか。昨日の進捗からお願いします。",
        zh: "早上好。那我们开始早会吧。先说说昨天的进展。",
      },
    },
  },
  {
    id: "kyutoki",
    title: "管理会社に電話：給湯器の故障",
    titleZh: "给物业打电话：热水器坏了",
    category: "life",
    level: "N3",
    summaryZh: "家里热水器出不来热水，打电话给管理公司说明情况、约修理时间。",
    lines: [
      {
        speaker: "管理会社",
        voice: KANRI,
        ja: "お電話ありがとうございます。さくら不動産管理でございます。",
        kana: "おでんわありがとうございます。さくらふどうさんかんりでございます。",
        zh: "感谢您的来电，这里是樱花不动产管理。",
      },
      {
        speaker: "住人",
        voice: SUZUKI,
        ja: "すみません、さくらハイツ203号室の者なんですが、お湯が出なくなってしまって。",
        kana: "すみません、さくらハイツにひゃくさんごうしつのものなんですが、おゆがでなくなってしまって。",
        zh: "不好意思，我是樱花公寓203室的住户，热水出不来了。",
      },
      {
        speaker: "管理会社",
        voice: KANRI,
        ja: "それはご不便をおかけしております。いつ頃からでしょうか。",
        kana: "それはごふべんをおかけしております。いつごろからでしょうか。",
        zh: "给您带来不便了。大概是从什么时候开始的？",
      },
      {
        speaker: "住人",
        voice: SUZUKI,
        ja: "昨日の夜からです。リモコンにエラー番号が出ていて、111って表示されてます。",
        kana: "きのうのよるからです。リモコンにエラーばんごうがでていて、ひゃくじゅういちってひょうじされてます。",
        zh: "从昨天晚上开始。遥控器上显示错误代码，显示的是111。",
      },
      {
        speaker: "管理会社",
        voice: KANRI,
        ja: "かしこまりました。一度、給湯器の電源を切って、もう一度入れていただけますか。",
        kana: "かしこまりました。いちど、きゅうとうきのでんげんをきって、もういちどいれていただけますか。",
        zh: "明白了。能请您先把热水器的电源关掉，再重新打开一次吗？",
      },
      {
        speaker: "住人",
        voice: SUZUKI,
        ja: "それはもう試したんですけど、変わらなかったです。",
        kana: "それはもうためしたんですけど、かわらなかったです。",
        zh: "这个我已经试过了，没有变化。",
      },
      {
        speaker: "管理会社",
        voice: KANRI,
        ja: "そうですか。では、業者を手配いたします。ご都合のいい日時はございますか。",
        kana: "そうですか。では、ぎょうしゃをてはいいたします。ごつごうのいいにちじはございますか。",
        zh: "这样啊。那我们安排维修师傅。您方便的日期和时间是？",
      },
      {
        speaker: "住人",
        voice: SUZUKI,
        ja: "平日は仕事なので、できれば土曜日の午前中だと助かります。",
        kana: "へいじつはしごとなので、できればどようびのごぜんちゅうだとたすかります。",
        zh: "工作日要上班，如果可以的话周六上午最好。",
      },
      {
        speaker: "管理会社",
        voice: KANRI,
        ja: "承知いたしました。業者と調整して、本日中に折り返しご連絡いたします。",
        kana: "しょうちいたしました。ぎょうしゃとちょうせいして、ほんじつちゅうにおりかえしごれんらくいたします。",
        zh: "好的。我们和维修方协调后，今天之内给您回电。",
      },
    ],
    talk: {
      aiRole: "管理会社の受付担当（丁寧な敬語で話す）",
      aiVoice: KANRI,
      userRole: "マンションの住人",
      goalZh: "打电话说明：你是哪个房间的住户、热水器出了什么问题、从什么时候开始，然后约好修理时间。",
      setup:
        "ユーザーは賃貸マンション（さくらハイツ）の住人で、給湯器が故障したので管理会社に電話している。担当者は部屋番号、症状、いつから、エラー表示などを順に確認し、業者の訪問日時を調整する。時々、ユーザーが答えにくい質問（例：契約者名、連絡のつく時間帯）もする。",
      opening: {
        ja: "お電話ありがとうございます。さくら不動産管理でございます。",
        zh: "感谢您的来电，这里是樱花不动产管理。",
      },
    },
  },
];

export function getScenario(id: string) {
  return scenarios.find((s) => s.id === id);
}
