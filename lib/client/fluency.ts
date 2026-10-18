// How a telling flowed, from the recording itself (no speech service needed): where the voice is,
// how long the stretch from first to last word was, and how many silences of a second or more there
// were inside it. Long pauses are the measure that keeps moving as fluency develops; speed is counted
// in morae over the spoken stretch, so silence before the first word and after the last doesn't count.

const FRAME_S = 0.02;
const LONG_PAUSE_S = 1;
// Kept around each stretch of speech when it is cut out, so first and last sounds aren't clipped.
const PAD_S = 0.15;

// runs: the stretches of speech between those silences, in seconds from the start of the recording;
// gaps[i]: how long the silence after runs[i] lasted.
export type Flow = { span: number; pauses: number; runs: [number, number][]; gaps: number[] };

type Pcm = { pcm: Int16Array; rate: number };

async function pcmOf(wav: Blob): Promise<Pcm> {
  const bytes = await wav.arrayBuffer();
  const v = new DataView(bytes);
  // The samples start after the "data" chunk header (byte 44 in our own recordings).
  let at = 12;
  while (at + 8 <= bytes.byteLength && v.getUint32(at) !== 0x64617461) at += 8 + v.getUint32(at + 4, true);
  const start = Math.min(at + 8, bytes.byteLength);
  const pcm = new Int16Array(bytes.slice(start, bytes.byteLength - ((bytes.byteLength - start) % 2)));
  return { pcm, rate: v.getUint32(24, true) || 16000 };
}

export async function flowOf(wav: Blob): Promise<Flow> {
  const { pcm, rate } = await pcmOf(wav);
  const n = Math.floor(rate * FRAME_S);
  const energy: number[] = [];
  for (let i = 0; i + n <= pcm.length; i += n) {
    let e = 0;
    for (let j = i; j < i + n; j++) e += pcm[j] * pcm[j];
    energy.push(Math.sqrt(e / n));
  }
  const none: Flow = { span: 0, pauses: 0, runs: [], gaps: [] };
  if (!energy.length) return none;
  // Voice is well above the room's own level: the quiet tenth of the frames sets the floor.
  const sorted = [...energy].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const loud = sorted[Math.floor(sorted.length * 0.95)];
  const gate = Math.max(floor * 3, floor + (loud - floor) * 0.12, 150);
  const voiced = energy.map((e) => e > gate);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) return none;
  const runs: [number, number][] = [];
  const gaps: number[] = [];
  let from = first;
  let quiet = 0;
  for (let i = first; i <= last; i++) {
    if (voiced[i]) {
      if (quiet * FRAME_S >= LONG_PAUSE_S) {
        runs.push([from * FRAME_S, (i - quiet) * FRAME_S]);
        gaps.push(quiet * FRAME_S);
        from = i;
      }
      quiet = 0;
    } else quiet++;
  }
  runs.push([from * FRAME_S, (last + 1) * FRAME_S]);
  return { span: (last - first + 1) * FRAME_S, pauses: gaps.length, runs, gaps };
}

// Each stretch of speech as a small MP3 (base64), for the speech model to write down one by one, so
// what was said on each side of every long silence is known.
export async function runClips(wav: Blob, runs: [number, number][]): Promise<string[]> {
  const { pcm, rate } = await pcmOf(wav);
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  return runs.map(([a, b]) => {
    const part = pcm.subarray(Math.max(0, Math.floor((a - PAD_S) * rate)), Math.min(pcm.length, Math.ceil((b + PAD_S) * rate)));
    const enc = new Mp3Encoder(1, rate, 32);
    const out: number[] = [];
    // lamejs hands back Int8Arrays despite its types.
    const add = (x: ArrayBufferView) => out.push(...new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    for (let i = 0; i < part.length; i += 1152 * 10) add(enc.encodeBuffer(part.subarray(i, i + 1152 * 10)));
    add(enc.flush());
    let bin = "";
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.slice(i, i + 0x8000));
    return btoa(bin);
  });
}

// A piece of the recording as its own WAV, to play back where the learner got stuck.
export async function wavSlice(wav: Blob, from: number, to: number): Promise<Blob> {
  const { pcm, rate } = await pcmOf(wav);
  const part = pcm.slice(Math.max(0, Math.floor(from * rate)), Math.min(pcm.length, Math.ceil(to * rate)));
  const head = new DataView(new ArrayBuffer(44));
  const str = (o: number, t: string) => [...t].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  head.setUint32(4, 36 + part.byteLength, true);
  str(8, "WAVEfmt ");
  head.setUint32(16, 16, true);
  head.setUint16(20, 1, true);
  head.setUint16(22, 1, true);
  head.setUint32(24, rate, true);
  head.setUint32(28, rate * 2, true);
  head.setUint16(32, 2, true);
  head.setUint16(34, 16, true);
  str(36, "data");
  head.setUint32(40, part.byteLength, true);
  return new Blob([head.buffer, part.buffer as ArrayBuffer], { type: "audio/wav" });
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
