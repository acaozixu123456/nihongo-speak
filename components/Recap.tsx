"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { dayKey, useProgress, type RadioEpisode } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { primeBeat, type BeatMode } from "@/lib/client/beat";
import { recap, recapDays, reelOrder, SRC_JA, type RecapItem } from "@/lib/client/recap";
import type { LearnedSrc } from "@/lib/progress-model";
import Earworm from "./Earworm";
import Reel from "./Reel";

const RANGES = [
  { key: "1", label: "今天", days: 1 },
  { key: "7", label: "最近 7 天", days: 7 },
] as const;
type Range = (typeof RANGES)[number]["key"];

const SONG_KEY = "nihongo-speak:recap-song";
type SongRef = { id: string; range: Range; day: string; n: number };

function readSong(): SongRef | null {
  try {
    return JSON.parse(localStorage.getItem(SONG_KEY) ?? "null") as SongRef | null;
  } catch {
    return null;
  }
}

// The 洗脑歌 server takes an episode; a day's recap goes in as one with no script.
function asEpisode(id: string, items: RecapItem[], title: string): RadioEpisode {
  const top = items.slice(0, 20);
  const grammar = top.filter((i) => i.say !== i.ja && i.say !== i.kana);
  const words = top.filter((i) => !grammar.includes(i) && (i.kana || i.ja.length <= 8));
  const phrases = top.filter((i) => !grammar.includes(i) && !words.includes(i));
  return {
    id,
    date: dayKey(),
    title_zh: title,
    hook_zh: "",
    lines: [],
    words: words.map((i) => ({ ja: i.ja, kana: i.kana ?? "", zh: i.zh })),
    phrases: phrases.map((i) => ({ ja: i.ja, zh: i.zh })),
    grammar: grammar.map((i) => ({ pattern: i.ja, zh: i.zh, ja: i.say })),
    quiz_zh: "",
    heard: true,
  };
}

// 今日: everything learned or practised today (or this week), from every page, in one place, and
// played back as a beat-driven 连播 and, on request, sung as a 洗脑歌.
export default function Recap() {
  const p = useProgress();
  const hydrated = useHydrated();
  const today = dayKey();
  const [range, setRange] = useState<Range>("1");
  const [picked, setPicked] = useState(false);
  const [reel, setReel] = useState<BeatMode | null>(null);
  const [song, setSong] = useState<SongRef | null>(null);

  const items = useMemo(() => (hydrated ? reelOrder(recap(p, recapDays(Number(range), today))) : []), [p, hydrated, range, today]);
  // With nothing yet today, start on the week.
  const todayCount = useMemo(() => (hydrated ? recap(p, [today]).length : 0), [p, hydrated, today]);
  useEffect(() => {
    if (hydrated && !picked && todayCount === 0) setRange("7");
  }, [hydrated, picked, todayCount]);
  useEffect(() => setSong(readSong()), []);

  const label = RANGES.find((r) => r.key === range)!.label;
  const counts = new Map<LearnedSrc, number>();
  for (const i of items) counts.set(i.src, (counts.get(i.src) ?? 0) + 1);
  const missed = items.filter((i) => i.miss);
  const rest = items.filter((i) => !i.miss);

  const mySong = song && song.day === today && song.range === range ? song : null;
  const songEp = useMemo(
    () => (mySong ? asEpisode(mySong.id, items, `${label}学的 ${mySong.n} 个`) : null),
    // The song is made from the list as it was when asked for; later items don't change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mySong?.id],
  );

  function makeSong() {
    const ref: SongRef = { id: `day-${today}-${range}-${Date.now().toString(36)}`, range, day: today, n: items.length };
    try {
      localStorage.setItem(SONG_KEY, JSON.stringify(ref));
    } catch {}
    setSong(ref);
  }

  function open(mode: BeatMode) {
    unlock();
    primeBeat();
    setReel(mode);
  }

  return (
    <main className="page">
      <Link
        href="/"
        className="back"
        onClick={(e) => {
          if (history.length > 1) {
            e.preventDefault();
            history.back();
          }
        }}
      >
        ← 返回
      </Link>
      <h1 className="display">今日</h1>

      <div className="seg">
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={range === r.key ? "on" : ""}
            onClick={() => {
              setPicked(true);
              setRange(r.key);
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {hydrated && items.length === 0 ? (
        <Link href="/" className="today">
          <span className="kicker">{label}</span>
          <span className="today-title">
            <span className="ja-serif">まだ空っぽ</span>
          </span>
          <span className="today-zh">听一期电台、练一组，学过、练过的都会收到这里</span>
          <span className="today-go">去听</span>
        </Link>
      ) : (
        <button className="today today-btn" onClick={() => open("calm")} disabled={!items.length}>
          <span className="kicker">{label}学了</span>
          <span className="today-title">
            <span className="rc-n">
              {items.length}
              <small>个</small>
            </span>
            {missed.length > 0 && <span className="rc-miss">错 {missed.length}</span>}
          </span>
          <span className="rc-stamps">
            {[...counts].map(([src, n]) => (
              <i key={src}>
                {SRC_JA[src]} {n}
              </i>
            ))}
          </span>
          <span className="today-go">▶ 洗脑连播</span>
        </button>
      )}

      {items.length > 0 && (
        <div className="rows">
          <button className="entry" onClick={() => open("wild")}>
            <span className="entry-text ja-serif">激しく</span>
            <span className="chev" aria-hidden>
              ›
            </span>
          </button>
          {songEp ? null : (
            <button className="entry" onClick={makeSong}>
              <span className="entry-text ja-serif">歌にする</span>
              <span className="chev" aria-hidden>
                ›
              </span>
            </button>
          )}
          {mySong && items.length >= mySong.n + 5 && (
            <button className="entry" onClick={makeSong}>
              <span className="entry-text">再唱一首 · 新增 {items.length - mySong.n} 个</span>
              <span className="chev" aria-hidden>
                ›
              </span>
            </button>
          )}
        </div>
      )}
      {songEp && <Earworm key={songEp.id} ep={songEp} kicker={`今日 · 洗脑歌`} />}

      {missed.length > 0 && <ItemList title="错过的" items={missed} />}
      {rest.length > 0 && <ItemList title={missed.length ? "其他" : "全部"} items={rest} />}

      {reel && <Reel items={[...missed, ...rest]} mode={reel} onClose={() => setReel(null)} />}
    </main>
  );
}

function ItemList({ title, items }: { title: string; items: RecapItem[] }) {
  return (
    <section>
      <h2 className="sec">
        {title} {items.length}
      </h2>
      <div className="rows">
        {items.map((it) => (
          <button
            key={it.ja}
            className="entry rc-item"
            onClick={() => {
              unlock();
              play(ttsUrl(it.say, it.voice ?? "ja-JP-AoiNeural")).catch(() => {});
            }}
          >
            <span className="entry-text">
              <span className="rc-ja">
                {it.ja}
                {it.kana && it.kana !== it.ja && <em>{it.kana}</em>}
              </span>
              <small>{it.zh}</small>
            </span>
            <span className="rc-src">{SRC_JA[it.src]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
