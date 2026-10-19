"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { unlock } from "@/lib/client/player";
import { dueSkillCount, rehearsalToReport, teacherFix, teacherPlan, todaysCards, useProgress, weakList } from "@/lib/client/progress";
import { FixBlock, GoodBlock } from "./TeacherMemo";
import { SenseiFace, SenseiSays } from "./Sensei";
import { useHydrated } from "@/lib/client/hydrated";
import { NEW_EP, PILLARS, finished, oneFix, pillarOf, plan, quietPref, setQuiet, startRoute, todaysEpisode, useRoute, type Pillar, type Stop } from "@/lib/client/route";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

// What the vermilion button says for the stop it opens.
const GO: Record<Stop["key"], string> = {
  listen: "▶ 聴く",
  song: "♪ 一休み",
  flow: "流す",
  retell: "話す",
  quick: "瞬間",
  call: "電話する",
  fix: "1分 直す",
  game: "練習する",
  skills: "練習する",
  review: "復習する",
};

type Chip = { href: string; ja: string; n?: number | false };

function Chips({ chips }: { chips: Chip[] }) {
  return (
    <div className="pil-chips">
      {chips.map((c) => (
        <Link key={c.href} href={c.href}>
          {c.ja}
          {c.n ? <em>{c.n}</em> : null}
        </Link>
      ))}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? ["おはよう。", "早上好。"] : h < 18 ? ["こんにちは。", "你好。"] : ["こんばんは。", "晚上好。"];
}

// 今日: three cards, top to bottom in the order of the day: 聴く, 話す, 先生. Each shows the one thing
// picked for today; only the card that comes next has the vermilion button, and a finished card folds
// into one ✓ line. The other features sit as small chips in the card they belong to.
export default function Home() {
  const p = useProgress();
  const hydrated = useHydrated();
  const router = useRouter();
  const r = useRoute();
  const [quiet, setQ] = useState(false);
  useEffect(() => setQ(r?.quiet ?? quietPref()), [r]);

  const d = new Date();
  const date = hydrated ? `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY_JA[d.getDay()]}）` : "";
  const top = (
    <div className="top">
      <span>{date}</span>
      {hydrated && (
        <label className="quiet top-quiet">
          <input
            type="checkbox"
            checked={quiet}
            onChange={(e) => {
              setQ(e.target.checked);
              setQuiet(p, e.target.checked);
            }}
          />
          <span className="sw" aria-hidden />
          声を出せない
        </label>
      )}
    </div>
  );
  if (!hydrated) return <main className="page">{top}</main>;

  const over = finished(r);
  const stops = r && r.at > 0 ? r.stops : plan(p, quiet);
  const at = over ? stops.length : r && r.at > 0 ? r.at : 0;
  const now: Pillar | null = over ? null : pillarOf(stops[at].key);
  const of = (x: Pillar) => stops.map((s, i) => ({ s, i })).filter(({ s }) => pillarOf(s.key) === x);
  const isDone = (x: Pillar) => {
    const mine = of(x);
    return over || (mine.length > 0 && mine.every(({ i }) => i < at));
  };
  // The first stop of a card not reached yet, to open it off the route.
  const firstLeft = (x: Pillar) => of(x).find(({ i }) => i >= at)?.s;
  const go = () => {
    unlock();
    router.push(startRoute(p, quiet));
  };

  const ep = todaysEpisode(p) ?? p.episodes[0];
  const fix = teacherFix(p);
  const good = teacherPlan()?.good;
  const cards = todaysCards(p).length;
  const skills = dueSkillCount(p);
  const weak = weakList(p).length;

  const button = (x: Pillar) => {
    if (now === x) {
      return (
        <button className="pil-go on" onClick={go}>
          {GO[stops[at].key]}
        </button>
      );
    }
    const s = firstLeft(x);
    if (!s) return null;
    const href = s.href.startsWith(NEW_EP) ? "/episodes" : s.href;
    return (
      <Link href={href} className="pil-go">
        {GO[s.key]}
      </Link>
    );
  };

  const doneLine = (x: Pillar, ja: string, sum: string) => (
    <div key={x} className="pil done">
      <span className="pil-ok">✓</span>
      <b>{ja}</b>
      <span className="pil-sum">{sum}</span>
    </div>
  );

  const listenCard = () => {
    const s = of("listen").find(({ s }) => s.key === "listen")?.s;
    if (isDone("listen")) return doneLine("listen", "聴く", s?.meta ?? "");
    return (
      <section key="listen" className={`pil${now === "listen" ? " next" : ""}`}>
        <div className="pil-head">
          <b>聴く</b>
          <small>听</small>
          <Link href="/episodes" className="pil-more">ラジオ一覧 ›</Link>
        </div>
        <div className="pil-what">
          <div className="pil-t">{s?.meta === "新しい回" ? "今日の回を作ります" : (s?.meta ?? ep?.title_ja ?? "ラジオ")}</div>
          <div className="pil-m">ゆるっと日本ラジオ</div>
        </div>
        {button("listen")}
        <Chips chips={[...(ep ? [{ href: `/ep/${ep.id}/song`, ja: "洗脳歌" }] : []), { href: "/moyu", ja: "流す" }]} />
      </section>
    );
  };

  const speakCard = () => {
    const mine = of("speak");
    if (mine.length && isDone("speak")) return doneLine("speak", "話す", mine.map(({ s }) => (s.key === "call" ? `電話・${s.meta}` : s.key === "retell" ? "三回話した" : s.meta)).join("・"));
    const first = mine[0]?.s;
    const report = !!rehearsalToReport(p);
    return (
      <section key="speak" className={`pil${now === "speak" ? " next" : ""}`}>
        <div className="pil-head">
          <b>話す</b>
          <small>说</small>
        </div>
        {quiet || !first ? (
          <div className="pil-what">
            <div className="pil-t muted">今は聴くだけ</div>
            <div className="pil-m">能出声的时候再说</div>
          </div>
        ) : (
          <div className="pil-what">
            <div className="pil-t">{first.key === "quick" ? `瞬間 ${first.meta.replace(/\D/g, "")}問` : "さっきの話を三回話す"}</div>
            <div className="pil-m">{first.key === "quick" ? "看中文马上说日语" : "听完的那期，用自己的话讲三遍"}</div>
          </div>
        )}
        {!quiet && button("speak")}
        <Chips
          chips={[
            { href: "/call", ja: "電話" },
            { href: "/scenes", ja: "場面" },
            { href: "/quick", ja: "瞬間" },
            { href: "/rehearse", ja: "予行演習", n: report && 1 },
          ]}
        />
      </section>
    );
  };

  const teacherCard = () => {
    const next = now === "teacher";
    const [hi, hiZh] = greeting();
    let say: [string, string];
    if (over) say = ["今日はここまで。よくがんばりましたね。", "今天就到这里，辛苦了。"];
    else if (next && good && fix) say = ["よくなったところと、直したいところがひとつずつ。", "有一处进步了，也有一处要改。"];
    else if (next && good) say = ["ここ、よくなりましたね。", "这里进步了。"];
    else if (next && fix) say = ["ひとつだけ、一緒に直しましょうね。", "只有一处，我们一起改。"];
    else if (next) say = ["今日の練習、一緒にやりましょう。", "今天的练习，我们一起做。"];
    else if (fix) say = [`${hi}昨日のひとつだけ、あとで一緒に直しましょうね。`, `${hiZh}昨天那一处，待会儿我们一起改。`];
    else say = [`${hi}今日も聞いていますよ。`, `${hiZh}今天我也在听哦。`];
    const tomorrow = over ? oneFix(p) : null;
    return (
      <section key="teacher" className={`pil${next ? " next" : ""}`}>
        <div className="sensei-head">
          <SenseiFace nod={over || (next && !!good)} />
          <b>森先生</b>
          <small>老师</small>
          <Link href="/me" className="pil-more">メモ ›</Link>
        </div>
        <SenseiSays ja={say[0]} zh={say[1]} />
        {next && good && <GoodBlock g={good} />}
        {!over && fix && <FixBlock f={fix} />}
        {tomorrow && (
          <div className="one-fix">
            <span className="kicker">明日はこれだけ</span>
            <div className="ja">
              <del>{tomorrow.said}</del> → <ins>{tomorrow.better}</ins>
            </div>
            <small>{tomorrow.why}</small>
          </div>
        )}
        {over ? (
          <Link href="/today" className="pil-go">
            ♪ 今日の歌
          </Link>
        ) : (
          button("teacher")
        )}
        <Chips
          chips={[
            { href: "/review", ja: "復習", n: cards },
            { href: "/practice", ja: "練習", n: skills },
            { href: "/weak", ja: "苦手", n: weak },
            { href: "/bag", ja: "フレーズ帳" },
          ]}
        />
      </section>
    );
  };

  const card: Record<Pillar, () => ReactNode> = { listen: listenCard, speak: speakCard, teacher: teacherCard };
  return (
    <main className="page">
      {top}
      <div className="pillars">{PILLARS.map((x) => card[x]())}</div>
    </main>
  );
}
