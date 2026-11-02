import "server-only";
import { getJson, kvReady, setJson } from "@/lib/kv";
import { merge, normalize, type Progress } from "@/lib/progress-model";
import type { PushSubscription } from "web-push";

// One JSON value in Redis (lib/kv.ts) holds the learner's progress and push reminders.
// Without Redis set up the app still works, just without sync or reminders.

export type Slot = "noon" | "evening";

export type State = {
  progress: Progress;
  push?: { subscription: PushSubscription; slots: Slot[]; lastSent?: Partial<Record<Slot, string>> };
};

const PATH = "state.json";

export const storageReady = kvReady;

export async function readState(): Promise<State> {
  // Only "not there yet" counts as empty; any other failure throws, or the next write would wipe
  // the saved state.
  const data = await getJson<State>(PATH);
  return data ? { ...data, progress: normalize(data.progress) } : { progress: normalize(null) };
}

export async function writeState(state: State) {
  await setJson(PATH, state);
}

export async function syncProgress(client: Progress) {
  const state = await readState();
  const progress = merge(normalize(client), state.progress);
  await writeState({ ...state, progress });
  return progress;
}
