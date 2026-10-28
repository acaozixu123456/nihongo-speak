import "server-only";
import { BlobNotFoundError, get, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { dayKey } from "@/lib/progress-model";
import { storageReady } from "@/lib/store";

// The site has no login, so anyone who finds a paid route could run it in a loop. Each costly kind
// of request gets a daily allowance well above what one learner uses (counted in Blob, per JST day),
// so a script can't run up more than a few dollars before tomorrow.
export const DAILY = {
  radio: 10, // 趣味电台 episodes (Gemini / Haiku script)
  script: 10, // 摸鱼模式 podcast scripts
  earworm: 6, // new 洗脑歌 (~$0.6 each)
  cover: 10, // cover pictures (~$0.07 each)
  scenario: 15, // 重来一次 scenarios
  kokoro: 6, // 心で答える question sets (Opus)
} as const;
export type Kind = keyof typeof DAILY;

// Counts one more of this kind today; false once today's allowance is used up. Two requests at
// the same moment can both count as one, which is fine for a ceiling this loose.
export async function spend(kind: Kind): Promise<boolean> {
  if (!storageReady()) return true;
  const path = `quota/${dayKey(new Date(Date.now() + 9 * 3600_000 + new Date().getTimezoneOffset() * 60_000))}.json`;
  try {
    const res = await get(path, { access: "private", useCache: false }).catch((e: unknown) => {
      if (e instanceof BlobNotFoundError) return null;
      throw e;
    });
    const used = (res?.statusCode === 200 ? await new Response(res.stream).json() : {}) as Partial<Record<Kind, number>>;
    const n = used[kind] ?? 0;
    if (n >= DAILY[kind]) return false;
    await put(path, JSON.stringify({ ...used, [kind]: n + 1 }), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  } catch (e) {
    // The count failing shouldn't stop the learner's own request.
    console.warn("quota", e);
  }
  return true;
}

export const tooMany = () => NextResponse.json({ error: "今天的生成次数用完了，明天再来" }, { status: 429 });

// Rough per-instance ceiling for requests too frequent to count in Blob (speech): at most `n` in
// any `ms` window on one server instance.
const windows = new Map<string, number[]>();
export function burst(key: string, n: number, ms: number): boolean {
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter((t) => now - t < ms);
  if (recent.length >= n) return false;
  recent.push(now);
  windows.set(key, recent);
  return true;
}
