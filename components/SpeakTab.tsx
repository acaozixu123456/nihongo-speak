"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { unlock } from "@/lib/client/player";
import { rehearsalToReport, useProgress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { current, pillarOf, plan, quietPref, startRoute, useRoute } from "@/lib/client/route";
import { GO } from "./Home";

// 話す: today's speaking on top (三回話す, or 瞬間 when there is no episode to tell), then the other ways to talk.
export default function SpeakTab() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const r = useRoute();
  const quiet = hydrated ? (r?.quiet ?? quietPref()) : false;
  const stops = hydrated ? (r ? r.stops : plan(p, quiet)) : [];
  const first = stops.find((s) => pillarOf(s.key) === "speak");
  const onRoute = !!first && current(r) === first;
  const report = hydrated && !!rehearsalToReport(p);
  const go = () => {
    unlock();
    router.push(startRoute(p, quiet));
  };

  return (
    <main className="page">
      <h1 className="tab-h1">
        話す<small>说</small>
      </h1>
      {hydrated && (
        <section className="now-card">
          <div className="kicker">今日</div>
          {quiet || !first ? (
            <div className="pil-what">
              <div className="pil-t muted">今は聴くだけ</div>
              <div className="pil-m">能出声的时候再说</div>
            </div>
          ) : (
            <>
              <div className="pil-what">
                <div className="pil-t">{first.key === "quick" ? `瞬間 ${first.meta.replace(/\D/g, "")}問` : "さっきの話を三回話す"}</div>
                <div className="pil-m">{first.key === "quick" ? "看中文马上说日语" : "听完的那期，用自己的话讲三遍"}</div>
              </div>
              {onRoute ? (
                <button className="pil-go on" onClick={go}>
                  {GO[first.key]}
                </button>
              ) : (
                <Link href={first.href} className="pil-go">
                  {GO[first.key]}
                </Link>
              )}
            </>
          )}
        </section>
      )}
      <div className="pl-grid">
        <Link href="/call" className="pl">
          <b>電話</b>
          <span>和熟人打电话</span>
        </Link>
        <Link href="/scenes" className="pl">
          <b>場面</b>
          <span>工作生活场景</span>
        </Link>
        <Link href="/quick" className="pl">
          <b>瞬間</b>
          <span>看中文马上说日语</span>
        </Link>
        <Link href="/rehearse" className="pl">
          <b>予行演習</b>
          <span>明天要说的话先演一遍</span>
          {report ? <em className="new">1</em> : null}
        </Link>
      </div>
    </main>
  );
}
