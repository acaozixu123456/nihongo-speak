"use client";

import { useRef, useState } from "react";
import { Recorder } from "@/lib/client/recorder";
import { stop as stopAudio, unlock } from "@/lib/client/player";

type Props = {
  label?: string;
  disabled?: boolean;
  onRecorded: (wav: Blob) => void;
  onError: (message: string) => void;
};

// Press and hold to record, release to finish.
export default function HoldButton({ label = "按住说话", disabled, onRecorded, onError }: Props) {
  const recorder = useRef<Recorder | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const [recording, setRecording] = useState(false);

  function down(e: React.PointerEvent) {
    if (disabled || recording) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    unlock();
    stopAudio();
    recorder.current ??= new Recorder();
    setRecording(true);
    starting.current = recorder.current.start().catch((err: unknown) => {
      setRecording(false);
      onError(err instanceof Error && err.name === "NotAllowedError" ? "需要允许使用麦克风" : "无法打开麦克风");
      throw err;
    });
  }

  async function up() {
    if (!recording || !starting.current) return;
    setRecording(false);
    try {
      await starting.current;
    } catch {
      return;
    }
    starting.current = null;
    const wav = recorder.current!.stop();
    // Shorter than ~0.3s is almost always an accidental tap.
    if (wav.size < 10_000) onError("说得太短了，按住按钮再说");
    else onRecorded(wav);
  }

  return (
    <button
      className={`hold ${recording ? "recording" : ""}`}
      disabled={disabled}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {recording ? "正在录音，松开结束" : label}
    </button>
  );
}
