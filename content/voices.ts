// Azure voices, tried in order (see lib/azure.ts). The HD voices sound the most like real conversation;
// the standard voices after "|" are the free fallback. Gemini (lib/gemini-tts.ts) speaks for most of
// them in the end; the names here pick its voice.
export const HD_MAN = "en-US-Andrew:DragonHDLatestNeural|en-US-AndrewNeural";
export const HD_MAN_CALM = "en-US-Brian:DragonHDLatestNeural|en-US-BrianNeural";
export const HD_WOMAN = "en-US-Ava:DragonHDLatestNeural|en-US-AvaNeural";
export const HD_WOMAN_POLITE = "en-US-Emma:DragonHDLatestNeural|en-US-JennyNeural@customerservice";
export const MAN_2 = "en-US-GuyNeural";
export const MAN_3 = "en-US-DavisNeural";
export const WOMAN_2 = "en-US-JennyNeural";
export const WOMAN_3 = "en-US-AriaNeural";
