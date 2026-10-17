"use client";

import Link from "next/link";
import { dueCards, useProgress, weakList } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { calls } from "@/content/calls";
import { scenarios } from "@/content/scenarios";

// Every place to pick by hand, as tiles. Shown on 我, and on 今日 once today's route is done,
// so a finished day still leads somewhere.
export default function Places() {
  const p = useProgress();
  const hydrated = useHydrated();
  const due = dueCards(p).length;
  const weak = weakList(p).length;
  const latest = p.episodes[0];
  const told = (p.retells ?? []).length;

  return (
    <div className="tiles">
      <Link href="/episodes" className="tile wide">
        <span className="tile-mark" aria-hidden>聴</span>
        <span className="tile-name ja-serif">ラジオ</span>
        <span className="tile-sub">{hydrated && latest ? latest.title_zh : " "}</span>
        {hydrated && p.episodes.length > 0 && <span className="tile-n">{p.episodes.length}</span>}
      </Link>
      <Link href="/retell" className="tile wide">
        <span className="tile-mark" aria-hidden>三</span>
        <span className="tile-name ja-serif">三回話す</span>
        <span className="tile-sub">同じ話を三人に</span>
        {hydrated && told > 0 && <span className="tile-n">{told}</span>}
      </Link>
      <Link href="/scenes" className="tile">
        <span className="tile-mark" aria-hidden>場</span>
        <span className="tile-name ja-serif">場面</span>
        <span className="tile-n">{scenarios.length}</span>
      </Link>
      <Link href="/call" className="tile">
        <span className="tile-mark" aria-hidden>話</span>
        <span className="tile-name ja-serif">電話</span>
        <span className="tile-n">{calls.length}</span>
      </Link>
      <Link href="/weak" className="tile">
        <span className="tile-mark" aria-hidden>苦</span>
        <span className="tile-name ja-serif">苦手</span>
        {hydrated && weak > 0 && <span className="tile-n">{weak}</span>}
      </Link>
      <Link href="/bag" className={`tile${hydrated && due > 0 ? " hot" : ""}`}>
        <span className="tile-mark" aria-hidden>帳</span>
        <span className="tile-name ja-serif">フレーズ帳</span>
        {hydrated && p.cards.length > 0 && (
          <span className="tile-n">{due > 0 ? `${due} / ${p.cards.length}` : p.cards.length}</span>
        )}
      </Link>
    </div>
  );
}
