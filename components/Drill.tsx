"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { fixedParts } from "@/lib/kokoro-model";
import type { Drill as DrillSet } from "@/lib/drill-model";
import { PASSES, currentForm, drillClips, keepForm, loadDrill, markDone, nextForm, timesDone, type DClip } from "@/lib/client/drill";
import { prepare, pruneCache, type Prepared } from "@/lib/client/moyu";
import { SILENCE } from "@/lib/client/player";
import { recordSpeech } from "@/lib/client/progress";
import { setAudioSession } from "@/lib/client/recorder";

type Phase = "idle" | "loading" | "playing" | "paused" | "done";
type Now = { clip: DClip; start: number; end: number };

// 型ドリル: one 型, a dozen of the learner's own sentences, twice through, said out loud from Chinese
// with no stop in between (a pattern drill). Earbuds: previous = this one again, next = on.
export default function Drill() {
  const [form, setForm] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillSet | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [now, setNow] = useState<Now | null>(null);
  const [t, setT] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const s = useRef({ prep: null as Promise<Prepared> | null, cur: null as Prepared | null, idx: -1, jumped: false, off: false }).current;

  useEffect(() => {
    pruneCache();
    setForm(currentForm());
    return () => {
      audio.current?.pause();
      if (s.cur) URL.revokeObjectURL(s.cur.url);
      const ms = navigator.mediaSession;
      if (ms) for (const a of ["play", "pause", "previoustrack", "nexttrack"] as MediaSessionAction[]) ms.setActionHandler(a, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The 型's sentences, then the round's sound made at once so 始める starts without a wait.
  useEffect(() => {
    if (!form) return;
    let gone = false;
    setDrill(null);
    setError("");
    keepForm(form);
    loadDrill(form).then(
      (d) => {
        if (gone) return;
        setDrill(d);
        roundAudio(d);
      },
      (e) => !gone && setError(e instanceof Error ? e.message : "出题失败"),
    );
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  function roundAudio(d: DrillSet) {
    if (!s.prep) {
      const p = prepare(drillClips(d));
      p.catch(() => s.prep === p && (s.prep = null));
      s.prep = p;
    }
    return s.prep;
  }

  async function start() {
    if (!drill) return;
    const a = audio.current!;
    // iPhone only lets this element play later if it first plays from the tap itself.
    a.src = SILENCE;
    a.play().catch(() => {});
    setAudioSession("playback");
    setError("");
    setupMediaSession();
    s.off = false;
    setPhase("loading");
    try {
      // A round heard before has had its file let go; make it again (from the phone's cache).
      if (s.cur) {
        s.prep = null;
        s.cur = null;
      }
      const prep = await roundAudio(drill);
      if (s.off) return;
      s.cur = prep;
      s.idx = -1;
      a.src = prep.url;
      a.play().catch((e) => setError(e instanceof Error ? e.message : "播放失败"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "出错了");
      setPhase("idle");
    }
  }

  function close() {
    s.off = true;
    audio.current?.pause();
    setPhase("idle");
    setNow(null);
  }

  function onEnded() {
    if (drill) markDone(drill.form);
    setPhase("done");
    setNow(null);
  }

  // Another 型: the one drilled least.
  function other() {
    if (!form) return;
    if (s.cur) URL.revokeObjectURL(s.cur.url);
    s.prep?.then((p) => URL.revokeObjectURL(p.url), () => {});
    s.prep = null;
    s.cur = null;
    setPhase("idle");
    setForm(nextForm([form]));
  }

  function onTime() {
    const a = audio.current!;
    const cur = s.cur;
    if (!cur || a.src !== cur.url) return;
    const time = a.currentTime;
    let i = 0;
    while (i + 1 < cur.starts.length && cur.starts[i + 1] <= time) i++;
    if (i !== s.idx) {
      // A sentence said out loud: the time given to say it, once it ran to the end.
      const was = cur.clips[s.idx] as DClip | undefined;
      if (was?.step === "say" && i === s.idx + 1 && !s.jumped) recordSpeech(Math.round((cur.starts[i] - cur.starts[s.idx]) * 10) / 10);
      s.jumped = false;
      s.idx = i;
      const clip = cur.clips[i] as DClip;
      setNow({ clip, start: cur.starts[i], end: cur.starts[i + 1] ?? cur.total });
      if (navigator.mediaSession && typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({ title: clip.show, artist: `${clip.pass + 1}周目`, album: "型ドリル" });
      }
    }
    setT(time);
  }

  function seekClip(i: number) {
    const a = audio.current;
    const cur = s.cur;
    if (!a || !cur) return;
    s.jumped = true;
    a.currentTime = i >= cur.clips.length ? Math.max(0, cur.total - 0.05) : cur.starts[i] + 0.01;
    if (a.paused) a.play().catch(() => {});
  }

  const clips = () => (s.cur?.clips ?? []) as DClip[];

  // This sentence again from its Chinese.
  function again() {
    const list = clips();
    const c = list[s.idx];
    if (!c) return;
    seekClip(list.findIndex((x) => x.pass === c.pass && x.item === c.item));
  }

  // On: from the Chinese to the model, from the model to the next sentence.
  function skip() {
    const list = clips();
    const c = list[s.idx];
    if (!c) return;
    const to = c.step === "model" ? s.idx + 1 : list.findIndex((x) => x.pass === c.pass && x.item === c.item && x.step === "model");
    seekClip(to < 0 ? list.length : to);
  }

  function toggle() {
    const a = audio.current!;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function setupMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    ms.setActionHandler("play", () => audio.current?.play().catch(() => {}));
    ms.setActionHandler("pause", () => audio.current?.pause());
    ms.setActionHandler("previoustrack", again);
    ms.setActionHandler("nexttrack", skip);
  }

  const audioEl = (
    <audio
      ref={audio}
      playsInline
      preload="auto"
      onEnded={() => s.cur && audio.current?.src === s.cur.url && onEnded()}
      onTimeUpdate={onTime}
      onPlaying={() => {
        if (!s.off && s.cur && audio.current?.src === s.cur.url) setPhase("playing");
      }}
      onPause={() => {
        if (!s.off && s.cur && audio.current?.src === s.cur.url && !audio.current.ended) setPhase("paused");
      }}
    />
  );

  const playing = phase === "playing" || phase === "paused" || phase === "loading";
  let body: React.ReactNode;
  if (playing && drill) {
    const c = now?.clip;
    const it = c ? drill.items[c.item] : null;
    const n = c ? clips().filter((x) => x.pass === c.pass && x.step === "cue").findIndex((x) => x.item === c.item) : -1;
    const left = now ? Math.max(0, Math.ceil(now.end - t)) : 0;
    const p = now && c?.step === "say" ? (now.end - t) / (now.end - now.start) : 0;
    body = (
      <>
        <div className="ko-top">
          <button className="ko-x" aria-label="閉じる" onClick={close}>×</button>
          <span className="ko-no">{c ? `${String(n + 1).padStart(2, "0")} / ${String(drill.items.length).padStart(2, "0")}` : ""}</span>
          <span className={`ko-pill${c?.step === "model" ? " ans" : c?.pass ? " last" : ""}`}>{c?.step === "model" ? "答え" : `${(c?.pass ?? 0) + 1}周目`}</span>
        </div>
        <div className="ko-dots" aria-hidden>
          {drill.items.map((_, i) => (
            <i key={i} className={c && i < n ? "d" : c && i === n ? "n" : ""} />
          ))}
        </div>
        {(!c || c.pass === 0) && <Pattern form={drill.pattern} small />}
        {it && c ? (
          c.step === "model" ? (
            <>
              <div className="ko-q small" lang="zh-Hans">{it.zh}</div>
              <p className="ko-ans dr-ja">
                <Marked text={it.ja} form={drill.pattern} />
              </p>
            </>
          ) : (
            <>
              <h1 className="ko-q" lang="zh-Hans">{it.zh}</h1>
              {c.step === "say" && (
                <div className="ko-ring" role="timer" aria-label={`言う 残り${left}秒`} style={{ ["--p" as string]: `${Math.round(p * 100)}%` }}>
                  <span>{left}</span>
                </div>
              )}
            </>
          )
        ) : (
          <div className="ko-wait" aria-label="準備中" />
        )}
        {error && <p className="error">{error}</p>}
        <div className="ko-dock">
          <button onClick={again} aria-label="もう一回">⏮<small>もう一回</small></button>
          <button className="ko-play" onClick={toggle} disabled={phase === "loading"} aria-label={phase === "playing" ? "一時停止" : "再生"}>
            {phase === "playing" ? "❚❚" : "▶"}
          </button>
          <button onClick={skip} aria-label="次へ">⏭<small>次へ</small></button>
        </div>
      </>
    );
  } else {
    const done = phase === "done";
    const times = form ? timesDone(form) : 0;
    body = (
      <>
        <Link href="/speak" className="back" aria-label="戻る">←</Link>
        <header className="mg-mast">
          <h1>型ドリル</h1>
          {times > 0 && (
            <div className="mg-issue">
              <b>{times}</b>回
            </div>
          )}
        </header>
        {drill && <Pattern form={drill.pattern} zh={drill.zh} />}
        {!drill && !error && <div className="ko-wait" aria-label="作成中" />}
        {error && <p className="error">{error}</p>}
        {done && drill && (
          <>
            <p className="dr-done">
              <i aria-hidden>✓</i> {drill.items.length * PASSES}文
            </p>
            {drill.items.map((it, i) => (
              <div key={i} className="ko-row">
                <span className="ko-n">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <Marked text={it.ja} form={drill.pattern} />
                  <small className="dr-zh" lang="zh-Hans">{it.zh}</small>
                </span>
              </div>
            ))}
          </>
        )}
        {drill && (done ? (
          <>
            <button className="ko-go" onClick={other}>＋ 次の型</button>
            <button className="ko-on" onClick={start}>▶ もう一度</button>
          </>
        ) : (
          <>
            <button className="ko-go" onClick={start}>▶ 始める</button>
            <button className="ko-on" onClick={other}>↻ 別の型</button>
          </>
        ))}
      </>
    );
  }

  // One <audio> for the whole page, always first: iPhone lets only the element played from the tap
  // on 始める play later.
  return (
    <main className="ko">
      {audioEl}
      {body}
    </main>
  );
}

function Pattern({ form, zh, small }: { form: string; zh?: string; small?: boolean }) {
  return (
    <div className={`ko-box${small ? " dr-small" : ""}`}>
      <h4>型</h4>
      <div className="ko-pat">
        {form.split("＿").map((piece, n) => (
          <Fragment key={n}>
            {n > 0 && <span className="ko-blank" aria-label="空欄" />}
            {piece}
          </Fragment>
        ))}
      </div>
      {zh && <p className="ko-zh" lang="zh-Hans">{zh}</p>}
    </div>
  );
}

// The sentence with the 型's fixed parts marked.
function Marked({ text, form }: { text: string; form: string }) {
  const parts = fixedParts(form).sort((a, b) => b.length - a.length);
  if (!parts.length) return <>{text}</>;
  const re = new RegExp(`(${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return (
    <>
      {text.split(re).map((piece, i) => (i % 2 ? <span key={i} className="mg-hl ko-hl">{piece}</span> : piece))}
    </>
  );
}
