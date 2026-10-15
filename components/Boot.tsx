"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { boot } from "@/lib/client/progress";

// Runs once the learner is signed in: sync progress and register the service worker for reminders.
export default function Boot() {
  const path = usePathname();
  useEffect(() => {
    if (path === "/login") return;
    boot();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, [path]);
  return null;
}
