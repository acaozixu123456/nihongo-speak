// The file name of a pre-made recording: a hash of the sentence and the voice list it's played with.
// Used in the browser (sync, so ttsUrl can stay sync) and by scripts/bake-voices.ts.
export function voiceKey(text: string, voice: string) {
  const s = `${voice}\n${text}`;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
