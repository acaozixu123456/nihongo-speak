// While recording: how long the learner has been quiet, read from the microphone a few times a second
// (the same voice gate as fluency.ts, from the levels heard so far). Nothing is sent anywhere.

const TICK_MS = 100;

// Calls back each tick with the seconds of quiet since the learner last spoke (0 while speaking, and
// before they have said anything at all). Returns the function that stops listening.
export function watchQuiet(stream: MediaStream, onTick: (quiet: number) => void): () => void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  const levels: number[] = [];
  let spoke = false;
  let lastVoice = 0;
  const id = window.setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let e = 0;
    for (const x of buf) e += x * x;
    // On the same scale as fluency.ts (16-bit samples).
    const level = Math.sqrt(e / buf.length) * 32768;
    levels.push(level);
    if (levels.length > 300) levels.shift();
    const sorted = [...levels].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)];
    const loud = sorted[Math.floor(sorted.length * 0.95)];
    // Capped by the loud level, so a learner who starts talking at once (no quiet heard yet to set
    // the floor) still counts as speaking.
    const gate = Math.min(Math.max(floor * 3, floor + (loud - floor) * 0.12, 150), Math.max(150, loud * 0.3));
    const now = performance.now();
    if (level > gate && levels.length > 5) {
      spoke = true;
      lastVoice = now;
    }
    onTick(spoke ? (now - lastVoice) / 1000 : 0);
  }, TICK_MS);
  ctx.resume().catch(() => {});
  return () => {
    clearInterval(id);
    src.disconnect();
    ctx.close().catch(() => {});
  };
}
