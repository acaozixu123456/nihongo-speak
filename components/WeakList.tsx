"use client";

import Link from "next/link";
import { useProgress, weakList, weakness } from "@/lib/client/progress";

// Grammar points and expressions the AI coach keeps seeing the learner get wrong. The shakiest one gets
// the button; the rest are one tap each.
export function WeakList() {
  const p = useProgress();
  const list = weakList(p);
  const fixed = Object.values(p.weak).filter((w) => w.miss > 0 && weakness(w) <= 0).length;
  if (list.length === 0) {
    return (
      <div className="today">
        <span className="today-zh">{Object.keys(p.weak).length ? "现在没有明显的薄弱点。" : "还没有记录。多开口，AI 会把常错的点放到这里。"}</span>
      </div>
    );
  }
  const [top, ...rest] = list;
  const ex = top.examples[0];
  const drill = (tag: string) => `/quick?drill=${encodeURIComponent(tag)}`;
  return (
    <>
      <Link href={drill(top.tag)} className="today">
        <span className="kicker">最该练</span>
        <span className="weak-top">{top.tag}</span>
        {ex?.said && <span className="weak-ex"><s>{ex.said}</s></span>}
        {ex?.better && <span className="weak-ex weak-better">→ {ex.better}</span>}
        <span className="weak-why">错 {top.miss} 次 · {top.hit ? `答对 ${top.hit} 次` : "还没答对过"}</span>
        <span className="today-go">一組やる</span>
      </Link>
      {rest.length > 0 && (
        <>
          <h2 className="sec">其他</h2>
          <div className="rows">
            {rest.map((w) => (
              <Link key={w.tag} href={drill(w.tag)} className="entry">
                <span className="entry-text weak-tag">{w.tag}</span>
                <span className="weak-n">错 {w.miss}{w.hit ? ` · 对 ${w.hit}` : ""}</span>
                <span className="chev" aria-hidden>›</span>
              </Link>
            ))}
          </div>
        </>
      )}
      <p className="muted" style={{ textAlign: "center" }}>
        最常错的几个每天会混进练一练。{fixed > 0 ? `已经练好 ${fixed} 个。` : ""}
      </p>
    </>
  );
}
