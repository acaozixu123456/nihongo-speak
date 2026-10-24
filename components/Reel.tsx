"use client";

import { useEffect, useRef, useState } from "react";
import { play, preload, stop, ttsUrl, unlock } from "@/lib/client/player";
import { BPM, buzz, fanfare, hey, ping, primeBeat, startBeat, thud, type BeatMode } from "@/lib/client/beat";
import { confetti } from "@/lib/client/fx";
import { SRC_JA, type RecapItem } from "@/lib/client/recap";

// 洗脑连播, over a little dance track.
// calm: every item slams onto the screen on a beat and is said twice (the second time slower), its
//   meaning popping in between; anything missed that day is said a third time, with a gap to say it along.
// wild: faster music, the screen shakes and flashes; every item is shouted twice (「再来一次！」),
//   then a second, faster lap of all of them.
// Both end with a サビ of every item, one a beat, and confetti.

const COLORS = ["c0", "c1", "c2", "c3"];

type Phase = { i: number; lap: number; zh: boolean; along: boolean; again: boolean } | { rush: number } | "end";

export default function Reel({ items, mode, onClose }: { items: RecapItem[]; mode: BeatMode; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ i: 0, lap: 0, zh: false, along: false, again: false });
  const [paused, setPaused] = useState(false);
  const run = useRef(0);
  const from = useRef({ lap: 0, i: 0 });
  const wild = mode === "wild";
  const BEAT = 60_000 / BPM[mode];
  // Example sentences can arrive after the reel starts; the loop always reads the latest list.
  const list = useRef(items);
  list.current = items;

  const url = (it: RecapItem) => ttsUrl(it.say, it.voice ?? "en-US-JennyNeural");

  async function go(start: { lap: number; i: number }) {
    const mine = ++run.current;
    const live = () => mine === run.current;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const say = (it: RecapItem, rate: number) => play(url(it), rate).catch(() => wait(1000));
    const beatOff = startBeat(mode);
    const items = list.current;
    try {
      const laps = wild ? 2 : 1;
      for (let lap = start.lap; lap < laps && live(); lap++) {
        for (let i = lap === start.lap ? start.i : 0; i < items.length && live(); i++) {
          from.current = { lap, i };
          const it = list.current[i] ?? items[i];
          preload(items.slice(i + 1, i + 4).map(url));
          const show = (p: Partial<{ zh: boolean; along: boolean; again: boolean }>) =>
            setPhase({ i, lap, zh: false, along: false, again: false, ...p });
          if (!wild) {
            show({});
            thud();
            await wait(BEAT);
            if (!live()) return;
            await say(it, 1);
            if (!live()) return;
            show({ zh: true });
            ping();
            await wait(BEAT);
            if (!live()) return;
            await say(it, 0.85);
            if (it.miss && live()) {
              // Missed today: once more, then a gap the length of the sentence to say it along.
              show({ zh: true, along: true });
              buzz();
              await wait(BEAT);
              if (!live()) return;
              const t0 = Date.now();
              await say(it, 1);
              if (!live()) return;
              await wait(Math.max(1500, Date.now() - t0));
            }
            await wait(BEAT / 2);
          } else if (lap === 0) {
            show({ zh: true });
            thud();
            await wait(BEAT / 2);
            if (!live()) return;
            await say(it, 1.05);
            if (!live()) return;
            show({ zh: true, again: true });
            hey();
            await wait(BEAT);
            if (!live()) return;
            await say(it, 1.15);
            if (it.miss && live()) {
              show({ zh: true, along: true });
              buzz();
              await wait(BEAT / 2);
              if (!live()) return;
              const t0 = Date.now();
              await say(it, 1.15);
              if (!live()) return;
              await wait(Math.max(1200, Date.now() - t0));
            }
          } else {
            // Second lap: faster, said once.
            show({});
            thud();
            await say(it, 1.3);
            if (!live()) return;
            await wait(BEAT / 2);
          }
        }
      }
      // サビ: all of them again, one a beat, just the word.
      for (let r = 0; r < items.length && live(); r++) {
        setPhase({ rush: r });
        thud();
        await wait(BEAT);
      }
      if (!live()) return;
      from.current = { lap: 0, i: 0 };
      setPhase("end");
      fanfare();
      confetti(wild ? 160 : 90);
    } finally {
      beatOff();
    }
  }

  useEffect(() => {
    void go({ lap: 0, i: 0 });
    return () => {
      run.current++;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    if (phase === "end") return;
    if (paused) {
      unlock();
      primeBeat();
      setPaused(false);
      void go(from.current);
    } else {
      run.current++;
      stop();
      setPaused(true);
    }
  }

  function again() {
    unlock();
    primeBeat();
    setPaused(false);
    void go({ lap: 0, i: 0 });
  }

  const close = (e: React.MouseEvent) => {
    e.stopPropagation();
    run.current++;
    stop();
    onClose();
  };

  const size = (ja: string) => `${ja.length > 8 ? "long" : ""} ${ja.length > 16 ? "longer" : ""}`;
  let body: React.ReactNode;
  let color = "c0";
  if (phase === "end") {
    body = (
      <div className="rl-end">
        <div className="rl-end-n">{items.length}</div>
        <div className="rl-end-t ja-serif">记住了！</div>
        <button className="rl-again" onClick={again}>
          再来一遍
        </button>
      </div>
    );
  } else if ("rush" in phase) {
    const it = items[phase.rush];
    color = COLORS[phase.rush % COLORS.length];
    body = (
      <div className="rl-card rush" key={`r${phase.rush}`}>
        <div className={`rl-ja ${size(it.ja)}`}>{it.ja}</div>
      </div>
    );
  } else {
    const it = items[phase.i];
    color = COLORS[(phase.i + phase.lap) % COLORS.length];
    body = (
      <div className="rl-card" key={`${phase.lap}-${phase.i}`}>
        <div className="rl-kana">{it.kana && it.kana !== it.ja ? it.kana : " "}</div>
        <div className={`rl-ja ${size(it.ja)}`}>{it.ja}</div>
        {!it.point && it.say !== it.ja && it.say !== it.kana && <div className="rl-say">{it.say}</div>}
        {it.zh && <div className={`rl-zh ${phase.zh || phase.lap > 0 ? "on" : ""}`} style={it.point ? { fontSize: 15 } : undefined}>
            {it.zh}
          </div>}
        {it.miss && <div className="rl-stamp">要記</div>}
        {phase.again && !phase.along && (
          <div className="rl-again-tag" key="again">
            再来一次！
          </div>
        )}
        {phase.along && <div className="rl-along">跟着说！</div>}
      </div>
    );
  }

  const n = phase === "end" || "rush" in phase ? items.length : phase.i + 1;
  const lapTag = phase !== "end" && !("rush" in phase) && phase.lap > 0 ? "加速 · " : "";
  const src = phase === "end" ? "" : "rush" in phase ? "副歌" : lapTag + SRC_JA[items[phase.i].src];

  return (
    <div
      className={`rl-stage ${color} ${wild && phase !== "end" ? "wild" : ""}`}
      onClick={toggle}
      style={{ ["--beat" as string]: `${BEAT}ms` }}
    >
      <div className="rl-head">
        <span>
          {n} / {items.length}
        </span>
        <span>{src}</span>
      </div>
      <div className="rl-track">
        <div style={{ width: `${(n / items.length) * 100}%` }} />
      </div>
      {body}
      {paused && <div className="ew-paused">▶</div>}
      <button className="ew-close" aria-label="关闭" onClick={close}>
        ✕
      </button>
    </div>
  );
}
