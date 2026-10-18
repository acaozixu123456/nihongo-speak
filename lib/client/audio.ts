"use client";

// The one Web Audio context the app plays its sounds through (连播 beat, 音效, 電話 replies).
// iPhone suspends or "interrupts" it when the app goes to the background, and after coming back a
// resumed context can report "running" while staying silent until the app is reopened. So once the
// page has been hidden, the next tap replaces the context with a new one (a tap is the only moment
// iPhone lets one start), and every use resumes it if needed.

let ctx: AudioContext | null = null;
let stale = false;

function make() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new Ctx();
  void ctx.resume().catch(() => {});
  return ctx;
}

// Called from a tap: a fresh context if the old one may have gone silent.
// A merely "suspended" one (new, or paused by the browser) is just resumed: closing it on every tap
// would churn through contexts.
const broken = (c: AudioContext) => stale || (c.state !== "running" && c.state !== "suspended");

export function renewAudio() {
  if (ctx && broken(ctx)) {
    void ctx.close().catch(() => {});
    ctx = null;
  }
  stale = false;
  try {
    return ctx ? audioCtx() : make();
  } catch {
    return null;
  }
}

// The context, created or woken as needed. Throws where Web Audio is missing.
export function audioCtx(): AudioContext {
  if (!ctx || ctx.state === "closed") return make();
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  return ctx;
}

// The current context, without creating one (for code that holds on to a context while it plays).
export const currentAudio = () => ctx;

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && ctx) stale = true;
  });
  // Any tap after coming back renews it, before the tap's own handlers play anything.
  for (const type of ["pointerdown", "touchend", "click"] as const)
    document.addEventListener(
      type,
      () => {
        if (ctx && (broken(ctx) || ctx.state === "suspended")) renewAudio();
      },
      { capture: true, passive: true },
    );
}
