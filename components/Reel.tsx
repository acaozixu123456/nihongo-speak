"use client";

import { useEffect, useRef, useState } from "react";
import { play, preload, stop, ttsUrl, unlock } from "@/lib/client/player";
import { BPM, buzz, fanfare, ping, startBeat, thud } from "@/lib/client/beat";
import { confetti } from "@/lib/client/fx";
import { SRC_JA, type RecapItem } from "@/lib/client/recap";

// 洗脑连播: every item slams onto the screen on a beat and is said twice (the second time slower),
// with its meaning popping in between. Anything missed that day is said a third time, with a gap to
// say it along. Then a fast round of all of them, and confetti.

const BEAT = 60_000 / BPM;
const COLORS = ["c0", "c1", "c2", "c3"];

type Phase = { i: number; zh: boolean; along: boolean } | { rush: number } | "end";

export default function Reel({ items, onClose }: { items: RecapItem[]; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ i: 0, zh: false, along: false });
  const [paused, setPaused] = useState(false);
  const run = useRef(0);
  const from = useRef(0);

  const url = (it: RecapItem) => ttsUrl(it.say, it.voice ?? "ja-JP-AoiNeural");

  async function go(start: number) {
    const mine = ++run.current;
    const live = () => mine === run.current;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const beatOff = startBeat();
    try {
      for (let i = start; i < items.length && live(); i++) {
        from.current = i;
        const it = items[i];
        preload(items.slice(i + 1, i + 4).map(url));
        setPhase({ i, zh: false, along: false });
        thud();
        await wait(BEAT);
        if (!live()) return;
        await play(url(it), 1).catch(() => wait(1200));
        if (!live()) return;
        setPhase({ i, zh: true, along: false });
        ping();
        await wait(BEAT);
        if (!live()) return;
        await play(url(it), 0.85).catch(() => wait(1200));
        if (it.miss && live()) {
          // Missed today: once more, then a gap the length of the sentence to say it along.
          setPhase({ i, zh: true, along: true });
          buzz();
          await wait(BEAT);
          if (!live()) return;
          const t0 = Date.now();
          await play(url(it), 1).catch(() => wait(1200));
          if (!live()) return;
          await wait(Math.max(1500, Date.now() - t0));
        }
        await wait(BEAT / 2);
      }
      // サビ: all of them again, one a beat, just the word.
      for (let r = 0; r < items.length && live(); r++) {
        setPhase({ rush: r });
        thud();
        await wait(BEAT);
      }
      if (!live()) return;
      from.current = 0;
      setPhase("end");
      fanfare();
      confetti(90);
    } finally {
      beatOff();
    }
  }

  useEffect(() => {
    void go(0);
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
    setPaused(false);
    void go(0);
  }

  const close = (e: React.MouseEvent) => {
    e.stopPropagation();
    run.current++;
    stop();
    onClose();
  };

  let body: React.ReactNode;
  let color = "c0";
  if (phase === "end") {
    body = (
      <div className="rl-end">
        <div className="rl-end-n">{items.length}</div>
        <div className="rl-end-t ja-serif">頭に入った！</div>
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
        <div className={`rl-ja ${it.ja.length > 8 ? "long" : ""} ${it.ja.length > 16 ? "longer" : ""}`}>{it.ja}</div>
      </div>
    );
  } else {
    const it = items[phase.i];
    color = COLORS[phase.i % COLORS.length];
    body = (
      <div className="rl-card" key={phase.i}>
        <div className="rl-kana">{it.kana && it.kana !== it.ja ? it.kana : " "}</div>
        <div className={`rl-ja ${it.ja.length > 8 ? "long" : ""} ${it.ja.length > 16 ? "longer" : ""}`}>{it.ja}</div>
        {it.say !== it.ja && <div className="rl-say">{it.say}</div>}
        <div className={`rl-zh ${phase.zh ? "on" : ""}`}>{it.zh}</div>
        {it.miss && <div className="rl-stamp">要記</div>}
        {phase.along && <div className="rl-along">跟着说！</div>}
      </div>
    );
  }

  const n = phase === "end" ? items.length : "rush" in phase ? items.length : phase.i + 1;
  const src = phase !== "end" && !("rush" in phase) ? SRC_JA[items[phase.i].src] : phase === "end" ? "" : "サビ";

  return (
    <div className={`rl-stage ${color}`} onClick={toggle} style={{ ["--beat" as string]: `${BEAT}ms` }}>
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
