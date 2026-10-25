"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Recorder } from "@/lib/client/recorder";
import { stop as stopAudio, unlock } from "@/lib/client/player";

type Props = {
  label?: React.ReactNode;
  disabled?: boolean;
  // Round button with an icon: while recording it shows the clock only, the words go under it.
  compact?: boolean;
  // Seconds before it stops by itself (60 unless given).
  limit?: number;
  onStart?: () => void;
  // The mic is capturing: its stream, to listen alongside (森先生's ears).
  onLive?: (stream: MediaStream) => void;
  // Changed while recording: the recording ends as if tapped (森先生 stepping in).
  stopKey?: number;
  onRecorded: (wav: Blob) => void;
  onError: (message: string) => void;
};

// A press shorter than this is a tap: recording keeps going until the next tap.
const TAP_MS = 400;
// Stops by itself so a forgotten recording doesn't run on.
const LIMIT_S = 60;

// Tap to start, tap again to finish. Pressing and holding also works: release to finish.
// The button changes the moment it is touched ("准备…"), and shows the red dot and clock only once the mic is
// really capturing, so nothing said before that is lost without warning.
// iPhone sometimes loses the release (the mic permission sheet, a system gesture), so the release is
// also caught on the whole window and recording state lives in refs, never in a stale render.
export default function HoldButton({ label = "点一下说话", disabled, compact, limit = LIMIT_S, onStart, onLive, stopKey, onRecorded, onError }: Props) {
  const recorder = useRef<Recorder | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const active = useRef(false);
  const pressedAt = useRef(0);
  const liveAt = useRef(0);
  const [phase, setPhase] = useState<"idle" | "starting" | "live">("idle");
  const [latched, setLatched] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const holding = useRef(false);
  const cb = useRef({ onStart, onLive, onRecorded, onError });
  cb.current = { onStart, onLive, onRecorded, onError };

  async function finish() {
    if (!active.current) return;
    active.current = false;
    holding.current = false;
    setPhase("idle");
    setLatched(false);
    const pending = starting.current;
    starting.current = null;
    try {
      await pending;
    } catch {
      return;
    }
    let wav: Blob;
    try {
      wav = await recorder.current!.stop();
    } catch {
      cb.current.onError("录音出错了，再试一次");
      return;
    }
    // Shorter than ~0.3s is almost always an accidental tap.
    if (wav.size < 10_000) cb.current.onError("说得太短了，等红点出现再说");
    else cb.current.onRecorded(wav);
  }

  function begin() {
    unlock();
    stopAudio();
    recorder.current ??= new Recorder();
    active.current = true;
    holding.current = true;
    pressedAt.current = Date.now();
    liveAt.current = 0;
    // Paint the pressed state right away; opening the mic can take a moment on iPhone.
    flushSync(() => {
      setPhase("starting");
      setLatched(false);
      setElapsed(0);
    });
    cb.current.onError("");
    cb.current.onStart?.();
    const rec = recorder.current;
    starting.current = new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(() => rec.start())
      .then(() => {
        liveAt.current = Date.now();
        if (active.current) {
          setPhase("live");
          if (rec.input) cb.current.onLive?.(rec.input);
        }
      })
      .catch((err: unknown) => {
        active.current = false;
        holding.current = false;
        setPhase("idle");
        setLatched(false);
        cb.current.onError(err instanceof Error && err.name === "NotAllowedError" ? "需要允许使用麦克风" : "无法打开麦克风");
        throw err;
      });
  }

  function down(e: React.PointerEvent) {
    if (disabled && !active.current) return;
    e.preventDefault();
    // Any touch while recording ends it.
    if (active.current) {
      if (!holding.current) finish();
      return;
    }
    begin();
  }

  function release() {
    if (!active.current || !holding.current) return;
    holding.current = false;
    // A quick tap, or letting go before the mic was even ready, keeps recording until the next tap.
    const now = Date.now();
    if (now - pressedAt.current < TAP_MS || !liveAt.current || now - liveAt.current < TAP_MS) {
      setLatched(true);
      return;
    }
    finish();
  }

  useEffect(() => {
    if (stopKey) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopKey]);

  // Catch the release anywhere.
  useEffect(() => {
    if (phase === "idle") return;
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
  }, [phase]);

  // Running clock while listening, with a hard stop.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => {
      const s = (Date.now() - liveAt.current) / 1000;
      setElapsed(s);
      if (s >= limit) finish();
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Stop if the app goes to the background or the page is left.
  useEffect(() => {
    const hide = () => {
      if (document.hidden) finish();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      if (active.current) {
        active.current = false;
        void starting.current?.then(() => recorder.current?.stop()).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const secs = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}`;
  return (
    <button
      className={`hold${compact ? " compact" : ""} ${phase !== "idle" ? "recording" : ""} ${phase === "starting" ? "starting" : ""}`}
      disabled={disabled && phase === "idle"}
      onPointerDown={down}
      onPointerUp={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {phase === "idle" && label}
      {phase === "starting" && (compact ? "…" : "准备…")}
      {phase === "live" && (
        <>
          <span className="rec-dot" />
          {secs}{!compact && ` ${latched ? "点我结束" : "松开结束"}`}
        </>
      )}
    </button>
  );
}
