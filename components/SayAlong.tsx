"use client";

import { useEffect, useRef, useState } from "react";
import { play, preload, progress, stop, ttsUrl, unlock } from "@/lib/client/player";

// 一緒に言う: the natural version of today's story, one sentence at a time, three passes each: hear it,
// say it together with the voice (a little slower, the words lighting up as they are said), then say
// it alone in the same time with the words faded out. Shadowing works best this way: listen first,
// then overlap, then produce it unprompted. Nothing is recorded or scored.

type Line = { ja: string; zh: string };
const STEPS = ["聴く", "一緒に", "ひとりで"] as const;
const SLOW = 0.9;

export default function SayAlong({ lines, voice, onClose }: { lines: Line[]; voice: string; onClose: () => void }) {
  const [at, setAt] = useState(0);
  const [step, setStep] = useState(0);
  const [lit, setLit] = useState(0);
  const [alone, setAlone] = useState(0);
  const [done, setDone] = useState(false);
  // Bumped to cancel the running pass (repeat, skip, close, leaving the page).
  const run = useRef(0);
  const secs = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    preload(lines.map((l) => ttsUrl(l.ja, voice)));
    return () => {
      run.current++;
      stop();
    };
  }, [lines, voice]);

  // Light the characters up as far as the voice has got.
  function follow(me: number) {
    const tick = () => {
      if (run.current !== me) return;
      const { at: t, of } = progress();
      if (of > 0) setLit(Math.min(1, t / of));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function line(i: number) {
    const me = ++run.current;
    stop();
    setAt(i);
    setDone(false);
    const src = ttsUrl(lines[i].ja, voice);
    const live = () => run.current === me;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let s = 0; s < STEPS.length && live(); s++) {
      setStep(s);
      setLit(0);
      if (s < 2) {
        follow(me);
        try {
          await play(src, s === 0 ? 1 : SLOW);
        } catch {
          return;
        }
        if (!live()) return;
        const { of } = progress();
        if (of > 0) secs.current = of / SLOW;
        setLit(1);
        await wait(700);
      } else {
        // Alone: as long as the slow pass took, with a bar running out.
        const ms = Math.max(2500, secs.current * 1000 + 600);
        setAlone(ms);
        await wait(ms);
      }
    }
    if (!live()) return;
    if (i + 1 < lines.length) line(i + 1);
    else setDone(true);
  }

  function start(i: number) {
    unlock();
    line(i);
  }

  function close() {
    run.current++;
    stop();
    onClose();
  }

  // First line starts as soon as this opens: the tap that opened it unlocked audio.
  useEffect(() => {
    box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    line(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const l = lines[at];
  const chars = Array.from(l.ja);
  const cut = Math.round(lit * chars.length);

  if (done) {
    return (
      <div className="today along-card" ref={box}>
        <span className="kicker">跟着说</span>
        <p className="along-done">✓ {lines.length} 句都跟着说完了</p>
        <button className="today-go" onClick={() => start(0)}>
          再来一次
        </button>
        <button className="along-quit" onClick={close}>
          閉じる
        </button>
      </div>
    );
  }

  return (
    <div className="today along-card" ref={box}>
      <span className="kicker">
        一緒に言う · {at + 1} / {lines.length}
      </span>
      <div className="along-steps">
        {STEPS.map((s, i) => (
          <span key={s} className={i === step ? "now" : i < step ? "past" : ""}>
            {s}
          </span>
        ))}
      </div>
      <div className={`along-ja ${step === 2 ? "faded" : ""}`}>
        {step < 2 ? (
          <>
            <span className="lit">{chars.slice(0, cut).join("")}</span>
            {chars.slice(cut).join("")}
          </>
        ) : (
          l.ja
        )}
      </div>
      <div className="along-zh">{l.zh}</div>
      <div className="along-hint">
        {step === 0 ? "先听一遍" : step === 1 ? "跟着声音一起说" : "现在自己说一遍"}
        {step === 2 && <i key={`${at}-${alone}`} style={{ animationDuration: `${alone}ms` }} />}
      </div>
      <div className="along-row">
        <button onClick={() => start(at)}>再来一次</button>
        <button onClick={() => (at + 1 < lines.length ? start(at + 1) : (run.current++, stop(), setDone(true)))}>次 ›</button>
        <button onClick={close}>やめる</button>
      </div>
    </div>
  );
}
