"use client";

import { useEffect } from "react";
import { boot } from "@/lib/client/progress";

// Runs once on load: sync progress and register the service worker for reminders.
export default function Boot() {
  useEffect(() => {
    boot();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
