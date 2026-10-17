"use client";

import { useEffect } from "react";
import { boot } from "@/lib/client/progress";

// Runs once on load: sync progress, register the service worker for reminders, and ask the browser
// to keep the saved recordings, songs and pictures instead of clearing them when space runs low.
export default function Boot() {
  useEffect(() => {
    boot();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.storage?.persist?.().catch(() => {});
  }, []);
  return null;
}
