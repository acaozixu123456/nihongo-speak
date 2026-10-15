import { NextResponse } from "next/server";
import { jstDay, reminder, send, shouldSend } from "@/lib/push";
import { readState, storageReady, writeState, type Slot } from "@/lib/store";

// Called by Vercel Cron (see vercel.json). Sends at most one reminder per slot per day.
export async function GET(request: Request, { params }: { params: Promise<{ slot: string }> }) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const fromCron = secret ? auth === `Bearer ${secret}` : (request.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (!fromCron) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { slot } = await params;
  if ((slot !== "noon" && slot !== "evening") || !storageReady()) {
    return NextResponse.json({ sent: false, storage: storageReady() });
  }
  const state = await readState();
  if (!shouldSend(state, slot)) return NextResponse.json({ sent: false });

  const message = reminder(state.progress, slot as Slot);
  const push = state.push!;
  if (message) {
    try {
      await send(push.subscription, message);
    } catch (e) {
      console.error(e);
      const gone = (e as { statusCode?: number }).statusCode;
      // The phone unsubscribed; forget it.
      if (gone === 404 || gone === 410) await writeState({ progress: state.progress });
      return NextResponse.json({ sent: false });
    }
  }
  await writeState({ ...state, push: { ...push, lastSent: { ...push.lastSent, [slot]: jstDay() } } });
  return NextResponse.json({ sent: !!message });
}
