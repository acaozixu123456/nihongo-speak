import type { Scenario } from "./scenarios";

// Phone calls: voice only, no faces and (by default) no subtitles.
// They reuse the role-play API with the talk settings sent from the client.

export type Call = {
  id: string;
  title: string;
  titleZh: string;
  who: string; // shown as the caller / callee name
  incoming: boolean; // the other side calls the learner
  person?: string; // a recurring character (below), who remembers earlier calls
  talk: Scenario["talk"];
};

// The people the learner keeps talking to. Each has a fixed personality and way of speaking, and
// is told what came up in earlier calls (lib/client/progress.ts remember), so the calls feel like
// one relationship rather than a fresh stranger every time.
export type Person = { id: string; name: string; persona: string };

export const people: Person[] = [
  {
    id: "yamada",
    name: "Mr. Davis",
    persona: `Mr. Davis (45, the learner's store manager). Kind to his staff, keeps things short, always checks the shift and the to-dos. Loves hiking and often talks about his weekend. Doesn't mind the learner's English mistakes and just answers if he gets the meaning. Way of talking: friendly and clear, "Okay, got it", "No problem", "Let's see".`,
  },
  {
    id: "tanaka",
    name: "Mrs. Brown",
    persona: `Mrs. Brown (62, a regular customer from Canada who lives nearby). Polite and warm, a little chatty, remembers what she was told before and calls the learner by name. Way of talking: polite but relaxed, "Oh, how lovely", "Would you mind...?".`,
  },
  {
    id: "yui",
    name: "Emily",
    persona: `Emily (29, an Australian friend the learner met at a language exchange, works in an office). Cheerful and chatty, loves cafés and travel. Often asks about the learner's life. Way of talking: casual ("Hey!", "No worries", "That's awesome", "Wanna...?"). Doesn't mind if the learner is formal.`,
  },
  {
    id: "sato",
    name: "Lucy",
    persona: `Lucy (31, a coworker at the same shop, from the Philippines). Good at asking favours and always says thank you. Likes games and talking about lunch. Way of talking: friendly coworker English ("Hey, quick question", "Could you possibly...?", "You're a lifesaver!").`,
  },
];

export const findPerson = (id?: string) => people.find((p) => p.id === id);

// A point the learner keeps getting wrong. The other side uses it in their own lines first, so the learner
// hears it and tends to reuse it in their answer (structural priming), without anyone correcting them.
export type Prime = { tag: string; pattern?: string; better?: string };

export function primeRule(prime?: Prime | null) {
  if (!prime) return "";
  const form = prime.pattern ? `${prime.tag} (${prime.pattern})` : prime.tag;
  return `\n\n[Quiet practice in this conversation (don't tell the learner)] The learner often gets "${form}" wrong${prime.better ? ` (right example: ${prime.better})` : ""}.
- From your next line, use this form naturally. At most once per line, 2-3 times in the whole conversation, with different verbs or words each time.
- When you use it, follow with a question that makes her want to answer with the same form.
- Don't explain it, push her to say it, or correct her.`;
}

// What the learner heard on today's radio, so the call gives them a reason to use it (transfer).
export type TodayTopic = { title: string; phrases: string[] };

export function topicRule(today?: TodayTopic | null) {
  if (!today) return "";
  const phrases = today.phrases.length ? `\n- Ask questions where she could use these expressions: ${today.phrases.map((x) => `"${x}"`).join(", ")}.` : "";
  return `\n\n[Today's topic (don't tell the learner)] Today the learner heard about "${today.title}" on the radio.
- Once, in the middle or at the end of the call, bring the topic up naturally yourself ("Oh, by the way, did you know...?"). Let her tell you about it.${phrases}
- Don't push her to say it or correct her.`;
}

// The call's role-play settings with the character's personality, what they remember, the point to prime
// and, for the people the learner knows, today's radio topic.
export function callTalk(
  call: Pick<Call, "person" | "talk">,
  memories: { date: string; ja: string }[],
  prime?: Prime | null,
  today?: TodayTopic | null,
): Scenario["talk"] {
  const person = findPerson(call.person);
  const primed = primeRule(prime) + (person ? topicRule(today) : "");
  if (!person) return { ...call.talk, setup: `${call.talk.setup}${primed}` };
  const recall = memories.length
    ? `\n\nWhat you know from earlier calls (oldest first):\n${memories.map((m) => `- ${m.date}: ${m.ja}`).join("\n")}\nEarly in the call, mention one of these naturally (so she feels remembered). Don't keep coming back to it.`
    : "";
  return { ...call.talk, aiRole: `${person.persona}\nYour part this time: ${call.talk.aiRole}`, setup: `${call.talk.setup}${recall}${primed}` };
}

