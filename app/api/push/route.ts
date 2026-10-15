import { NextResponse } from "next/server";
import type { PushSubscription } from "web-push";
import { publicKey, send } from "@/lib/push";
import { readState, storageReady, writeState, type Slot } from "@/lib/store";

export async function GET() {
  if (!storageReady()) return NextResponse.json({ storage: false });
  const state = await readState();
  return NextResponse.json({
    storage: true,
    publicKey: publicKey(),
    endpoint: state.push?.subscription.endpoint ?? null,
    slots: state.push?.slots ?? [],
  });
}

// Save (or update) the subscription and which reminders are on; `test` sends one now.
export async function POST(request: Request) {
  if (!storageReady()) return NextResponse.json({ error: "storage not set up" }, { status: 503 });
  const body = (await request.json()) as { subscription?: PushSubscription; slots?: Slot[]; test?: boolean };
  const state = await readState();
  const subscription = body.subscription ?? state.push?.subscription;
  if (!subscription) return NextResponse.json({ error: "no subscription" }, { status: 400 });
  const slots = (body.slots ?? state.push?.slots ?? []).filter((s) => s === "noon" || s === "evening");
  await writeState({ ...state, push: { ...state.push, subscription, slots } });
  if (body.test) {
    try {
      await send(subscription, { title: "提醒已开启 ✅", body: "到点会这样提醒你练习。" });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: "推送发送失败，请关掉提醒再重新打开" }, { status: 502 });
    }
  }
  return NextResponse.json({ ok: true, slots });
}

export async function DELETE() {
  if (!storageReady()) return NextResponse.json({ ok: true });
  const state = await readState();
  await writeState({ progress: state.progress });
  return NextResponse.json({ ok: true });
}
