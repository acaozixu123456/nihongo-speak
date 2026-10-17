"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Explain } from "@/lib/claude";
import { radioClips, type Clip, type ClipState, type RadioPart } from "@/lib/client/moyu";
import { mixRadio, type Mixed } from "@/lib/client/radio-mix";
import { play, preload, SILENCE, ttsUrl, unlock } from "@/lib/client/player";
import { findEpisode, markHeard, RADIO_VOICE, saveAsked, useProgress } from "@/lib/client/progress";
import { setAudioSession } from "@/lib/client/recorder";
import { useHydrated } from "@/lib/client/hydrated";
import Earworm from "./Earworm";
import { hasSavedSet, prefetchGame } from "./Game";
import { Star } from "./FeedbackCard";
import { shortDate } from "./Episodes";
import { stepDone } from "@/lib/client/route";

type Tab = "script" | "phrases" | "words" | "grammar";
const TABS: { key: Tab; label: string }[] = [
  { key: "script", label: "文稿" },
  { key: "phrases", label: "重点句" },
  { key: "words", label: "单词" },
  { key: "grammar", label: "语法" },
];
const HOST_NAME = { A: "ハル", B: "ケン" } as const;
const PART_NAME: Record<RadioPart, string> = { open: "開幕", letter: "お便り", main: "本題", word: "ひとこと", song: "歌" };

type Phase = "idle" | "loading" | "playing" | "paused";
const ZH_KEY = "nihongo-speak:ep-zh";
const RATE_KEY = "nihongo-speak:ep-rate";
// Slower speeds for when the hosts run too fast to follow.
const RATES = [1, 0.85, 0.7];

// Cover pictures being drawn, so opening the page twice doesn't ask twice.
const drawing: Record<string, Promise<boolean>> = {};

// What the learner selected, with the line it sits in, for 问 AI.
type Pick = { text: string; line: string; before?: string };

