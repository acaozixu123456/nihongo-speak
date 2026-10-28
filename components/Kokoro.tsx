"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { ANSWER_VOICE as VOICE } from "@/content/kokoro-patterns";
import { fixedParts, type KokoroItem, type KokoroSet } from "@/lib/kokoro-model";
import { LAPS, keepSet, lapClips, loadSet, markLap, markSaid, markStuck, readStuck, savedSet, type KClip } from "@/lib/client/kokoro";
import { prepare, pruneCache, type Prepared } from "@/lib/client/moyu";
import { SILENCE, play, stop as stopAudio, ttsUrl, unlock } from "@/lib/client/player";
import { dayKey, recordMoyu, recordSpeech, wavSeconds } from "@/lib/client/progress";
import { setAudioSession, transcribe } from "@/lib/client/recorder";
import { useJudge } from "./AiJudge";
import HoldButton from "./HoldButton";
import { VerdictSheet, kindOf, type Kind } from "./Verdict";

type Phase = "idle" | "loading" | "playing" | "paused";
type Now = { clip: KClip; end: number };

// 心で答える: six questions about the learner's own work and life, heard three times at work with the
// help taken away a lap at a time, answered in their head. Earbuds: previous = again (kept for the way
// home), next = 言えた. Questions gone back to are said out loud afterwards (帰り道).
export default function Kokoro() {
  const [set, setSet] = useState<KokoroSet | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [lap, setLap] = useState(0);
  const [now, setNow] = useState<Now | null>(null);
  const [t, setT] = useState(0);
  const [zh, setZh] = useState(false);
  const [stuck, setStuck] = useState(() => readStuck());
  const [home, setHome] = useState<KokoroItem | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const s = useRef({
    laps: [] as (Promise<Prepared> | null)[],
    cur: null as Prepared | null,
    lap: 0,
    idx: -1,
    tick: 0,
    sec: 0,
    off: false, // closed: the pause that follows mustn't bring the player back
  }).current;

  useEffect(() => {
    pruneCache();
    const day = dayKey();
    const have = savedSet(day);
    if (have) setSet(have);
    // The set may have been written again since this phone kept it (the morning routine came later): the
    // newer one replaces it while nothing of today's has been heard.
    loadSet(day).then(
      (fresh) => {
        const st = readStuck(day);
        if (have && (fresh.made === have.made || st.laps > 0 || Object.keys(st.ids).length || s.cur)) return;
        keepSet(fresh);
        s.laps = [];
        setSet(fresh);
      },
      (e) => !have && setError(e instanceof Error ? e.message : "出题失败"),
    );
    return () => {
      flush();
      audio.current?.pause();
      if (s.cur) URL.revokeObjectURL(s.cur.url);
      const ms = navigator.mediaSession;
      if (ms) for (const a of ["play", "pause", "previoustrack", "nexttrack"] as MediaSessionAction[]) ms.setActionHandler(a, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Laps already heard today are not heard again: 聞く goes on from the next one.
  const from = stuck.laps < LAPS ? stuck.laps : 0;

  // The lap to start with is made as soon as the questions are in, so 聞く starts at once.
  useEffect(() => {
    if (set && !s.laps[from]) lapAudio(from).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set]);

  function lapAudio(n: number) {
    if (!set) return Promise.reject(new Error("no set"));
    let p = s.laps[n];
    if (!p) {
      p = prepare(lapClips(set, n));
      p.catch(() => (s.laps[n] = null));
      s.laps[n] = p;
    }
    return p;
  }

  function flush() {
    if (s.sec >= 1) recordMoyu(Math.round(s.sec));
    s.sec = 0;
  }

  async function playLap(n: number) {
    s.lap = n;
    setLap(n);
    setPhase("loading");
    try {
      const prep = await lapAudio(n);
      const a = audio.current;
      if (!a) return;
      const old = s.cur;
      s.cur = prep;
      s.idx = -1;
      a.src = prep.url;
      a.play().catch((e) => setError(e instanceof Error ? e.message : "播放失败"));
      if (old && old !== prep) URL.revokeObjectURL(old.url);
      if (n + 1 < LAPS) lapAudio(n + 1).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "出错了");
      setPhase("idle");
    }
  }

  function start() {
    const a = audio.current!;
    // iPhone only lets this element play later if it first plays from the tap itself.
    a.src = SILENCE;
    a.play().catch(() => {});
    setAudioSession("playback");
    setError("");
    setupMediaSession();
    s.off = false;
    // A lap heard (or started) before has had its file let go; make it again.
    if (s.cur) s.laps = [];
    s.cur = null;
    playLap(from);
  }

  function close() {
    s.off = true;
    audio.current?.pause();
    flush();
    setStuck(readStuck());
    setPhase("idle");
    setNow(null);
  }

  function onEnded() {
    flush();
    markLap(s.lap + 1);
    setStuck(readStuck());
    if (s.lap + 1 < LAPS) {
      const done = s.cur;
      s.laps[s.lap] = null;
      playLap(s.lap + 1).then(() => done && URL.revokeObjectURL(done.url));
    } else {
      setPhase("idle");
      setNow(null);
    }
  }

  function onTime() {
    const a = audio.current!;
    const cur = s.cur;
    if (!cur || a.src !== cur.url) return;
    const time = a.currentTime;
    let i = 0;
    while (i + 1 < cur.starts.length && cur.starts[i + 1] <= time) i++;
    if (i !== s.idx) {
      s.idx = i;
      const clip = cur.clips[i] as KClip;
      setNow({ clip, end: cur.starts[i + 1] ?? cur.total });
      setZh(false);
      if (navigator.mediaSession && typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({ title: set?.items[clip.item]?.q ?? clip.show, artist: `${s.lap + 1}周目`, album: "心で答える" });
      }
    }
    setT(time);
    const ms = Date.now();
    const dt = (ms - s.tick) / 1000;
    s.tick = ms;
    if (!a.paused && dt > 0 && dt < 3) s.sec += dt;
    if (s.sec >= 30) flush();
  }

  function seekClip(i: number) {
    const a = audio.current;
    const cur = s.cur;
    if (!a || !cur) return;
    a.currentTime = i >= cur.clips.length ? Math.max(0, cur.total - 0.05) : cur.starts[i] + 0.01;
    if (a.paused) a.play().catch(() => {});
  }

  const clips = () => (s.cur?.clips ?? []) as KClip[];

  // Again: this question from the top, and it goes on the list for the way home.
  function again() {
    const list = clips();
    const c = list[s.idx];
    if (!c || !set) return;
    markStuck(set.items[c.item].id);
    setStuck(readStuck());
    seekClip(list.findIndex((x) => x.item === c.item));
  }

  // 言えた: straight to the answer, or on from the answer to the next question.
  function skip() {
    const list = clips();
    const c = list[s.idx];
    if (!c) return;
    const to = c.step === "answer" ? list.findIndex((x) => x.item === c.item + 1) : list.findIndex((x) => x.item === c.item && x.step === "answer");
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
    for (const a of ["seekbackward", "seekforward"] as MediaSessionAction[]) {
      try {
        ms.setActionHandler(a, null);
      } catch {}
    }
  }

  const day = dayKey();
  const date = `${Number(day.slice(5, 7))}.${day.slice(8)}`;
  const weekday = `${"日月火水木金土"[new Date().getDay()]}曜日`;
  const listening = phase !== "idle";
  // The way home: after the three laps, or after work once any lap was heard.
  const toSay = set && (stuck.laps >= LAPS || (stuck.laps > 0 && new Date().getHours() >= 17)) ? set.items.filter((it) => stuck.ids[it.id] && !stuck.done.includes(it.id)) : [];

  const audioEl = (
    <audio
      ref={audio}
      playsInline
      preload="auto"
      onEnded={() => s.cur && audio.current?.src === s.cur.url && onEnded()}
      onTimeUpdate={onTime}
      onPlaying={() => {
        if (s.off) return;
        s.tick = Date.now();
        if (s.cur && audio.current?.src === s.cur.url) setPhase("playing");
      }}
      onPause={() => {
        flush();
        if (!s.off && s.cur && audio.current?.src === s.cur.url && !audio.current.ended) setPhase("paused");
      }}
    />
  );

  let body: React.ReactNode;
  if (home && set) {
    body = (
      <HomeSay
        key={home.id}
        item={home}
        onNext={() => {
          markSaid(home.id);
          const st = readStuck();
          setStuck(st);
          setHome(set.items.find((it) => st.ids[it.id] && !st.done.includes(it.id)) ?? null);
        }}
      />
    );
  } else if (listening && set) {
    const c = now?.clip;
    const it = c ? set.items[c.item] : null;
    const left = now ? Math.max(0, Math.ceil(now.end - t)) : 0;
    const think = c?.step === "think" && it ? (now!.end - t) / (now!.end - (s.cur?.starts[s.idx] ?? 0)) : 0;
    body = (
      <>
        <div className="ko-top">
          <button className="ko-x" aria-label="閉じる" onClick={close}>×</button>
          <span className="ko-no">{c ? `${String(c.item + 1).padStart(2, "0")} / ${String(set.items.length).padStart(2, "0")}` : ""}</span>
          <span className={`ko-pill${c?.step === "answer" ? " ans" : lap === 2 ? " last" : ""}`}>{c?.step === "answer" ? "答え" : `${lap + 1}周目`}</span>
        </div>
        <div className="ko-dots" aria-hidden>
          {set.items.map((x, i) => (
            <i key={x.id} className={c && i < c.item ? "d" : c && i === c.item ? "n" : ""} />
          ))}
        </div>
        {it && c ? (
          c.step === "answer" ? (
            <>
              <div className="ko-q small">{it.q}</div>
              <p className="ko-ans">
                <Marked text={it.answer} item={it} />
                <Info open={zh} onToggle={() => setZh(!zh)} text={it.answer_zh} />
              </p>
            </>
          ) : (
            <>
              <h1 className="ko-q">
                {it.q}
                <Info open={zh} onToggle={() => setZh(!zh)} text={it.q_zh} />
              </h1>
              {lap === 0 && (
                <div className="ko-box">
                  <h4>型</h4>
                  {it.pattern.map((line) => (
                    <div className="ko-pat" key={line}>
                      {line.split("＿").map((piece, n) => (
                        <Fragment key={n}>
                          {n > 0 && <span className="ko-blank" aria-label="空欄" />}
                          {piece}
                        </Fragment>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {lap < 2 && (
                <div className="ko-box">
                  <h4>ことば</h4>
                  <div className="ko-chips">
                    {it.words.map((w) => (
                      <Chip key={w.ja} ja={w.ja} zh={w.zh} />
                    ))}
                  </div>
                </div>
              )}
              {c.step === "think" && (
                <div className="ko-ring" role="timer" aria-label={`心の中で答える 残り${left}秒`} style={{ ["--p" as string]: `${Math.round(think * 100)}%` }}>
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
          <button onClick={skip} aria-label="言えた">⏭<small>言えた</small></button>
        </div>
      </>
    );
  } else if (toSay.length && set) {
    body = (
      <>
        <Link href="/listen" className="back" aria-label="戻る">←</Link>
        <Mast title="帰り道" date={date} weekday={weekday} />
        {toSay.map((it, i) => (
          <button key={it.id} className={`ko-stuck${i ? " dim" : ""}`} onClick={() => setHome(it)}>
            <span>{it.q}</span>
            <b aria-label={`もう一回 ${stuck.ids[it.id]}回`}>⏮ {stuck.ids[it.id]}</b>
          </button>
        ))}
        <button className="ko-go ko-say" onClick={() => setHome(toSay[0])}>● 話す</button>
        {stuck.laps < LAPS && (
          <button className="ko-on" onClick={start}>▶ {from + 1}周目</button>
        )}
      </>
    );
  } else {
    const groups = set ? (["work", "life"] as const).map((k) => ({ k, items: set.items.filter((x) => x.kind === k) })).filter((g) => g.items.length) : [];
    body = (
      <>
        <Link href="/listen" className="back" aria-label="戻る">←</Link>
        <Mast title="心で答える" date={date} weekday={weekday} />
        {!set && !error && <div className="ko-wait" aria-label="作成中" />}
        {error && <p className="error">{error}</p>}
        {groups.map((g) => (
          <section key={g.k}>
            <div className="ko-sec">
              <b>{g.k === "work" ? "仕事" : "生活"}</b>
              <span />
            </div>
            {g.items.map((it) => (
              <div key={it.id} className="ko-row">
                <span className="ko-n">{String(set!.items.indexOf(it) + 1).padStart(2, "0")}</span>
                <span>{it.q}</span>
                {stuck.done.includes(it.id) && <i className="ko-ok" aria-label="話した">✓</i>}
              </div>
            ))}
          </section>
        ))}
        {set && (
          <button className="ko-go" onClick={start}>
            ▶ {stuck.laps >= LAPS ? "もう一度" : from ? `${from + 1}周目` : "聞く"}
          </button>
        )}
      </>
    );
  }

  // One <audio> for the whole page, always first: iPhone lets only the element played from the tap on
  // 聞く play later, so it must not be swapped for a new one when the screen changes.
  return (
    <main className="ko">
      {audioEl}
      {body}
    </main>
  );
}

// A word; tapped, its Chinese.
function Chip({ ja, zh }: { ja: string; zh: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button className="ko-chip" aria-label={`${ja} ${zh}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      {ja}
      {open && <span className="ko-tip">{zh}</span>}
    </button>
  );
}

function Mast({ title, date, weekday }: { title: string; date: string; weekday: string }) {
  return (
    <header className="mg-mast">
      <h1>{title}</h1>
      <div className="mg-issue">
        <b>{date}</b>
        {weekday}
      </div>
    </header>
  );
}

// The Chinese, only when asked for.
function Info({ open, onToggle, text }: { open: boolean; onToggle: () => void; text: string }) {
  return (
    <button className="ko-info" aria-label="中文" aria-expanded={open} onClick={onToggle}>
      i{open && <span className="ko-tip">{text}</span>}
    </button>
  );
}

// The model answer with the 型's fixed parts marked.
function Marked({ text, item }: { text: string; item: KokoroItem }) {
  const parts = [...new Set(item.pattern.flatMap(fixedParts))].sort((a, b) => b.length - a.length);
  if (!parts.length) return <>{text}</>;
  const re = new RegExp(`(${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return (
    <>
      {text.split(re).map((piece, i) => (i % 2 ? <span key={i} className="mg-hl ko-hl">{piece}</span> : piece))}
    </>
  );
}

// 帰り道: one question gone back to at work, now said out loud and checked against what it was asking for.
function HomeSay({ item, onNext }: { item: KokoroItem; onNext: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [heard, setHeard] = useState<string | null>(null);
  const [gave, setGave] = useState(false);
  const [zh, setZh] = useState(false);
  // Their own answer, not the model one: judged on answering the question in natural Japanese.
  const judge = useJudge(heard ? { zh: item.answer_zh, ja: item.answer, said: heard, q: item.q, form: item.pattern.join(" ") } : null);

  useEffect(() => () => stopAudio(), []);

  async function onRecorded(wav: Blob) {
    setBusy(true);
    setError("");
    try {
      const r = await transcribe(wav);
      recordSpeech(wavSeconds(wav));
      if (!r.text) return setError("聞き取れませんでした");
      setHeard(r.text);
    } catch {
      setError("聞き取れませんでした");
    } finally {
      setBusy(false);
    }
  }

  const hear = (text: string, rate = 1) => {
    unlock();
    play(ttsUrl(text, VOICE), rate).catch(() => {});
  };

  let kind: Kind | null = null;
  if (gave) kind = "wrong";
  else if (heard) kind = judge.data ? kindOf(judge.data.verdict) : judge.failed ? "close" : null;
  // Nearly right: what they said, put right. Otherwise the model answer, as one way to say it.
  const shown = kind === "close" && judge.data?.fixed ? judge.data.fixed : item.answer;

  return (
    <>
      <div className="ko-top">
        <span className="ko-no">帰り道</span>
      </div>
      <h1 className="ko-q">
        {item.q}
        <Info open={zh} onToggle={() => setZh(!zh)} text={item.q_zh} />
      </h1>
      {heard && <p className={`said said-${kind ?? "wait"}`}>{heard}</p>}
      {error && <p className="error">{error}</p>}
      {heard || gave ? (
        <VerdictSheet kind={kind} quiet={gave} ja={shown} voice={VOICE} why={judge.data} onHear={() => hear(shown, kind === "right" ? 1 : 0.85)} onNext={onNext} />
      ) : (
        <div className="dock" style={{ bottom: 0, zIndex: 20 }}>
          <div className="dock-inner">
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button onClick={() => setGave(true)} disabled={busy}>答え</button>
              <div style={{ flex: 1 }}>
                <HoldButton label={busy ? "聞き取り中…" : "● 話す"} disabled={busy} onRecorded={onRecorded} onError={setError} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
