"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { unlock } from "@/lib/client/player";
import { rehearsalToReport, useProgress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { current, heardToday, plan, quietPref, startRoute, useRoute } from "@/lib/client/route";
import { retellBlocker, retellList } from "@/lib/client/retell-history";
import { RetellRow } from "./RetellRows";
import Note from "./Note";
import { FixBlock } from "./TeacherMemo";

// 話す: 三回話す on top, the day's most important speaking: the one thing that stops the learner most and today's story, with up to two
// told before worth telling again (all of them in /retell/list); then the other ways to talk.
export default function SpeakTab() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const r = useRoute();
  const quiet = hydrated ? (r?.quiet ?? quietPref()) : false;
  const stops = hydrated ? (r ? r.stops : plan(p, quiet)) : [];
  const first = stops.find((s) => s.key === "retell");
  const onRoute = !!first && current(r) === first;
  const todayEp = hydrated ? heardToday(p) : null;
  const list = hydrated ? retellList(p, todayEp) : null;
  const fix = hydrated ? retellBlocker(p) : null;
  const report = hydrated && !!rehearsalToReport(p);
  const go = () => {
    unlock();
    router.push(startRoute(p, quiet));
  };

  return (
    <main className="page">
      <h1 className="tab-h1">
        说
      </h1>
      {hydrated && list && (
        <section className="rt-hero">
          <div className="rt-head">
            <span>讲三遍</span>
            <Link href="/retell/list">全部{list.times ? ` ${list.times} 次` : ""} ›</Link>
          </div>
          <Note text={fix ? "你最常卡在这里，今天讲的时候用上这句" : list.today.toldToday ? "今天已经讲过了" : "今天讲这个"} />
          {fix && <FixBlock f={fix} />}
          <div className="rt-title">{list.today.ja}</div>
          {(list.today.times > 0 || list.today.score !== null) && (
            <div className="rt-sub">{[`${list.today.times} 次`, list.today.score !== null ? `${list.today.score} 分` : ""].filter(Boolean).join(" · ")}</div>
          )}
          {onRoute ? (
            <button className="pil-go on" onClick={go}>
              开始讲
            </button>
          ) : (
            <Link href={list.today.href} className={`pil-go${list.today.toldToday || quiet ? "" : " on"}`}>
              {list.today.toldToday ? "再来一次" : "开始讲"}
            </Link>
          )}
          {list.picks.length > 0 && (
            <div className="rt-picks">
              <span className="kicker">再来一次</span>
              {list.picks.map((r) => (
                <RetellRow key={r.key} r={r} bare />
              ))}
            </div>
          )}
        </section>
      )}
      <div className="kicker tab-kicker">其他练法</div>
      <div className="pl-grid">
        <Link href="/call" className="pl">
          <b>打电话</b>
          <span>和熟人打电话</span>
        </Link>
        <Link href="/scenes" className="pl">
          <b>场景对话</b>
          <span>工作生活场景</span>
        </Link>
        <Link href="/quick" className="pl">
          <b>马上说</b>
          <span>看中文马上说日语</span>
        </Link>
        <Link href="/rehearse" className="pl">
          <b>预演</b>
          <span>明天要说的话先演一遍</span>
          {report ? <em className="new">1</em> : null}
        </Link>
      </div>
    </main>
  );
}
