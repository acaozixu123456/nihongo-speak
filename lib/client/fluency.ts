// How a telling flowed, from the recording itself (no speech service needed): where the voice is,
// how long the stretch from first to last word was, and how many silences of a second or more there
// were inside it. Long pauses are the measure that keeps moving as fluency develops; speed is counted
// in morae over the spoken stretch, so silence before the first word and after the last doesn't count.

const FRAME_S = 0.02;
const LONG_PAUSE_S = 1;

export type Flow = { span: number; pauses: number };

export async function flowOf(wav: Blob): Promise<Flow> {
  const bytes = await wav.arrayBuffer();
  const v = new DataView(bytes);
  // The samples start after the "data" chunk header (byte 44 in our own recordings).
  let at = 12;
  while (at + 8 <= bytes.byteLength && v.getUint32(at) !== 0x64617461) at += 8 + v.getUint32(at + 4, true);
  const start = Math.min(at + 8, bytes.byteLength);
  const pcm = new Int16Array(bytes.slice(start, bytes.byteLength - ((bytes.byteLength - start) % 2)));
  const rate = v.getUint32(24, true) || 16000;
  const n = Math.floor(rate * FRAME_S);
  const energy: number[] = [];
  for (let i = 0; i + n <= pcm.length; i += n) {
    let e = 0;
    for (let j = i; j < i + n; j++) e += pcm[j] * pcm[j];
    energy.push(Math.sqrt(e / n));
  }
  if (!energy.length) return { span: 0, pauses: 0 };
  // Voice is well above the room's own level: the quiet tenth of the frames sets the floor.
  const sorted = [...energy].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const loud = sorted[Math.floor(sorted.length * 0.95)];
  const gate = Math.max(floor * 3, floor + (loud - floor) * 0.12, 150);
  const voiced = energy.map((e) => e > gate);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return { span: 0, pauses: 0 };
  let pauses = 0;
  let quiet = 0;
  for (let i = first; i <= last; i++) {
    if (voiced[i]) {
      if (quiet * FRAME_S >= LONG_PAUSE_S) pauses++;
      quiet = 0;
    } else quiet++;
  }
  return { span: (last - first + 1) * FRAME_S, pauses };
}

// Morae in a kana reading: every kana is one, except the small ゃゅょ-type ones that join the kana
// before them (っ and ー each count as one).
export function morae(kana: string) {
  return [...kana.replace(/[^぀-ヿ]/g, "")].filter((c) => !"ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ・".includes(c)).length;
}

// Readings only count when they look like readings: kana, and about as long as the text they read.
export function moraRate(text: string, kana: string | undefined, span: number): number | undefined {
  if (!kana || span < 5) return undefined;
  const m = morae(kana);
  const plain = text.replace(/[\s、。，,.!！?？「」…]/g, "").length;
  if (m < plain * 0.8 || m > plain * 3) return undefined;
  return Math.round((m / span) * 10) / 10;
}
