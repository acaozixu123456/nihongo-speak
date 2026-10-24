import "server-only";
import { createECDH, createHash } from "node:crypto";
import webpush from "web-push";
import { dayKey, streak, type Progress } from "@/lib/progress-model";
import type { Slot, State } from "@/lib/store";

// The VAPID key pair is derived from a secret the app already has, so there
// is nothing extra to configure. Changing ANTHROPIC_API_KEY means re-enabling reminders.
function vapid() {
  const seed = process.env.VAPID_SEED ?? process.env.ANTHROPIC_API_KEY ?? "";
  const priv = createHash("sha256").update(`english-speak:vapid:${seed}`).digest();
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(priv);
  return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: priv.toString("base64url") };
}

export const publicKey = () => vapid().publicKey;

export async function send(subscription: webpush.PushSubscription, payload: { title: string; body: string }) {
  const { publicKey, privateKey } = vapid();
  await webpush.sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: { subject: "https://english-speak.vercel.app", publicKey, privateKey },
    TTL: 60 * 60 * 4,
  });
}

// Japan time, which is where the learner is and when the cron fires.
export const jstDay = () => dayKey(new Date(Date.now() + 9 * 3600_000 + new Date().getTimezoneOffset() * 60_000));

export function reminder(p: Progress, slot: Slot): { title: string; body: string } | null {
  const today = jstDay();
  const xp = p.days[today] ?? 0;
  if (xp >= p.goal) return null;
  const days = streak(p, today);
  const due = p.cards.filter((c) => c.due <= today).length;
  const extra = due > 0 ? `另外有 ${due} 句该复习了。` : "";
  if (xp > 0) return { title: `还差 ${p.goal - xp} XP`, body: `今天已经练了 ${xp} XP，再来几分钟就完成目标。${extra}` };
  if (days > 0) {
    return {
      title: `🔥 连续 ${days} 天，别断了`,
      body: slot === "evening" ? `今天还没练。说一段一分钟日记就能保住连续记录。${extra}` : `午休花 5 分钟练一下？${extra}`,
    };
  }
  return { title: "今天练一下英语吧", body: `一个场景、一段日记，5 分钟就够。${extra}` };
}

export function shouldSend(state: State, slot: Slot) {
  const push = state.push;
  return !!push && push.slots.includes(slot) && push.lastSent?.[slot] !== jstDay();
}
