"use client";

import Link from "next/link";
import {
  dayKey,
  diaryToday,
  dueCards,
  level,
  nextStep,
  quests,
  SCENE_QUEST_XP,
  streak,
  todayXp,
  totalXp,
  useProgress,
  weakList,
  XP,
  type Progress,
  type Step,
} from "@/lib/client/progress";
import { formatDuration, totals } from "@/lib/client/metrics";
import { buildingStars, jobTitle, timeOfDay } from "@/lib/client/game";
import Nav from "./Nav";
import { useHydrated } from "@/lib/client/hydrated";

const STEP_LABEL: Record<Step, string> = { listen: "偷听", shadow: "模仿说话", talk: "对话" };
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

// The town has four places, one per tab: the company (scenarios), the station (commute podcast),
// the dojo (today's training) and home (diary, growth, saved expressions).
type Place = "company" | "station" | "dojo" | "home";

// Where each building stands on the map: left in % of the width, top in px from the top of the grass.
const SPOTS: Record<Place, { left: number; top: number }> = {
  company: { left: 18, top: 24 },
  station: { left: 82, top: 112 },
  dojo: { left: 20, top: 392 },
  home: { left: 78, top: 392 },
};

type Talk = { place: Place; who: string; line: string; sub: string; href: string };

// The townsperson who calls the learner over: today's training first, then the diary, then a scenario.
function callout(p: Progress): Talk {
  const due = dueCards(p).length;
  const top = weakList(p)[0];
  if (due) {
    return { place: "dojo", who: "師範", line: "覚えた言葉、もう一度声に出してみよう。", sub: `去道場 · 今日训练 · 先复习 ${due} 句`, href: "/train" };
  }
  if (top && top.last !== dayKey()) {
    return { place: "dojo", who: "師範", line: `「${top.tag}」、まだ迷っているな。`, sub: "去道場 · 今日训练 · 弱点强化", href: "/train" };
  }
  if (!diaryToday(p)) {
    return { place: "home", who: "自分", line: "今日はどんな一日だった？", sub: `回自宅 · 一分钟口语日记 · +${XP.diary} EXP`, href: "/diary" };
  }
  const q = quests(p).find((x) => x.key === "scene" && !x.done);
  const next = nextStep(p);
  if (q && next) {
    const s = next.scenario;
    const first = s.lines[0];
    return {
      place: "company",
      who: first?.speaker ?? s.title,
      line: first?.ja ?? s.talk.opening.ja,
      sub: `${s.icon} ${s.titleZh} · ${STEP_LABEL[next.step]} · 今日 +${SCENE_QUEST_XP} EXP`,
      href: `/s/${s.id}?step=${next.step}`,
    };
  }
  return { place: "dojo", who: "師範", line: "今日の任務は全部終わったな。もう一本、瞬間説はどうだ？", sub: "去道場 · 瞬间说 · 3 秒内开口", href: "/quick" };
}

function Building({
  place,
  icon,
  name,
  pg,
  mark,
  href,
  lock,
  small,
}: {
  place: Place;
  icon: string;
  name: string;
  pg?: string;
  mark?: string;
  href: string;
  lock?: boolean;
  small?: boolean;
}) {
  const at = SPOTS[place];
  return (
    <Link
      href={href}
      className={`bld ${lock ? "lock" : ""}`}
      style={{ left: `${at.left}%`, top: at.top, fontSize: small ? 34 : undefined }}
      onClick={(e) => lock && e.preventDefault()}
      aria-label={name}
    >
      {icon}
      <span className="n">{name}</span>
      {pg && <span className="pg">{pg}</span>}
      {mark && <span className="q" aria-hidden>{mark}</span>}
    </Link>
  );
}

function Week({ p }: { p: Progress }) {
  const hydrated = useHydrated();
  const today = new Date();
  // Days are the phone's days; the server would draw the wrong week before 9:00 in Japan.
  if (!hydrated) return <div className="week" style={{ minHeight: 52 }} />;
  return (
    <div className="week">
      {Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + i);
        const key = dayKey(d);
        const xp = p.days[key] ?? 0;
        const frozen = p.frozen.includes(key);
        const state = xp >= p.goal ? "full" : frozen ? "frozen" : xp > 0 ? "some" : "";
        return (
          <div key={key} className={`${state} ${i === 6 ? "today" : ""}`}>
            {WEEKDAY_JA[d.getDay()]}
            <span className="cell">{state === "full" ? "⭐" : state === "frozen" ? "🛡️" : state === "some" ? "·" : ""}</span>
            {d.getDate()}
          </div>
        );
      })}
    </div>
  );
}

