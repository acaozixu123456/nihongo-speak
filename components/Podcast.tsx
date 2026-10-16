"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Podcast as Episode } from "@/lib/claude";
import { allScenarios, dayKey, dueCards, useProgress, weakList } from "@/lib/client/progress";
import Nav from "./Nav";

const KEY = "nihongo-speak:podcast";
const CACHE = "nihongo-speak-podcast";

type Saved = Episode & { day: string };

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

// The episode audio is kept in the browser cache so it still plays underground with no signal.
async function audioFor(ep: Saved): Promise<Blob> {
  const url = `/podcast-audio/${ep.day}/${encodeURIComponent(ep.title_zh)}`;
  try {
    const hit = await (await caches.open(CACHE)).match(url);
    if (hit) return hit.blob();
  } catch {}
  const res = await fetch("/api/podcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "audio", segments: ep.segments }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  const blob = await res.blob();
  try {
    const c = await caches.open(CACHE);
    for (const k of await c.keys()) await c.delete(k);
    await c.put(url, new Response(blob, { headers: { "Content-Type": "audio/mpeg" } }));
  } catch {}
  return blob;
}

// 通勤ラジオ: a three-minute episode a day, written by the AI from the learner's weak points and saved phrases.
export default function Podcast() {
  const p = useProgress();
  const today = dayKey();
  const [ep, setEp] = useState<Saved | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "script" | "audio">("");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = load();
    if (saved) setEp(saved);
  }, []);

  useEffect(() => {
    if (!ep) return;
    let url: string | null = null;
    let live = true;
    setBusy("audio");
    setError("");
    audioFor(ep)
      .then((b) => {
        if (!live) return;
        url = URL.createObjectURL(b);
        setSrc(url);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "音频生成失败"))
      .finally(() => live && setBusy(""));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ep]);

  async function make() {
    setBusy("script");
    setError("");
    setSrc(null);
    try {
      const weak = weakList(p).slice(0, 3).map((w) => ({ tag: w.tag, zh: w.zh, examples: w.examples.slice(0, 2) }));
      const cards = [...dueCards(p), ...p.cards].slice(0, 8).map((c) => ({ ja: c.ja, zh: c.zh }));
      const scenes = allScenarios(p).slice(0, 6).map((s) => s.titleZh);
      const res = await fetch("/api/podcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "script", weak, cards, scenes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成失败");
      const saved: Saved = { ...(data as Episode), day: today };
      localStorage.setItem(KEY, JSON.stringify(saved));
      setEp(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setBusy("");
    }
  }

  const fresh = ep?.day === today;

  return (
    <main>
      <Link href="/" className="back">← 小镇</Link>
      <header className="page-mast">
        <span className="icon" aria-hidden>🚉</span>
        <div>
          <h1>通勤ラジオ</h1>
          <p className="muted">每天 3 分钟 · 讲你的薄弱点和收藏的话 · 锁屏也能听</p>
        </div>
      </header>

      <div className="card">
        {ep ? (
          <>
            <div className="small-text">{fresh ? "今天的一期" : `${ep.day.slice(5).replace("-", "月")}日的一期`}</div>
            <div className="y" style={{ fontSize: 20, margin: "4px 0 10px" }}>📻 {ep.title_zh}</div>
            {src ? (
              <audio controls src={src} style={{ width: "100%" }} />
            ) : (
              <p className="muted judge-wait">{busy === "audio" ? "正在录音…" : ""}</p>
            )}
          </>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            AI 会根据你最近说错的语法和收藏的表达，写一期 3 分钟的节目：中文讲解 + 日语例句 + 留白让你在心里跟读。
          </p>
        )}
        {(!fresh || !ep) && (
          <button className="primary next-cta" onClick={make} disabled={!!busy}>
            {busy === "script" ? "AI 正在写今天的节目…" : "生成今天的一期"}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {ep && (
        <>
          <h2>台本</h2>
          <div className="card podcast-script">
            {ep.segments.map((s, i) =>
              s.kind === "zh" ? (
                <p key={i} className="muted">{s.text}</p>
              ) : (
                <div key={i} className="pod-ja">
                  <div className="ja">
                    {s.kind === "repeat" && <span className="y">🔁 </span>}
                    {s.text}
                  </div>
                  <div className="zh">{s.zh}</div>
                </div>
              ),
            )}
          </div>
        </>
      )}
      <Nav on="town" />
    </main>
  );
}
