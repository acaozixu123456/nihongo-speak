// The Chinese voice and fixed lines of 摸鱼模式 (lib/client/moyu.ts). They live here so
// scripts/bake-voices.ts can record them ahead of time along with the scenes.
export const ZH_VOICE = "zh-CN-XiaoxiaoNeural";

export const NARRATION = {
  quick: "心里瞬间说。听到中文，先在心里说英语。",
  review: "复习今天到期的收藏。",
  lines: "再一句一句听。",
  said: "你当时说的是：",
  better: "更自然的说法是：",
  radioKeep: "今天这期里，记住这几句。",
};

export const listenIntro = (titleZh: string) => `偷听：${titleZh}。先听一遍整段。`;
