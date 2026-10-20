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
        話す<small>说</small>
      </h1>
      {hydrated && list && (
        <section className="rt-hero">
          <div className="rt-head">
            <span>三回話す</span>
            <Link href="/retell/list">一覧{list.times ? ` ${list.times}回` : ""} ›</Link>
          </div>
          <Note
            ja={fix ? "ここで一番止まっています。" : list.today.toldToday ? "今日はもう話しました。" : "今日はこれを話そう。"}
            zh={fix ? "今天讲的时候，用上下面这句" : undefined}
          />
          {fix && <FixBlock f={fix} />}
          <div className="rt-title">{list.today.ja}</div>
          {(list.today.times > 0 || list.today.score !== null) && (
            <div className="rt-sub">{[`${list.today.times}回`, list.today.score !== null ? `${list.today.score}点` : ""].filter(Boolean).join(" · ")}</div>
          )}
          {onRoute ? (
            <button className="pil-go on" onClick={go}>
              話す
            </button>
          ) : (
            <Link href={list.today.href} className={`pil-go${list.today.toldToday || quiet ? "" : " on"}`}>
              {list.today.toldToday ? "もう一回" : "話す"}
            </Link>
          )}
          {list.picks.length > 0 && (
            <div className="rt-picks">
              <span className="kicker">もう一回</span>
              {list.picks.map((r) => (
                <RetellRow key={r.key} r={r} bare />
              ))}
            </div>
          )}
        </section>
      )}
      <div className="kicker tab-kicker">ほかの話し方</div>
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
