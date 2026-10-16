import { createSign } from "node:crypto";
import { FLASH, audio, request, type Reply } from "@/lib/gemini-tts";

// The same Gemini voices through Vertex AI, billed to the Google Cloud account (its $300 trial
// credit) instead of the Gemini API, with its own quota. /api/tts tries it first, before the
// Gemini API. Signs in with VERTEX_SERVICE_ACCOUNT, the service account's JSON key
// (as is or base64); Vertex turns plain API keys away.
const HOST = "https://aiplatform.googleapis.com/v1";

type Account = { client_email: string; private_key: string; project_id: string };

function account(): Account | null {
  const raw = process.env.VERTEX_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  return JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
}

export const vertexConfigured = () => Boolean(process.env.VERTEX_SERVICE_ACCOUNT);

let cached: { token: string; until: number } | null = null;

// Trades a signed JWT for an hour-long access token, kept until a minute before it runs out.
async function token(a: Account) {
  if (cached && cached.until > Date.now()) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: a.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(a.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`Vertex auth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: access_token, until: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

// The TTS models only run in the "global" location.
export async function synthesizeVertex(text: string, voice: string, timeoutMs = 15000, model = FLASH) {
  const a = account();
  if (!a) throw new Error("VERTEX_SERVICE_ACCOUNT is not set");
  const url = `${HOST}/projects/${a.project_id}/locations/global/publishers/google/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(a)}` },
    // Vertex wants the speaker's role spelled out.
    body: JSON.stringify({ ...request(text, voice), contents: [{ role: "user", parts: [{ text }] }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Vertex TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return audio((await res.json()) as Reply, voice);
}
