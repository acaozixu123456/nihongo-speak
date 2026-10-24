// ja: the line in English (the name is from the Japanese app this one was made from); kana: unused, "".
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
  icon: string;
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

import { lifeScenes } from "./scenes-life";
import { workScenes } from "./scenes-work";
import { L } from "./line";
import { HD_MAN, HD_MAN_CALM, HD_WOMAN, HD_WOMAN_POLITE, MAN_2, MAN_3, WOMAN_2 } from "./voices";


// The learner's own lines are said by the same voice in every shop scene.
const ME = WOMAN_2;

// The shop floor first: what a sales clerk says to customers from abroad every day.
const firstScenes: Scenario[] = [
  {
    id: "greet",
    title: "Greeting a customer",
    titleZh: "招呼客人、问需要什么",
    category: "work",
    icon: "👋",
    level: "A2",
    summaryZh: "外国客人进店随便看看：打招呼、问需要什么、介绍一下，然后让客人慢慢看。",
    lines: [
      L("Clerk", ME, "Hi, welcome in! Let me know if you need any help.", "您好，欢迎光临！需要帮忙的话请叫我。"),
      L("Customer", HD_MAN, "Thanks. Actually, I'm looking for a present for my sister.", "谢谢。其实我在找送给我姐姐的礼物。"),
      L("Clerk", ME, "Oh, nice. Do you have anything in mind?", "哦，不错。您有什么想法吗？"),
      L("Customer", HD_MAN, "Not really. Something small, maybe something Japanese.", "没什么具体的。小东西就行，最好有日本特色。"),
      L("Clerk", ME, "How about these handkerchiefs? They're made in Kyoto.", "这些手帕怎么样？是京都产的。"),
      L("Customer", HD_MAN, "Oh, they're pretty. How much are they?", "哦，真漂亮。多少钱？"),
      L("Clerk", ME, "They're 1,200 yen each, or three for 3,000 yen.", "一条 1200 日元，三条 3000 日元。"),
      L("Customer", HD_MAN, "That's a good deal. Can I look around a bit first?", "挺划算的。我能先到处看看吗？"),
      L("Clerk", ME, "Of course. Take your time. I'll be right over there.", "当然。您慢慢看，我就在那边。"),
    ],
    talk: {
      aiRole: "a tourist from the US who walks into the shop (friendly, a little unsure what to buy)",
      aiVoice: HD_MAN,
      userRole: "a sales clerk at a gift and accessories shop",
      goalZh: "主动招呼客人，问清他想买什么、送给谁、预算多少，推荐一两样商品，说价格。",
      setup:
        "A tourist walks into the shop where the learner works. He is looking for a gift but has no clear idea. He answers her questions (who it is for, budget, what they like), asks about prices and whether things are made in Japan, and decides whether to look around or buy.",
      opening: { ja: "Hi there. Um, I'm just looking, I think.", zh: "你好。嗯，我应该就是随便看看。" },
    },
  },
  {
    id: "size",
    title: "Sizes and the fitting room",
    titleZh: "找尺码、带客人去试衣间",
    category: "work",
    icon: "👗",
    level: "A2",
    summaryZh: "客人想试穿：问尺码、拿别的尺码和颜色、带去试衣间，再问合不合适。",
    lines: [
      L("Customer", HD_WOMAN, "Excuse me, do you have this jacket in a medium?", "打扰一下，这件夹克有中号吗？"),
      L("Clerk", ME, "Let me check. Yes, here's a medium. Would you like to try it on?", "我看一下。有的，这是中号。您要试穿一下吗？"),
      L("Customer", HD_WOMAN, "Yes, please. Where's the fitting room?", "好的。试衣间在哪儿？"),
      L("Clerk", ME, "It's just over here. Could you take off your shoes, please?", "就在这边。麻烦您脱一下鞋。"),
      L("Customer", HD_WOMAN, "Sure.", "好的。"),
      L("Clerk", ME, "How does it fit?", "穿着合适吗？"),
      L("Customer", HD_WOMAN, "It's a little tight around the shoulders.", "肩膀那里有点紧。"),
      L("Clerk", ME, "Shall I bring you a large?", "要不要我给您拿件大号的？"),
      L("Customer", HD_WOMAN, "Yes, please. And do you have it in navy?", "好的，麻烦了。有藏青色的吗？"),
      L("Clerk", ME, "I'm afraid we only have black and beige in a large.", "不好意思，大号只有黑色和米色。"),
      L("Customer", HD_WOMAN, "Then I'll try the black one.", "那我试试黑色的。"),
    ],
    talk: {
      aiRole: "a customer from Australia trying on clothes (relaxed, asks a lot of questions)",
      aiVoice: HD_WOMAN,
      userRole: "a sales clerk at a clothing shop",
      goalZh: "回答客人要的尺码和颜色，带她去试衣间、提醒脱鞋，问合不合适，没有的尺码和颜色要客气地说明。",
      setup:
        "A customer wants to try on a coat. She asks for her size, the fitting room, and other colours. One size is sold out in the colour she wants. She asks for the learner's honest opinion and whether it can be shortened.",
      opening: { ja: "Hi, could I try this coat on? Do you have it in a small?", zh: "你好，我能试穿这件外套吗？有小号吗？" },
    },
  },
  {
    id: "stock",
    title: "Out of stock",
    titleZh: "没货了：去仓库看、帮客人订",
    category: "work",
    icon: "📦",
    level: "B1",
    summaryZh: "客人要的东西货架上没有：去仓库找、说明没货，提出调货或预订，问联系方式。",
    lines: [
      L("Customer", MAN_2, "Hi, I'm looking for these sneakers in size 27.", "你好，我在找这双运动鞋的 27 码。"),
      L("Clerk", ME, "Let me check in the back for you. One moment, please.", "我去仓库帮您看一下，请稍等。"),
      L("Clerk", ME, "Sorry for the wait. I'm afraid we're out of size 27 right now.", "让您久等了。不好意思，27 码现在没货了。"),
      L("Customer", MAN_2, "Oh, no. When will you get more in?", "啊，不会吧。什么时候到货？"),
      L("Clerk", ME, "We're expecting a delivery next Wednesday.", "我们预计下周三到货。"),
      L("Clerk", ME, "Or I can check if our Shibuya store has them.", "或者我可以帮您查一下涩谷店有没有。"),
      L("Customer", MAN_2, "I'm leaving Japan on Tuesday, so could you check Shibuya?", "我周二就离开日本了，能帮我查一下涩谷店吗？"),
      L("Clerk", ME, "Sure. They have two pairs. Shall I ask them to hold one for you?", "好的。那边还有两双。要我请他们给您留一双吗？"),
      L("Customer", MAN_2, "That would be great. Thank you so much.", "那太好了，非常感谢。"),
      L("Clerk", ME, "No problem. Could I have your name, please?", "不客气。请问您贵姓？"),
    ],
    talk: {
      aiRole: "a customer from Singapore looking for one item in a certain size (in a hurry, polite)",
      aiVoice: MAN_2,
      userRole: "a sales clerk at a shoe and sports shop",
      goalZh: "客人要的尺码没货：说去仓库看、请他稍等，说明没货和到货时间，提出其他店调货或预订，问他的名字和联系方式。",
      setup:
        "A customer is looking for a pair of shoes in his size. It isn't on the shelf. When the learner checks, it is out of stock until next week. He is only in Japan for a few more days, so they work out another way (another store, ordering and shipping, another colour).",
      opening: { ja: "Excuse me, do you have these in a 26.5?", zh: "打扰一下，这双有 26.5 码的吗？" },
    },
  },
  {
    id: "taxfree",
    title: "Tax-free shopping",
    titleZh: "给游客办免税",
    category: "work",
    icon: "🛂",
    level: "B1",
    summaryZh: "游客问能不能免税：说明金额条件、要护照、免税品不能在日本国内拆开用。",
    lines: [
      L("Customer", HD_WOMAN_POLITE, "Can I get this tax-free?", "这个能免税吗？"),
      L("Clerk", ME, "Yes, if you spend over 5,000 yen. Your total is 8,800 yen, so that's fine.", "可以，满 5000 日元就行。您一共 8800 日元，没问题。"),
      L("Clerk", ME, "May I see your passport, please?", "可以看一下您的护照吗？"),
      L("Customer", HD_WOMAN_POLITE, "Here you are.", "给你。"),
      L("Clerk", ME, "Thank you. Your total comes to 8,000 yen without tax.", "谢谢。免税后一共 8000 日元。"),
      L("Clerk", ME, "Please note that you can't open this bag until you leave Japan.", "请注意，离开日本之前不能打开这个袋子。"),
      L("Customer", HD_WOMAN_POLITE, "Oh, I see. What if I open it by mistake?", "哦，明白了。如果不小心打开了怎么办？"),
      L("Clerk", ME, "You may have to pay the tax at the airport.", "在机场可能就要补交税了。"),
      L("Customer", HD_WOMAN_POLITE, "Okay, I'll be careful. Thanks for explaining.", "好的，我会小心的。谢谢你的说明。"),
    ],
    talk: {
      aiRole: "a tourist from Hong Kong who wants tax-free shopping (doesn't know the rules well)",
      aiVoice: HD_WOMAN_POLITE,
      userRole: "a sales clerk at the register of a cosmetics and gift shop",
      goalZh: "说明免税条件（满 5000 日元、需要护照、消耗品要封袋、出境前不能打开），算出免税后的金额，回答客人的问题。",
      setup:
        "A tourist at the register asks about tax-free shopping. At first her total is a little under 5,000 yen, so she adds something. She doesn't have her passport with her at first (it's in her bag after all), and asks whether she can use the cosmetics in her hotel.",
      opening: { ja: "Hi, is this shop tax-free? I'm a tourist.", zh: "你好，这家店能免税吗？我是游客。" },
    },
  },
  {
    id: "register",
    title: "At the register",
    titleZh: "收银：付款、袋子、小票",
    category: "work",
    icon: "💳",
    level: "A2",
    summaryZh: "收银台：问要不要袋子、怎么付钱、刷卡要签名或输密码，找零和小票。",
    lines: [
      L("Clerk", ME, "Hi. Did you find everything you were looking for?", "您好。要找的东西都找到了吗？"),
      L("Customer", MAN_3, "Yes, thanks.", "找到了，谢谢。"),
      L("Clerk", ME, "That'll be 4,350 yen. Would you like a bag? It's 5 yen.", "一共 4350 日元。要袋子吗？袋子 5 日元。"),
      L("Customer", MAN_3, "No, I'm fine. Can I pay by card?", "不用了。可以刷卡吗？"),
      L("Clerk", ME, "Sure. Please insert your card here.", "可以。请把卡插在这里。"),
      L("Clerk", ME, "Could you enter your PIN, please?", "请输入密码。"),
      L("Customer", MAN_3, "Okay. Done.", "好了。"),
      L("Clerk", ME, "Thank you. Here's your card and your receipt.", "谢谢。这是您的卡和小票。"),
      L("Customer", MAN_3, "Thanks a lot.", "非常感谢。"),
      L("Clerk", ME, "Thank you. Have a nice day!", "谢谢惠顾，祝您愉快！"),
    ],
    talk: {
      aiRole: "a customer from the UK paying at the register (casual, chatty)",
      aiVoice: MAN_3,
      userRole: "a cashier",
      goalZh: "收银全过程：说金额、问要不要袋子、问付款方式（现金、刷卡、交通卡）、找零、给小票，最后道别。",
      setup:
        "A customer comes to the register with three items. He asks for a bag, wants to pay part in cash and part by card at first (the shop can't do that, so he decides), and asks for a gift receipt for one item. He makes a little small talk about the weather.",
      opening: { ja: "Hi, just these, please.", zh: "你好，就这些。" },
    },
  },
  {
    id: "return",
    title: "A return or an exchange",
    titleZh: "处理退货和换货",
    category: "work",
    icon: "🔄",
    level: "B1",
    summaryZh: "客人拿东西来退：问原因、要小票、说明能换不能退，帮他换一个。",
    lines: [
      L("Customer", HD_MAN_CALM, "Hi, I bought this sweater yesterday, but it's too small. Can I return it?", "你好，我昨天买了这件毛衣，但是太小了。可以退吗？"),
      L("Clerk", ME, "I'm sorry about that. Do you have the receipt?", "很抱歉。您有小票吗？"),
      L("Customer", HD_MAN_CALM, "Yes, here it is.", "有，在这儿。"),
      L("Clerk", ME, "Thank you. I'm afraid we can't give refunds on sale items.", "谢谢。不好意思，打折商品不能退款。"),
      L("Clerk", ME, "But we can exchange it for a different size.", "不过可以换一个尺码。"),
      L("Customer", HD_MAN_CALM, "Oh, okay. Do you have it in a large?", "哦，好吧。有大号的吗？"),
      L("Clerk", ME, "Yes, we do. Would you like to try it on first?", "有的。要不要先试穿一下？"),
      L("Customer", HD_MAN_CALM, "Sure, that's a good idea.", "好啊，这样比较好。"),
      L("Clerk", ME, "The fitting room is right there. Take your time.", "试衣间就在那边，您慢慢来。"),
    ],
    talk: {
      aiRole: "a customer who wants to return something he bought (a bit disappointed, but reasonable)",
      aiVoice: HD_MAN_CALM,
      userRole: "a sales clerk",
      goalZh: "客人要退货：先道歉，问原因，要小票，说明规则（7 天内、不能拆包装、打折品只能换），帮他换或退。",
      setup:
        "A customer brings back a bag he bought four days ago. He says the zip is a bit stiff. He has the receipt. The shop's rule: returns within 7 days with the receipt; he can choose a refund or an exchange. He asks what other bags there are.",
      opening: { ja: "Hi, um, I bought this bag here a few days ago, and there's a problem with it.", zh: "你好，嗯，我前几天在这儿买了这个包，有点问题。" },
    },
  },
];

// The shop floor first, then more work scenes and everyday life.
export const scenarios: Scenario[] = [...firstScenes, ...workScenes, ...lifeScenes];

export function getScenario(id: string) {
  return scenarios.find((s) => s.id === id);
}
