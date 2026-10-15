import "server-only";
import { get, put } from "@vercel/blob";
import { merge, normalize, type Progress } from "@/lib/progress-model";
import type { PushSubscription } from "web-push";

// One private JSON file in Vercel Blob holds everything the server keeps.
// Connected stores authenticate with Vercel OIDC + BLOB_STORE_ID (or an older read-write token).
// Without either the app still works, just without sync or reminders.

export type Slot = "noon" | "evening";

export type State = {
  progress: Progress;
  push?: { subscription: PushSubscription; slots: Slot[]; lastSent?: Partial<Record<Slot, string>> };
};

const PATH = "state.json";

export const storageReady = () => !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);

export async function readState(): Promise<State> {
  const res = await get(PATH, { access: "private", useCache: false }).catch(() => null);
  if (!res || res.statusCode !== 200) return { progress: normalize(null) };
  const data = (await new Response(res.stream).json()) as State;
  return { ...data, progress: normalize(data.progress) };
}

export async function writeState(state: State) {
  await put(PATH, JSON.stringify(state), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function syncProgress(client: Progress) {
  const state = await readState();
  const progress = merge(normalize(client), state.progress);
  await writeState({ ...state, progress });
  return progress;
}
