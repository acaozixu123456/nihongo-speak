"use client";

import { useEffect, useRef, useState } from "react";
import { Recorder } from "@/lib/client/recorder";
import { stop as stopAudio, unlock } from "@/lib/client/player";

type Props = {
  label?: string;
  disabled?: boolean;
  onStart?: () => void;
  onRecorded: (wav: Blob) => void;
  onError: (message: string) => void;
};

// A press shorter than this is a tap: recording keeps going until the next tap.
const TAP_MS = 400;

// Press and hold to record, release to finish. A quick tap also works: tap to start, tap again to finish.
// iPhone sometimes loses the release (the mic permission sheet, a system gesture), so the release is
// also caught on the whole window and recording state lives in refs, never in a stale render.
export default function HoldButton({ label = "按住说话", disabled, onStart, onRecorded, onError }: Props) {
  const recorder = useRef<Recorder | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const active = useRef(false);
  const pressedAt = useRef(0);
  const [mode, setMode] = useState<"idle" | "hold" | "latched">("idle");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const cb = useRef({ onStart, onRecorded, onError });
  cb.current = { onStart, onRecorded, onError };

  async function finish() {
    if (!active.current) return;
    active.current = false;
    setMode("idle");
    const pending = starting.current;
    starting.current = null;
    try {
      await pending;
    } catch {
      return;
    }
    const wav = recorder.current!.stop();
    // Shorter than ~0.3s is almost always an accidental tap.
    if (wav.size < 10_000) cb.current.onError("说得太短了，按住按钮再说");
    else cb.current.onRecorded(wav);
  }

  function begin() {
    unlock();
    stopAudio();
    recorder.current ??= new Recorder();
    active.current = true;
    pressedAt.current = Date.now();
    setMode("hold");
    cb.current.onError("");
    cb.current.onStart?.();
    starting.current = recorder.current.start().catch((err: unknown) => {
      active.current = false;
      setMode("idle");
      cb.current.onError(err instanceof Error && err.name === "NotAllowedError" ? "需要允许使用麦克风" : "无法打开麦克风");
      throw err;
    });
  }

  function down(e: React.PointerEvent) {
    if (disabled) return;
    e.preventDefault();
    // Second tap of a tap-to-talk recording ends it.
    if (active.current) {
      if (modeRef.current === "latched") finish();
      return;
    }
    begin();
  }

  function release() {
    if (!active.current || modeRef.current !== "hold") return;
    if (Date.now() - pressedAt.current < TAP_MS) {
      setMode("latched");
      return;
    }
    finish();
  }

  // Catch the release anywhere, and stop if the app goes to the background.
  useEffect(() => {
    if (mode !== "hold") return;
    const up = () => release();
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) finish();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      className={`hold ${mode !== "idle" ? "recording" : ""}`}
      disabled={disabled && mode === "idle"}
      onPointerDown={down}
      onPointerUp={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {mode === "hold" ? "正在录音，松开结束" : mode === "latched" ? "正在录音，再点一下结束" : label}
    </button>
  );
}