// Each recurring character's phone voice.
export const personVoice = (id?: string) => calls.find((c) => c.person === id)?.talk.aiVoice;

const RECEPTION = "en-US-Emma:DragonHDLatestNeural|en-US-JennyNeural@customerservice";
const MAN = "en-US-Andrew:DragonHDLatestNeural|en-US-AndrewNeural";
const MANAGER = "en-US-Brian:DragonHDLatestNeural|en-US-BrianNeural";
const FRIEND = "en-US-Ava:DragonHDLatestNeural|en-US-AvaNeural";
const COLLEAGUE = "en-US-AriaNeural";
const REGULAR = "en-US-JennyNeural";

export const PHONE = `This is a phone call. Neither side can see the other.
Talk the way people do on the phone: short turns (1-2 sentences), repeat names, dates and numbers back to confirm them.
If the learner asks you to repeat (Sorry, could you say that again?) or goes quiet, say it again a little slower, in other words.
When the business is done, close the call naturally (Thanks for calling, bye now).`;

export const calls: Call[] = [
  {
    id: "stock",
    title: "A customer asks about stock",
    titleZh: "熟客打电话问有没有货",
    who: "Mrs. Brown",
    incoming: true,
    person: "tanaka",
    talk: {
      aiRole: "Mrs. Brown, calling the shop",
      aiVoice: REGULAR,
      userRole: "a sales clerk who answered the shop phone",
      goalZh: "接起店里的电话，听清客人要找的商品（灰色羊毛围巾），请她稍等去确认，告诉她还剩一条，帮她留到明天。",
      setup: `${PHONE}
Mrs. Brown calls the shop where the learner works. She is looking for the grey wool scarf she saw last week. If the learner asks her to hold, she waits. There is one left. She asks if the shop can keep it for her until tomorrow afternoon, and gives her name and phone number (080-1234-5678) if asked.`,
      opening: { ja: "Hello, is this the shop near the station? I was in last week and saw a scarf I liked.", zh: "喂，是车站旁边那家店吗？我上周去过，看到一条很喜欢的围巾。" },
    },
  },
  {
    id: "clinic",
    title: "Booking a doctor's appointment",
    titleZh: "打电话预约看病",
    who: "Sakura Clinic",
    incoming: false,
    talk: {
      aiRole: "the receptionist at Sakura Clinic, an English-speaking clinic (polite)",
      aiVoice: RECEPTION,
      userRole: "a patient who wants to see a doctor for the first time",
      goalZh: "说明症状（发烧、喉咙痛），约明天下午看病，确认时间和要带的东西。",
      setup: `${PHONE}
The learner calls the clinic to book an appointment. The receptionist asks in turn about her symptoms, whether it is her first visit, her name, phone number and the time she would like, suggests a free slot, and tells her to bring her health insurance card.`,
      opening: { ja: "Good morning, Sakura Clinic. How can I help you?", zh: "早上好，这里是樱花诊所。有什么可以帮您？" },
    },
  },
  {
    id: "restaurant",
    title: "Booking a table",
    titleZh: "打电话订餐厅",
    who: "Luigi's Trattoria",
    incoming: false,
    talk: {
      aiRole: "a staff member at an Italian restaurant (bright and polite)",
      aiVoice: MAN,
      userRole: "someone booking a dinner for the shop's farewell party",
      goalZh: "订本周五晚上 7 点 6 个人，问有没有包间，说一个人对虾过敏。",
      setup: `${PHONE}
The learner calls a restaurant to make a booking. The staff member confirms the day, time and number of people, says a private room is free only from 7:30 (the learner decides what to do), asks about a set menu or ordering à la carte, and asks for her name and phone number.`,
      opening: { ja: "Good afternoon, Luigi's Trattoria, this is Marco speaking.", zh: "下午好，这里是路易吉餐厅，我是马可。" },
    },
  },
  {
    id: "hotel",
    title: "Changing a hotel booking",
    titleZh: "打电话改酒店预订",
    who: "Harbor View Hotel",
    incoming: false,
    talk: {
      aiRole: "a front desk clerk at a hotel in Singapore (polite)",
      aiVoice: RECEPTION,
      userRole: "a guest who booked a room for a holiday",
      goalZh: "说明你订了下个月的房间，想晚一天入住、多住一晚，问清价格和早餐。",
      setup: `${PHONE}
The learner booked a double room for three nights next month and wants to arrive one day later and stay one night longer. The clerk asks for her booking number (she may give her name instead), checks, says the extra night costs a little more, and asks if she wants breakfast added.`,
      opening: { ja: "Thank you for calling Harbor View Hotel. How may I help you today?", zh: "感谢致电海景酒店。今天有什么可以帮您？" },
    },
  },
  {
    id: "sick",
    title: "Calling in sick",
    titleZh: "早上打给店长请病假",
    who: "Mr. Davis",
    incoming: false,
    person: "yamada",
    talk: {
      aiRole: "Mr. Davis (kind to his staff, but checks the shift)",
      aiVoice: MANAGER,
      userRole: "a sales clerk with a fever who needs the day off",
      goalZh: "说发烧了今天想请假，交代今天要做的事（中午到货要上架），说明天的打算。",
      setup: `${PHONE}
At 8:30 in the morning the learner calls the store manager. He asks how she is, and what to do about today's work (a delivery arriving at noon that needs to go on the shelves, a customer coming to pick up an order).`,
      opening: { ja: "Hello, Davis speaking.", zh: "喂，我是戴维斯。" },
    },
  },
  {
    id: "late",
    title: "Running late",
    titleZh: "电车晚点，打给店长说要迟到",
    who: "Mr. Davis",
    incoming: false,
    person: "yamada",
    talk: {
      aiRole: "Mr. Davis",
      aiVoice: MANAGER,
      userRole: "a sales clerk whose train has stopped",
      goalZh: "说电车因为事故停了，大概晚 30 分钟到，问开店准备怎么办。",
      setup: `${PHONE}
At 9:40, twenty minutes before the shop opens, the learner calls the store manager from the station platform. He asks which line, and when she thinks she'll get there, says he'll open up and she can join when she arrives, and reminds her to get a delay certificate at the station.`,
      opening: { ja: "Hey, Davis here. What's up?", zh: "喂，我是戴维斯。怎么了？" },
    },
  },
  {
    id: "weekend",
    title: "Weekend plans",
    titleZh: "朋友打来约周末",
    who: "Emily",
    incoming: true,
    person: "yui",
    talk: {
      aiRole: "Emily",
      aiVoice: FRIEND,
      userRole: "Emily's friend (Chinese, working in a shop in Japan)",
      goalZh: "回答周末有没有空，一起定个时间和地方（她想去新开的咖啡店），说说你最近在忙什么。",
      setup: `${PHONE}
On Friday evening Emily calls the learner and asks if she wants to go to a new café together at the weekend. They decide Saturday or Sunday, what time and which station to meet at. She also asks how the learner has been (work, days off). Casual, like friends.`,
      opening: { ja: "Hey! It's Emily. Got a minute?", zh: "嘿！我是艾米丽。现在有空吗？" },
    },
  },
  {
    id: "cover",
    title: "A favour from a coworker",
    titleZh: "同事打来请你帮忙换班",
    who: "Lucy",
    incoming: true,
    person: "sato",
    talk: {
      aiRole: "Lucy",
      aiVoice: COLLEAGUE,
      userRole: "Lucy's coworker at the shop",
      goalZh: "听清她要你帮什么（这周六替她上早班），说你能不能替、换哪天给你，商量好。",
      setup: `${PHONE}
In the evening Lucy calls. Something came up and she can't work this Saturday's morning shift (10 to 3). She asks if the learner can swap with her, and offers to take the learner's Tuesday afternoon shift in return. If the learner can't, they look for another way together.`,
      opening: { ja: "Hey, it's Lucy. Sorry to call so late. Do you have a sec?", zh: "嘿，我是露西。这么晚打电话不好意思。你有空吗？" },
    },
  },
];

export const findCall = (id: string) => calls.find((c) => c.id === id);
