"use client";

import { useSyncExternalStore } from "react";
import { isWaiting, onWaiting } from "@/lib/client/player";

// A small note while a tapped sentence is still being fetched, on every page.
export default function AudioWait() {
  const waiting = useSyncExternalStore(onWaiting, isWaiting, () => false);
  if (!waiting) return null;
  return (
    <div className="audio-wait" role="status">
      <span className="ew-spin" /> 正在准备声音
    </div>
  );
}