// One 趣味电台 episode: play it straight through (the line being spoken lights up in the transcript),
// then the notes the AI wrote with it: key sentences (already in review), words and grammar.
export default function Episode({ id }: { id: string }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const ep = hydrated ? findEpisode(p, id) : undefined;
  const audio = useRef<HTMLAudioElement>(null);
  const prep = useRef<Mixed | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(-1);
  const [pos, setPos] = useState(0);
  const [tab, setTab] = useState<Tab>("script");
  const [showZh, setShowZhState] = useState(false);
  const [rate, setRateState] = useState(1);
  const [error, setError] = useState("");
  // How each clip is getting on while the episode's audio is being made.
  const [made, setMade] = useState<{ clips: Clip[]; at: ClipState[] } | null>(null);
  const notes = useRef<HTMLDivElement>(null);
  const touched = useRef(0);
  const [pick, setPick] = useState<Pick | null>(null);
  const [ask, setAsk] = useState<{ pick: Pick; answer?: Explain; error?: string } | null>(null);

  useEffect(() => {
    try {
      setShowZhState(localStorage.getItem(ZH_KEY) === "1");
      const r = Number(localStorage.getItem(RATE_KEY));
      if (RATES.includes(r)) setRateState(r);
    } catch {}
    // Scrolling by hand pauses the follow-along for a few seconds.
    const hand = () => (touched.current = Date.now());
    window.addEventListener("touchmove", hand, { passive: true });
    window.addEventListener("wheel", hand, { passive: true });
    // Selecting text anywhere in the notes offers 问 AI about it. Tapping the button can clear the
    // selection first, so the offer stays up a moment after it goes.
    let clear: ReturnType<typeof setTimeout> | undefined;
    const onSelect = () => {
      const sel = document.getSelection();
      const text = sel?.toString().trim() ?? "";
      const node = sel?.anchorNode;
      const el = node ? (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-line]") : null;
      if (text && el && notes.current?.contains(el)) {
        clearTimeout(clear);
        setPick({ text: text.slice(0, 300), line: el.dataset.line!, before: el.dataset.before || undefined });
      } else {
        clearTimeout(clear);
        clear = setTimeout(() => setPick(null), 1500);
      }
    };
    document.addEventListener("selectionchange", onSelect);
    return () => {
      window.removeEventListener("touchmove", hand);
      window.removeEventListener("wheel", hand);
      document.removeEventListener("selectionchange", onSelect);
      clearTimeout(clear);
      audio.current?.pause();
      if (prep.current) URL.revokeObjectURL(prep.current.url);
    };
  }, []);

  const now = prep.current && at >= 0 ? prep.current.clips[at] : null;
  const speaking = now?.show ?? null;

  // Keep the line being spoken in view, unless the learner is scrolling around themselves.
  useEffect(() => {
    if (!speaking || !open || Date.now() - touched.current < 4000) return;
    notes.current?.querySelector<HTMLElement>(".sline.now")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [speaking, open]);

  // Opening a notes tab fetches its sentences and words, so a tap plays at once.
  useEffect(() => {
    if (!ep || tab === "script") return;
    const lines =
      tab === "phrases" ? ep.phrases.map((x) => x.ja) : tab === "words" ? (ep.words ?? []).map((x) => x.ja) : (ep.grammar ?? []).map((x) => x.ja);
    preload(lines.map((ja) => ttsUrl(ja, RADIO_VOICE.A)));
  }, [ep, tab]);

  // 练一练 takes a while to write, so it starts as soon as the page opens.
  const epId = ep?.id;
  useEffect(() => {
    if (epId) prefetchGame(p, findEpisode(p, epId)!);
    // Once per episode: later changes (a new 问 AI) are picked up by the round itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epId]);

  // The cover picture: already drawn, or drawn now (once; it takes a little while).
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    if (!epId) return;
    let gone = false;
    const url = `/api/earworm/${epId}/cover.png`;
    (async () => {
      try {
        if (!(await fetch(url)).ok) {
          drawing[epId] ??= fetch("/api/cover", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: epId, episode: findEpisode(p, epId) }),
          }).then((r) => r.ok);
          if (!(await drawing[epId])) return;
        }
        if (!gone) setCover(url);
      } catch {}
    })();
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epId]);

  // The example in an AI answer, ready for when it's tapped.
  const example = ask?.answer?.example.ja;
  useEffect(() => {
    if (example) preload([ttsUrl(example, RADIO_VOICE.A)]);
  }, [example]);

  if (!hydrated) return <main className="page" />;
  if (!ep) {
    return (
      <main className="page">
        <Link href="/" className="back">← 今日</Link>
        <p className="muted">找不到这一期了（只保留最近 50 期）。</p>
      </main>
    );
  }
  const episode = ep;

  function setShowZh(on: boolean) {
    setShowZhState(on);
    try {
      localStorage.setItem(ZH_KEY, on ? "1" : "0");
    } catch {}
  }

  function setRate(r: number) {
    setRateState(r);
    const a = audio.current;
    if (a) a.playbackRate = a.defaultPlaybackRate = r;
    try {
      localStorage.setItem(RATE_KEY, String(r));
    } catch {}
  }

  // Back to the start of the line being spoken; tapped again right away, the line before it.
  function jump(by: -1 | 1) {
    const cur = prep.current;
    const a = audio.current;
    if (!cur || !a) return;
    let i = 0;
    while (i + 1 < cur.starts.length && cur.starts[i + 1] <= a.currentTime) i++;
    if (by < 0 && a.currentTime - cur.starts[i] < 1.2) i--;
    if (by > 0) i++;
    i = Math.max(0, Math.min(cur.starts.length - 1, i));
    a.currentTime = cur.starts[i] + 0.01;
    if (a.paused) a.play().catch(() => {});
  }

  // Lock screen and earphone buttons: the episode's title, and previous / next line.
  function lockScreen() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      ms.metadata = new MediaMetadata({ title: episode.title_zh, artist: "趣味电台" });
      ms.setActionHandler("previoustrack", () => jump(-1));
      ms.setActionHandler("nexttrack", () => jump(1));
    } catch {}
  }

  async function askAi(p: Pick) {
    setAsk({ pick: p });
    setPick(null);
    document.getSelection()?.removeAllRanges();
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pick: p.text, line: p.line, before: p.before, topic: episode.title_zh.slice(0, 80) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI 出错了");
      setAsk((a) => (a?.pick === p ? { pick: p, answer: data as Explain } : a));
      // Kept with the episode so 练一练 can practise it.
      saveAsked(episode.id, { text: p.text, meaning_zh: (data as Explain).meaning_zh });
    } catch (e) {
      setAsk((a) => (a?.pick === p ? { pick: p, error: e instanceof Error ? e.message : "AI 出错了" } : a));
    }
  }

  async function toggle() {
    const a = audio.current!;
    if (phase === "loading") return;
    if (prep.current) return a.paused ? void a.play().catch(() => {}) : a.pause();
    // iPhone only lets this element play later if it first plays from the tap itself.
    a.src = SILENCE;
    a.play().catch(() => {});
    setAudioSession("playback");
    setError("");
    setPhase("loading");
    try {
      const clips = radioClips(episode, false);
      setMade({ clips, at: clips.map(() => ({ at: "wait" })) });
      const ready = await mixRadio(episode, (i, st) =>
        setMade((m) => (m && m.clips === clips ? { clips, at: m.at.map((x, j) => (j === i ? st : x)) } : m)),
      );
      prep.current = ready;
      a.src = ready.url;
      a.playbackRate = a.defaultPlaybackRate = rate;
      lockScreen();
      await a.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "播放失败");
      setPhase("idle");
    }
  }

  function onTime() {
    const a = audio.current!;
    const cur = prep.current;
    if (!cur || a.src !== cur.url) return;
    let i = 0;
    while (i + 1 < cur.starts.length && cur.starts[i + 1] <= a.currentTime) i++;
    setAt(i);
    setPos(a.currentTime / cur.total);
  }

  // Tap a line to jump there (once the audio is ready).
  function seekLine(ja: string) {
    const cur = prep.current;
    const a = audio.current;
    // A long press that selected text isn't a tap.
    if (!cur || !a || document.getSelection()?.toString()) return;
    const i = cur.clips.findIndex((c) => c.show === ja);
    if (i < 0) return;
    a.currentTime = cur.starts[i] + 0.01;
    if (a.paused) a.play().catch(() => {});
  }

  function say(ja: string) {
    audio.current?.pause();
    unlock();
    play(ttsUrl(ja, RADIO_VOICE.A)).catch(() => {});
  }

  const scenarioId = `radio:${ep.id}`;

  // Progress while the audio is being made, and anything worth saying about it afterwards.
  const loading = phase === "loading" && made;
  const finished = made?.at.filter((x) => x.at === "done" || x.at === "fail").length ?? 0;
  const stateOf = (ja: string) => {
    const i = made?.clips.findIndex((c) => c.show === ja) ?? -1;
    return i >= 0 ? made!.at[i] : undefined;
  };
  const where = (i: number) => {
    const c = made!.clips[i];
    const n = ep.lines.findIndex((l) => l.ja === c.show);
    if (n >= 0) return `第 ${n + 1} 句`;
    if (!c.line) return i === 0 || c.part ? "开场" : "结尾提问";
    return "重点句";
  };
  const trouble = made?.at.findIndex((x) => x.at === "retry" || x.at === "slow") ?? -1;
  const fallbackN = made?.at.filter((x) => x.at === "done" && x.fallback).length ?? 0;
  const failN = made?.at.filter((x) => x.at === "fail").length ?? 0;

  // Who is talking, which corner of the show this is, and how far into each corner.
  const k = ep.hitokoto;
  const who = now?.line ? (now.line.voice === RADIO_VOICE.A ? "A" : "B") : now?.sub === "ハル" ? "A" : now?.sub === "ケン" ? "B" : null;
  const before = prep.current && at > 0 ? prep.current.clips[at - 1]?.show : null;
  const total = prep.current?.total ?? 0;
  const chapters: { part: RadioPart; at: number; to: number }[] = prep.current?.chapters.length
    ? prep.current.chapters.map((c, i, all) => ({ ...c, to: all[i + 1]?.at ?? total }))
    : k
      ? (["open", "letter", "main", "word"] as const).map((part) => ({ part, at: 0, to: 0 }))
      : [];
  const nowSec = pos * total;
  const playingNow = phase === "playing";

  return (
    <main className="page">
      <Link href="/" className="back">← 今日</Link>
      <div className="kicker">
        {k ? "ゆるっと日本ラジオ" : "趣味电台"} · {shortDate(ep.date)}
      </div>
      <div className={`radio-cover ${cover ? "drawn" : ""}`} style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
        {!cover && <h1 className="radio-title">{ep.title_zh}</h1>}
        <div className={`radio-waves ${playingNow ? "on" : ""}`} aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <div className="radio-hosts">
          <span className={`han ${playingNow && who === "A" ? "on" : ""}`}>春</span>
          <span className={`han ${playingNow && who === "B" ? "on" : ""}`}>健</span>
        </div>
      </div>
      {cover && <h1 className="radio-title under">{ep.title_zh}</h1>}

      {done && k ? (
        <div className="hitokoto">
          <div className="hk-k">今日のひとこと</div>
          <div className="hk-when">{k.when_ja}</div>
          <button className="hk-ja" onClick={() => say(k.ja)}>
            {k.ja}
          </button>
          <div className="hk-zh">{k.zh}</div>
          <Link href={`/ep/${ep.id}/game`} className="hk-go">
            练一练
          </Link>
        </div>
      ) : (
        <div className="radio-now">
          {loading ? (
            <div className="radio-prev">
              正在制作声音
              <span className="count">
                {finished} / {made.clips.length}
              </span>
            </div>
          ) : (
            before && <div className="radio-prev">{before}</div>
          )}
          {speaking && !loading ? (
            <>
              <div className="radio-who">
                {now?.part === "song" ? "洗脑歌" : who ? HOST_NAME[who] : ""}
                {now?.part === "letter" && ep.letter ? " · 读你的来信" : ""}
              </div>
              <div className="radio-line">{speaking}</div>
              {now?.part === "letter" && ep.letter && <span className="radio-tip">来信是你最近说错的一句：{ep.letter.said}</span>}
            </>
          ) : (
            <div className="radio-hook">{ep.hook_zh}</div>
          )}
        </div>
      )}

      {chapters.length > 0 ? (
        <div className="chap">
          {chapters.map((c) => {
            const len = c.to - c.at;
            const fill = loading ? 0 : len > 0 ? Math.max(0, Math.min(1, (nowSec - c.at) / len)) : 0;
            const cur = len > 0 && nowSec >= c.at && nowSec < c.to;
            return (
              <button
                key={c.part}
                className={cur ? "cur" : ""}
                style={{ flex: len > 0 ? Math.max(0.6, len / 30) : 1 }}
                onClick={() => len > 0 && audio.current && ((audio.current.currentTime = c.at + 0.01), audio.current.paused && audio.current.play().catch(() => {}))}
              >
                <s>
                  <u style={{ width: `${fill * 100}%` }} />
                </s>
                <span>{PART_NAME[c.part]}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={`track ${loading ? "making" : ""}`}>
          <div style={{ width: `${(loading ? finished / made.clips.length : pos) * 100}%` }} />
        </div>
      )}
      {loading && chapters.length > 0 && (
        <div className="track making">
          <div style={{ width: `${(finished / made.clips.length) * 100}%` }} />
        </div>
      )}

      <div className="radio-ctrl">
        <button className="player-tool" onClick={() => jump(-1)} disabled={!prep.current} aria-label="再听这一句">
          重听
        </button>
        <button className="radio-play" onClick={toggle} aria-label={playingNow ? "暂停" : "播放"}>
          {phase === "loading" ? <span className="spin" /> : playingNow ? "❚❚" : "▶"}
        </button>
        <button className="player-tool" onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])} aria-label="播放速度">
          {rate}×
        </button>
      </div>
      {loading && trouble >= 0 && (
        <p className="making-note warn-note" key={trouble}>
          <i />
          {made.at[trouble].at === "retry"
            ? `${where(trouble)}第一次没做成，正在第 ${(made.at[trouble] as { n: number }).n} 次尝试`
            : `${where(trouble)}有点慢，已经同时换一路在做`}
        </p>
      )}
      {!loading && made && (fallbackN > 0 || failN > 0) && (
        <p className="making-note">
          <i />
          {[
            fallbackN > 0 && `${fallbackN} 句当时 Gemini 没响应，临时用了备用声音，下次打开会重新做`,
            failN > 0 && `${failN} 句没做出来，已跳过`,
          ]
            .filter(Boolean)
            .join("；")}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <Earworm ep={ep} />

      <div className="radio-rows">
        <button className="radio-row" onClick={() => setOpen(!open)}>
          <span>文稿</span>
          <em>{open ? "收起" : "›"}</em>
        </button>
        <Link href={`/ep/${ep.id}/game`} className="radio-row">
          <span>
            练一练{ep.asked?.length ? <small> · 含你问过 AI 的 {ep.asked.length} 处</small> : null}
          </span>
          <em>›</em>
        </Link>
        {hasSavedSet(ep.id) && (
          <Link href={`/ep/${ep.id}/game?again`} className="radio-row">
            <span>再练上次那套</span>
            <em>›</em>
          </Link>
        )}
      </div>

      {open && (
      <div ref={notes}>
      <div className="seg">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "script" && (
        <>
          <div className="row spread note-head">
            <span>{ep.lines.length} 句 · 点一句跳过去，长按选中问 AI</span>
            <button className="small ghost" onClick={() => setShowZh(!showZh)}>
              {showZh ? "隐藏中文" : "显示中文"}
            </button>
          </div>
          <div className="script">
            {ep.lines.map((l, i) => (
              <div
                key={i}
                className={`sline ${speaking === l.ja ? "now" : ""} ${loading && ["wait", "work"].includes(stateOf(l.ja)?.at ?? "") ? "pending" : ""}`}
                onClick={() => seekLine(l.ja)}
                data-line={l.ja}
                data-before={ep.lines[i - 1]?.ja ?? ""}
              >
                <span className={`who who-${l.who}`}>{HOST_NAME[l.who]}</span>
                <div>
                  <div className="ja">{l.ja}</div>
                  {showZh && <div className="zh">{l.zh}</div>}
                  <Mark st={stateOf(l.ja)} live={!!loading} />
                </div>
              </div>
            ))}
          </div>
          {ep.quiz_zh && (
            <p className="quiz">
              <span>想一想</span>
              {ep.quiz_zh}
            </p>
          )}
        </>
      )}

      {tab === "phrases" && (
        <>
          <p className="note-head">这几句已经放进复习，明天开始会让你说出来。</p>
          {ep.phrases.map((ph) => (
            <div key={ph.ja} className="note" data-line={ph.ja}>
              <div className="note-main" onClick={() => say(ph.ja)}>
                <div className="ja">{ph.ja}</div>
                <div className="zh">{ph.zh}</div>
              </div>
              <Star p={p} ja={ph.ja} zh={ph.zh} voice={RADIO_VOICE.A} scenarioId={scenarioId} />
            </div>
          ))}
        </>
      )}

      {tab === "words" && (
        <>
          <p className="note-head">点单词听发音，想记的点收藏进复习。</p>
          {(ep.words ?? []).map((w) => (
            <div key={w.ja} className="note" data-line={w.ja}>
              <div className="note-main" onClick={() => say(w.ja)}>
                <div className="ja">
                  {w.ja}
                  <span className="kana"> {w.kana}</span>
                </div>
                <div className="zh">{w.zh}</div>
              </div>
              <Star p={p} ja={w.ja} reading={w.kana} zh={w.zh} voice={RADIO_VOICE.A} scenarioId={scenarioId} />
            </div>
          ))}
          {!ep.words?.length && <p className="muted">这一期是旧版生成的，没有单词表。</p>}
        </>
      )}

      {tab === "grammar" && (
        <>
          {(ep.grammar ?? []).map((g) => (
            <div key={g.pattern} className="note gram" data-line={g.ja}>
              <div className="note-main">
                <div className="gram-pattern">{g.pattern}</div>
                <div className="zh">{g.zh}</div>
                <div className="gram-ex" onClick={() => say(g.ja)}>
                  {g.ja}
                </div>
              </div>
            </div>
          ))}
          {!ep.grammar?.length && <p className="muted">这一期是旧版生成的，没有语法整理。</p>}
        </>
      )}

      </div>
      )}

      {pick && !ask && (
        <button className="ask-bar" onClick={() => askAi(pick)}>
          <b>问 AI</b>
          <span>{pick.text}</span>
        </button>
      )}
      {ask && <AskSheet ask={ask} onClose={() => setAsk(null)} onSay={say} />}

      <audio
        ref={audio}
        playsInline
        preload="auto"
        onTimeUpdate={onTime}
        onPlaying={() => {
          if (!prep.current || audio.current?.src !== prep.current.url) return;
          setPhase("playing");
          setDone(false);
        }}
        onPause={() => prep.current && audio.current?.src === prep.current.url && !audio.current.ended && setPhase("paused")}
        onEnded={() => {
          if (!prep.current || audio.current?.src !== prep.current.url) return;
          setPhase("paused");
          setDone(true);
          markHeard(episode.id);
          stepDone();
        }}
      />
    </main>
  );
}

function AskSheet({
  ask,
  onClose,
  onSay,
}: {
  ask: { pick: Pick; answer?: Explain; error?: string };
  onClose: () => void;
  onSay: (ja: string) => void;
}) {
  const a = ask.answer;
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="kicker">问 AI</div>
        <div className="sheet-pick">{ask.pick.text}</div>
        {a?.reading && a.reading !== ask.pick.text && <div className="kana">{a.reading}</div>}
        {!a && !ask.error && <p className="muted sheet-wait">AI 正在看这一句…</p>}
        {ask.error && <p className="error">{ask.error}</p>}
        {a && (
          <>
            <p className="sheet-meaning">{a.meaning_zh}</p>
            {a.points.map((pt) => (
              <div key={pt.ja} className="sheet-point">
                <b>{pt.ja}</b>
                <span>{pt.zh}</span>
              </div>
            ))}
            {a.nuance_zh && <p className="sheet-nuance">{a.nuance_zh}</p>}
            <div className="sheet-ex" onClick={() => onSay(a.example.ja)}>
              <div className="ja">{a.example.ja}</div>
              <div className="zh">{a.example.zh}</div>
            </div>
          </>
        )}
        <button className="cta" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  );
}

// A line's audio status, shown while it's being made (and afterwards only if something went wrong).
function Mark({ st, live }: { st?: ClipState; live: boolean }) {
  if (!st) return null;
  const label =
    st.at === "work"
      ? live && "制作中"
      : st.at === "slow"
        ? "有点慢，换一路同时在做"
        : st.at === "retry"
          ? `第一次没成功 · 第 ${st.n} 次尝试`
          : st.at === "fail"
            ? "没做出来，已跳过"
            : st.at === "done" && st.fallback
              ? "备用声音"
              : null;
  if (!label) return null;
  return <span className={`mk mk-${st.at === "done" ? "fallback" : st.at}`}>{label}</span>;
}
