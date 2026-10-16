import type { Scenario } from "./scenarios";

// Phone calls: voice only, no faces and (by default) no subtitles.
// They reuse the role-play API with the talk settings sent from the client.

export type Call = {
  id: string;
  titleZh: string;
  who: string; // shown as the caller / callee name
  incoming: boolean; // the other side calls the learner
  talk: Scenario["talk"];
};

const RECEPTION = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural@customerservice";
const MAN = "ja-JP-Masaru:DragonHDLatestNeural|ja-JP-KeitaNeural";
const KACHO = "ja-JP-Masaru:DragonHDLatestNeural|ja-JP-NanamiNeural@chat";

const PHONE = `これは電話です。お互いに顔は見えません。
電話らしい話し方をする：1回の発話は短く（1〜2文）、名前や日時、番号は復唱して確認する。
学習者が聞き返したり（もう一度お願いします、など）黙ったりしたら、少しゆっくり、言い換えて言い直す。
用件が済んだら、電話らしく自然に締めくくる（失礼いたします、など）。`;

export const calls: Call[] = [
  {
    id: "clinic",
    titleZh: "打电话预约看病",
    who: "さくら内科クリニック",
    incoming: false,
    talk: {
      aiRole: "さくら内科クリニックの受付（丁寧な敬語）",
      aiVoice: RECEPTION,
      userRole: "初めて受診したい患者",
      goalZh: "说明症状（发烧、喉咙痛），约明天下午看病，确认时间和要带的东西。",
      setup: `${PHONE}
学習者がクリニックに電話して、診察の予約を取る。受付は症状、初診かどうか、名前、電話番号、希望の時間を順に聞き、空いている時間を提案し、保険証を持ってくるよう伝える。`,
      opening: { ja: "お電話ありがとうございます。さくら内科クリニックでございます。", zh: "感谢来电，这里是樱内科诊所。" },
    },
  },
  {
    id: "redelivery",
    titleZh: "打电话约快递再配送",
    who: "ヤマト運輸 再配達受付",
    incoming: false,
    talk: {
      aiRole: "宅配会社の再配達受付（丁寧な敬語）",
      aiVoice: RECEPTION,
      userRole: "不在で荷物を受け取れなかった人",
      goalZh: "说明快递没收到，约今晚 19 点到 21 点再送，回答对方问的单号、地址和姓名。",
      setup: `${PHONE}
学習者は不在票を見て電話した。受付は伝票番号（12桁、学習者が言えなければ名前と住所で調べる）、届け先、希望日時を聞き、内容を復唱して確定する。`,
      opening: { ja: "お電話ありがとうございます。ヤマト運輸、再配達受付でございます。", zh: "感谢来电，这里是大和运输再配送受理。" },
    },
  },
  {
    id: "restaurant",
    titleZh: "打电话订餐厅",
    who: "居酒屋 とりまる",
    incoming: false,
    talk: {
      aiRole: "居酒屋の店員（明るく丁寧）",
      aiVoice: MAN,
      userRole: "会社の飲み会の予約をしたい人",
      goalZh: "订本周五晚上 7 点 4 个人，问有没有包间，说一个人对虾过敏。",
      setup: `${PHONE}
学習者が居酒屋に予約の電話をする。店員は日時と人数を確認し、個室は7時半からなら空いていると伝える（学習者がどうするか決める）。コースか単品か、名前と電話番号を聞く。`,
      opening: { ja: "お電話ありがとうございます。とりまるです。", zh: "感谢来电，这里是鸟丸。" },
    },
  },
  {
    id: "client",
    titleZh: "接到客户找课长的电话",
    who: "ABC商事 田中様",
    incoming: true,
    talk: {
      aiRole: "取引先 ABC商事の田中（丁寧なビジネス敬語）",
      aiVoice: MAN,
      userRole: "山田課長のチームのエンジニア（会社の電話に出た）",
      goalZh: "告诉对方课长在开会，问要不要回电，复述并记下对方的名字、公司和电话号码。",
      setup: `${PHONE}
学習者の会社に取引先から電話がかかってきた。田中は山田課長と話したいが、課長は会議中。田中は折り返しの電話を頼み、自分の電話番号（03-1234-5678）を伝える。学習者が復唱すれば確認する。`,
      opening: { ja: "お世話になっております。ABC商事の田中と申しますが、山田課長はいらっしゃいますか。", zh: "承蒙关照。我是 ABC 商事的田中，请问山田课长在吗？" },
    },
  },
  {
    id: "sick",
    titleZh: "早上打给课长请病假",
    who: "山田課長",
    incoming: false,
    talk: {
      aiRole: "山田課長（部下に優しいが、仕事の段取りは確認する）",
      aiVoice: KACHO,
      userRole: "熱が出て今日休みたいエンジニア",
      goalZh: "说发烧了今天想请假，交代今天的会议和要交的东西，说明天的打算。",
      setup: `${PHONE}
朝8時半、学習者が課長の携帯に電話する。課長は体調を気遣い、今日の予定（午後のレビュー会議、明日締切の資料）をどうするか聞く。`,
      opening: { ja: "はい、山田です。", zh: "喂，我是山田。" },
    },
  },
];

export const findCall = (id: string) => calls.find((c) => c.id === id);
