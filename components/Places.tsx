"use client";

import Link from "next/link";
import { dueCards, dueSkillCount, useProgress, weakList } from "@/lib/client/progress";
import { todaysEpisode } from "@/lib/client/route";
import { useHydrated } from "@/lib/client/hydrated";
import { scenarios } from "@/content/scenarios";

type Place = { href: string; ja: string; zh: string; n?: string | number | false };

// Every feature, always under 今日: three groups (listen, speak, remember), each with one grey line
// in Chinese, so someone opening the app for the first time can see what is in it. The numbers on
// the right only show what is waiting.
export default function Places() {
  const p = useProgress();
  const hydrated = useHydrated();
  const ep = hydrated ? (todaysEpisode(p) ?? p.episodes[0]) : undefined;
  const fresh = hydrated && p.episodes[0] && !p.episodes[0].heard;
  const skills = hydrated ? dueSkillCount(p) : 0;
  const weak = hydrated ? weakList(p).length : 0;
  const cards = hydrated ? dueCards(p).length : 0;

  const groups: { ja: string; zh: string; places: Place[] }[] = [
    {
      ja: "聴く",
      zh: "听",
      places: [
        { href: "/episodes", ja: "ラジオ", zh: "每天一期 AI 电台", n: fresh && "新" },
        ...(ep ? [{ href: `/ep/${ep.id}/song`, ja: "洗脳歌", zh: "把这期唱成歌" }] : []),
        { href: "/moyu", ja: "流す", zh: "不能出声时只听" },
      ],
    },
    {
      ja: "話す",
      zh: "说",
      places: [
        { href: "/retell", ja: "三回話す", zh: "同一件事讲三遍" },
        { href: "/call", ja: "電話", zh: "和熟人打电话" },
        { href: "/scenes", ja: "場面", zh: `${scenarios.length} 个工作生活场景` },
        { href: "/quick", ja: "瞬間", zh: "看中文马上说日语" },
      ],
    },
    {
      ja: "覚える",
      zh: "记住",
      places: [
        { href: "/practice", ja: "練習", zh: "该复习的题", n: skills > 0 && skills },
        { href: "/weak", ja: "苦手", zh: "我常错的地方", n: weak > 0 && weak },
        { href: "/bag", ja: "フレーズ帳", zh: "收藏的句子", n: cards > 0 && cards },
      ],
    },
  ];

  return (
    <div className="places">
      {groups.map((g) => (
        <section key={g.ja}>
          <h2 className="pl-head">
            {g.ja}
            <small>{g.zh}</small>
          </h2>
          <div className="pl-grid">
            {g.places.map((x) => (
              <Link key={x.href} href={x.href} className="pl">
                <b>{x.ja}</b>
                <span>{x.zh}</span>
                {x.n ? <em>{x.n}</em> : null}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
