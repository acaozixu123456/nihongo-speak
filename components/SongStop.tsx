"use client";

import Link from "next/link";
import { useEffect } from "react";
import { findEpisode, useProgress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { stepDone, useOnRoute } from "@/lib/client/route";
import Earworm from "./Earworm";

// 一休み: the break in the middle of 今日's route, the episode's 洗脑歌. Heard to the end (or closed),
// the route moves on; an episode without a song is skipped.
export default function SongStop({ id }: { id: string }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const ep = findEpisode(p, id);
  const onRoute = useOnRoute();
  useEffect(() => {
    if (hydrated && !ep) stepDone();
  }, [hydrated, ep]);

  return (
    <main className="page">
      <Link href="/" className="back">← 听</Link>
      <h1 className="display">歇一下</h1>
      {ep && <Earworm ep={ep} kicker="歇一下 · 洗脑歌" onEnd={stepDone} />}
      {/* Always a way on, while the song is still being made. */}
      {ep && onRoute && (
        <button className="link-quiet" onClick={stepDone}>
          先跳过 →
        </button>
      )}
    </main>
  );
}
