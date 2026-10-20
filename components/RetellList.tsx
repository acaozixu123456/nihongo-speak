"use client";

import Link from "next/link";
import { useProgress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { heardToday } from "@/lib/client/route";
import { GRAD_SCORE, retellList } from "@/lib/client/retell-history";
import { RetellRow } from "./RetellRows";

const md = (d?: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");

export default function RetellList() {
  const p = useProgress();
  const hydrated = useHydrated();
  if (!hydrated) return <main className="page" />;
  const todayEp = heardToday(p);
  const list = retellList(p, todayEp);
  const sub = (r: (typeof list.eps)[number]) => [r === list.today ? "今天" : md(r.date), r.zh].filter(Boolean).join(" · ");
  return (
    <main className="page">
      <Link href="/speak" className="back">
        ← 说
      </Link>
      <h1 className="ep-head">讲三遍</h1>
      <p className="rt-sum">
        {list.times ? `${list.times} 次 · ${list.stories} 个话题` : "还没有"}
      </p>
      {list.eps.length > 0 && (
        <>
          <div className="kicker tab-kicker">听过的</div>
          <div className="rt-list">
            {list.eps.map((r) => (
              <RetellRow key={r.href} r={r} sub={sub(r)} />
            ))}
          </div>
        </>
      )}
      <div className="kicker tab-kicker">自己的事</div>
      <div className="rt-list">
        {list.life.map((r) => (
          <RetellRow key={r.href} r={r} sub={r.zh} />
        ))}
      </div>
      <p className="rt-key">分数 = 第三遍有多顺 · 卒業 = 3回、{GRAD_SCORE}点以上</p>
    </main>
  );
}
