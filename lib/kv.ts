import "server-only";

// Everything the server keeps lives in one Upstash Redis database (Vercel Marketplace, free plan),
// reached over its REST API. It replaced Vercel Blob, whose Hobby allowance (2K writes a month)
// ran out and suspended the store. Redis free: 500K commands a month, 256 MB.

const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const kvReady = () => !!(url() && token());

async function call<T>(command: (string | number)[]): Promise<T> {
  const res = await fetch(url(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || body.error) throw new Error(`redis ${command[0]} ${res.status}: ${body.error ?? ""}`);
  return body.result as T;
}

// null only when the key isn't there; any other failure throws, so it is never mistaken for empty.
export async function getJson<T>(key: string): Promise<T | null> {
  const s = await call<string | null>(["GET", key]);
  return s == null ? null : (JSON.parse(s) as T);
}

// days: the key goes away by itself after that many days.
export async function setJson(key: string, data: unknown, days?: number) {
  await call(["SET", key, JSON.stringify(data), ...(days ? ["EX", Math.round(days * 86400)] : [])]);
}

export async function getBytes(key: string): Promise<Buffer | null> {
  const s = await call<string | null>(["GET", key]);
  return s == null ? null : Buffer.from(s, "base64");
}

export async function setBytes(key: string, body: Buffer | ArrayBuffer, days?: number) {
  const b64 = Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body).toString("base64");
  await call(["SET", key, b64, ...(days ? ["EX", Math.round(days * 86400)] : [])]);
}

export async function incr(key: string, days: number) {
  const n = await call<number>(["INCR", key]);
  if (n === 1) await call(["EXPIRE", key, Math.round(days * 86400)]);
  return n;
}

export async function decr(key: string) {
  return call<number>(["DECR", key]);
}

export async function delKeys(keys: string[]) {
  if (keys.length) await call(["DEL", ...keys]);
}