export default function Today() {
  const p = useProgress();
  const xp = todayXp(p);
  const total = totalXp(p);
  const lv = level(total);
  const days = streak(p);
  const qs = quests(p);
  const due = dueCards(p).length;
  const weak = weakList(p).length;
  const talk = callout(p);
  // The clock is the phone's: the server renders in another time zone, so it waits for the browser.
  const hydrated = useHydrated();
  const now = new Date();
  const sky = hydrated ? timeOfDay(now) : { key: "day", label: "" };
  const today = dayKey();
  const t = totals(p, today, today);
  const next = nextStep(p);
  const diaryDone = diaryToday(p);
  const work = buildingStars(p, "work");
  const life = buildingStars(p, "life");
  const mine = buildingStars(p, "custom");
  const topWeak = weakList(p)[0];
  const trainLeft = (due ? 1 : 0) + (topWeak && topWeak.last !== today ? 1 : 0) + (t.quickSpoke >= 5 ? 0 : 1);
  const hero = SPOTS[talk.place];
  const hhmm = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;

  return (
    <main className="town">
      <div className={`map ${sky.key}`}>
        <div className={`sky ${sky.key}`}>
          <span className="clock">
            {hydrated && `${sky.label} ${hhmm} · ${now.getMonth() + 1}月${now.getDate()}日(${WEEKDAY_JA[now.getDay()]})`}
          </span>
          <span className="weather" aria-hidden>{sky.key === "night" ? "🌙 ✨" : sky.key === "evening" ? "🌇" : "☁️ 🌤️"}</span>
        </div>

        <div className="hud win" style={{ position: "absolute", left: 10, right: 10, margin: 0 }}>
          <Link href="/me" className="avatar" aria-label="我">🧑‍💼</Link>
          <div className="row">
            <span>Lv.{lv.n} {jobTitle(lv.n)}</span>
            <span>🔥{days} 🛡️{p.freezes}</span>
          </div>
          <div className="row">
            <span className="lab">EXP</span>
            <div className="bar"><i style={{ width: `${((total - lv.from) / (lv.to - lv.from)) * 100}%` }} /></div>
            <span>{total - lv.from}/{lv.to - lv.from}</span>
          </div>
          <div className="row">
            <span className="lab">今日</span>
            <div className="bar g"><i style={{ width: `${Math.min(1, xp / p.goal) * 100}%` }} /></div>
            <span>任务 {qs.filter((q) => q.done).length}/{qs.length}</span>
          </div>
        </div>

        <div className="ground" style={{ top: "calc(env(safe-area-inset-top) + 128px)" }}>
          <div className="road" style={{ left: -4, right: -4, top: 184, height: 34 }} />
          <div className="road" style={{ left: "calc(50% - 17px)", width: 34, top: -4, bottom: -4 }} />
          <div className="river" style={{ left: 0, right: 0, top: 346, height: 28 }} />
          <div className="bridge" style={{ left: "calc(50% - 26px)", width: 52, top: 342, height: 36 }} />
          {(
            [
              ["🌸", 36, 8],
              ["🌳", 64, 116],
              ["🌳", 34, 128],
              ["🐈", 33, 300],
              ["🌸", 6, 330],
              ["🌳", 93, 440],
              ["🌸", 58, 440],
              ["🌳", 4, 150],
            ] as const
          ).map(([e, l, top], i) => (
            <span key={i} className="deco" style={{ left: `${l}%`, top }} aria-hidden>{e}</span>
          ))}

          <span className="deco" style={{ left: "18%", top: 232, fontSize: 40 }} aria-hidden>🏘️</span>
          <span className="deco" style={{ left: "82%", top: 250, fontSize: 34 }} aria-hidden>⛩️</span>

          <Building
            place="company"
            icon="🏢"
            name="会社"
            pg={`★${work.got + life.got + mine.got}/${work.of + life.of + mine.of}`}
            mark={talk.place === "company" ? "❗" : undefined}
            href="/scenes"
          />
          <Building place="station" icon="🚉" name="駅" pg="通勤播客" mark="📻" href="/podcast" small />
          <Building
            place="dojo"
            icon="🥋"
            name="道場"
            pg={trainLeft ? `今日训练 ${trainLeft}` : "今日 ✓"}
            mark={talk.place === "dojo" ? "⚡" : undefined}
            href="/train"
          />
          <Building place="home" icon="🏠" name="自宅" pg={diaryDone ? "日记 ✓" : "口语日记"} mark={diaryDone ? undefined : "💬"} href="/me" />

          <span className="hero" style={{ left: `${hero.left < 50 ? hero.left + 18 : hero.left - 18}%`, top: hero.top + 18 }} aria-hidden>
            🧑‍💼
          </span>
        </div>
      </div>

      <Link href={talk.href} className="say win">
        <span className="who">{talk.who}</span>：{talk.line}
        <span className="sub">
          {talk.sub} <span className="cursor">▼</span>
        </span>
      </Link>

      <div className="win">
        <div className="row spread" style={{ marginBottom: 8 }}>
          <span className="y">今日の記録</span>
          <span className="small-text">{xp} / {p.goal} EXP</span>
        </div>
        <Week p={p} />
        {t.said > 0 && (
          <div className="kpis" style={{ marginTop: 12 }}>
            <div className="kpi">
              <b>{formatDuration(t.speakSec)}</b>
              <span>开口</span>
            </div>
            <div className="kpi">
              <b>{t.said}</b>
              <span>句</span>
            </div>
            <div className="kpi">
              <b>{t.pron ?? "–"}</b>
              <span>发音</span>
            </div>
          </div>
        )}
        {!next && <p className="small-text" style={{ marginBottom: 0 }}>所有场景都通关了，去会社点「📸 重来一次」，把你今天遇到的情况变成新场景。</p>}
      </div>
      <Nav on="town" />
    </main>
  );
}
