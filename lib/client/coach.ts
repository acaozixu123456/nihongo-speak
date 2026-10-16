"use client";

import { useEffect, useState } from "react";

// Answers already fetched, so re-rendering or going back doesn't ask the AI again.
const cache = new Map<string, unknown>();

export async function askCoach<T>(body: Record<string, unknown>): Promise<T> {
  const key = JSON.stringify(body);
  if (cache.has(key)) return cache.get(key) as T;
  const res = await fetch("/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: key,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  cache.set(key, data);
  return data as T;
}

// Fetches coach feedback for `body` (skipped while it is null). `retry` asks again after a failure.
export function useCoach<T>(body: Record<string, unknown> | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = body ? JSON.stringify(body) : null;

  useEffect(() => {
    if (!key) return;
    let live = true;
    setData(null);
    setError(null);
    askCoach<T>(JSON.parse(key))
      .then((d) => live && setData(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "网络错误"));
    return () => {
      live = false;
    };
  }, [key, attempt]);

  return { data, error, retry: () => setAttempt((n) => n + 1) };
}
