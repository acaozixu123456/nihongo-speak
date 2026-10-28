import { VOICE_LIBRARY } from "@/lib/voice-library";
import { voiceKey } from "@/lib/voice-key";

// Fixed content was recorded ahead of time (scripts/bake-voices.ts) and ships with the site, so
// it keeps its HD voice and plays without Azure. Anything else is synthesized on demand.
// Used on the server too: lib/kokoro.ts asks for the day's lines ahead at the very same address.
export function ttsUrl(text: string, voice: string) {
  const key = voiceKey(text, voice);
  if (VOICE_LIBRARY.has(key)) return `/voice/${key}.mp3`;
  // v=2 skips anything the browser kept from before fallback voices were marked no-store.
  // yomi=1: text with no kana used to be read in Chinese (the server now says its reading instead),
  // so it gets a new address instead of the copy the phone and the CDN kept. yomi=2: that reading
  // often didn't come back, so many such words were still kept read in Chinese. yomi=3: a wrong
  // reading (木炭 as たんざん) could be kept too.
  const kanjiOnly = voice.startsWith("ja-JP") && !/[぀-ヵヷ-ヺヽ-ヿ]/.test(text);
  return `/api/tts?${new URLSearchParams({ text, voice, v: "2", ...(kanjiOnly ? { yomi: "3" } : {}) })}`;
}
