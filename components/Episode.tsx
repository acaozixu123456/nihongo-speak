"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { makingText, newsRadio, radioClips, useRadioMaking, type Clip, type ClipState, type RadioPart } from "@/lib/client/moyu";
import { newsItems } from "@/lib/client/news";
import { mixRadio, type Mixed } from "@/lib/client/radio-mix";
import { play, preload, SILENCE, ttsUrl, unlock } from "@/lib/client/player";
import { easyLine, ensureEasy, ensureReadings, ensureTitleJa, findEpisode, hasEasy, markHeard, RADIO_VOICE, useProgress } from "@/lib/client/progress";
import { setAudioSession } from "@/lib/client/recorder";
import { useHydrated } from "@/lib/client/hydrated";
import Earworm from "./Earworm";
import { hasSavedSet, prefetchGame } from "./Game";
import { Star } from "./FeedbackCard";
import { shortDate } from "./Episodes";
import { nextHref, stepDone } from "@/lib/client/route";

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
// Old episodes whose easy versions were asked for on this visit (asked once, even if it failed).
const easyAsked = new Set<string>();

// /ep/new: today's route started before its episode was written. Waits for it, then opens it
// (or, if it can't be written, the route's next stop).
export function NewEpisode() {
  const router = useRouter();
  const making = useRadioMaking();
  useEffect(() => {
    let gone = false;
    // /ep/new?news=<id>: an episode where the hosts talk over this morning's article.
    const id = new URLSearchParams(location.search).get("news");
    const a = id && newsItems().find((x) => x.id === id);
    if (a) {
      newsRadio(a).then(
        (ep) => !gone && router.replace(`/ep/${ep.id}`),
        () => !gone && router.replace("/"),
      );
      return () => {
        gone = true;
      };
    }
    nextHref().then((h) => !gone && router.replace(h));
    return () => {
      gone = true;
    };
  }, [router]);
  return (
    <main className="page">
      <Link href="/" className="back">← 听</Link>
      <p className="muted game-wait">
        <span className="spin" /> {making ? makingText(making) : "新しい回を作っています"}
      </p>
    </main>
  );
}

// One 趣味电台 episode: play it straight through (the line being spoken lights up in the transcript),
// then the notes the AI wrote with it: key sentences (already in review), words and grammar.
export default function Episode({ id }: { id: string }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const ep = hydrated ? findEpisode(p, id) : undefined;
  useEffect(() => {
    if (!ep) return;
    ensureTitleJa(ep);
    ensureReadings(ep);
    if (!hasEasy(ep) && !easyAsked.has(ep.id)) {
      easyAsked.add(ep.id);
      ensureEasy(ep);
    }
  }, [ep]);
  const audio = useRef<HTMLAudioElement>(null);
  const prep = useRef<Mixed | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(-1);
  // The furthest line reached, so going back to hear a line again keeps the ones after it.
  const [far, setFar] = useState(-1);
  const [pos, setPos] = useState(0);
  const [tab, setTab] = useState<Tab>("script");
  const [showZh, setShowZhState] = useState(false);
  const [rate, setRateState] = useState(1);
  // やさしく: lines (by index in the script) long-pressed and shown in easy Japanese, the ones being
  // made, and a short note when a line is easy enough already or couldn't be made.
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [making, setMaking] = useState<Set<number>>(new Set());
  const [easyNote, setEasyNote] = useState<{ i: number; text: string } | null>(null);
  // The line being spoken has been scrolled out of view.
  const [away, setAway] = useState(false);
  const chat = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  // How each clip is getting on while the episode's audio is being made.
  const [made, setMade] = useState<{ clips: Clip[]; at: ClipState[] } | null>(null);
  const notes = useRef<HTMLDivElement>(null);
  const touched = useRef(0);
  // Set once the page is left, so audio still being mixed then isn't played anywhere.
  const left = useRef(false);

  useEffect(() => {
    left.current = false;
    try {
      setShowZhState(localStorage.getItem(ZH_KEY) === "1");
      const r = Number(localStorage.getItem(RATE_KEY));
      if (RATES.includes(r)) setRateState(r);
    } catch {}
    // Scrolling by hand pauses the follow-along for a few seconds.
    const hand = () => (touched.current = Date.now());
    window.addEventListener("touchmove", hand, { passive: true });
    window.addEventListener("wheel", hand, { passive: true });
    return () => {
      window.removeEventListener("touchmove", hand);
      window.removeEventListener("wheel", hand);
      left.current = true;
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

  // 长按一句 → やさしく (from the 问 AI bar): that line in easy Japanese, made now if it has none yet.
  const lineEp = ep?.id;
  useEffect(() => {
    if (!lineEp) return;
    const id = lineEp;
    const onEasy = async (e: Event) => {
      const ja = (e as CustomEvent<string>).detail;
      const i = findEpisode(p, id)?.lines.findIndex((l) => l.ja === ja) ?? -1;
      if (i < 0) return;
      setEasyNote(null);
      setMaking((m) => new Set(m).add(i));
      const easy = await easyLine(id, i);
      setMaking((m) => {
        const n = new Set(m);
        n.delete(i);
        return n;
      });
      if (easy) setFlipped((f) => new Set(f).add(i));
      else setEasyNote({ i, text: easy === "" ? "这句已经很简单了" : "没做出来，再试一次" });
    };
    window.addEventListener("ask-easy", onEasy);
    return () => window.removeEventListener("ask-easy", onEasy);
    // p is read when the event comes; only the episode matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineEp]);

  // The chat follows the newest line, unless the learner scrolled back to read; then a button
  // brings them back to it.
  useEffect(() => {
    const el = chat.current?.querySelector<HTMLElement>(".msg.cur");
    if (!el) return;

    const seen = new IntersectionObserver(([e]) => setAway(!e.isIntersecting), { rootMargin: "-120px 0px -150px 0px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [at, open]);

  // Whenever the chat changes size (a new line, a bubble growing to full size, やさしく switched),
  // the line being said is brought back above the player.
  const started0 = phase !== "idle";
  useEffect(() => {
    const box = chat.current;
    if (!box || open) return;
    const follow = new ResizeObserver(() => {
      const el = box.querySelector<HTMLElement>(".msg.cur");
      if (el && Date.now() - touched.current > 4000) aboveDock(el);
    });
    follow.observe(box);
    return () => follow.disconnect();
  }, [started0, open]);

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

  if (!hydrated) return <main className="page" />;
  if (!ep) {
    return (
      <main className="page">
        <Link href="/" className="back">← 听</Link>
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

  function flip(i: number) {
    setFlipped((f) => {
      const n = new Set(f);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }

  function backToNow() {
    touched.current = 0;
    const el = chat.current?.querySelector<HTMLElement>(".msg.cur");
    if (el) aboveDock(el);
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
      if (left.current) return URL.revokeObjectURL(ready.url);
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
    setFar((f) => Math.max(f, i));
    setPos(a.currentTime / cur.total);
  }

  // Tap a line to jump there (once the audio is ready).
  function seekLine(ja: string) {
    const i = prep.current?.clips.findIndex((c) => c.show === ja) ?? -1;
    if (i >= 0) seekClip(i);
  }

  function seekClip(i: number) {
    const cur = prep.current;
    const a = audio.current;
    // A long press that selected text isn't a tap.
    if (!cur || !a || document.getSelection()?.toString()) return;
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

  // Which corner of the show this is, and how far into each corner.
  const k = ep.hitokoto;
  const total = prep.current?.total ?? 0;
  const chapters: { part: RadioPart; at: number; to: number }[] = prep.current?.chapters.length
    ? prep.current.chapters.map((c, i, all) => ({ ...c, to: all[i + 1]?.at ?? total }))
    : k
      ? (["open", "letter", "main", "word"] as const).map((part) => ({ part, at: 0, to: 0 }))
      : [];
  const nowSec = pos * total;
  const playingNow = phase === "playing";
  const title = ep.title_ja ?? ep.title_zh;

  // Once playing, the show is a chat: every line said so far, the one being said lit up.
  const started = phase !== "idle" || !!prep.current;
  const mixed = prep.current;
  const shown = mixed && far >= 0 ? mixed.clips.slice(0, far + 1) : [];
  const lineAt = new Map(ep.lines.map((l, i) => [l.ja, i]));
  const next = mixed && at >= 0 ? mixed.clips[at + 1] : undefined;

  return (
    <main className={`page ${started ? "on-air" : ""}`} data-ask-topic={episode.title_zh} data-ask-ep={episode.id}>
      <Link href="/" className="back">← 听</Link>
      {!started ? (
        <>
          <div className="kicker">
            {k ? "ゆるっと日本ラジオ" : "趣味电台"} · {shortDate(ep.date)}
          </div>
          <div className={`radio-cover ${cover ? "drawn" : ""}`} style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
            {!cover && <h1 className="radio-title">{title}</h1>}
          </div>
          {cover && <h1 className="radio-title under">{title}</h1>}
          {ep.title_ja && <p className="radio-title-zh">{ep.title_zh}</p>}
          <div className="radio-hook">{ep.hook_zh}</div>
          <button className="radio-start" onClick={toggle}>
            ▶ 聞く
          </button>
        </>
      ) : (
        <>
          <div className={`radio-float ${cover ? "drawn" : ""}`} style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
            <div className="float-bar">
              <span>{title}</span>
              <div className={`radio-waves ${playingNow ? "on" : ""}`} aria-hidden>
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
          {loading && (
            <div className="radio-prev">
              正在制作声音
              <span className="count">
                {finished} / {made.clips.length}
              </span>
            </div>
          )}
          <div className="chat" ref={chat}>
            {shown.map((c, i) => {
              const w = c.line ? (c.line.voice === RADIO_VOICE.A ? "A" : "B") : c.sub === "ハル" ? "A" : c.sub === "ケン" ? "B" : null;
              if (!w) return <div key={i} className="chat-chip">{c.part === "song" ? "♪ 洗脳歌" : c.show}</div>;
              const li = lineAt.get(c.show);
              const easy = li === undefined ? "" : (ep.lines[li].easy ?? "");
              const asEasy = !!easy && flipped.has(li!);
              const isNow = i === at;
              const nw = next && i === at && (next.line ? (next.line.voice === RADIO_VOICE.A ? "A" : "B") : next.sub === "ハル" ? "A" : next.sub === "ケン" ? "B" : null);
              const flipIt = (e: React.MouseEvent) => {
                e.stopPropagation();
                flip(li!);
              };
              return (
                <div key={i} className="msg-wrap">
                  <div
                    className={`msg ${w === "A" ? "l" : "r"} ${isNow ? "cur" : "old"}`}
                    data-line={c.show}
                    data-before={shown[i - 1]?.show ?? ""}
                    data-easy-line={li === undefined ? undefined : c.show}
                    onClick={() => seekClip(i)}
                  >
                    <span className={`av av-${w}`}>{w === "A" ? "春" : "健"}</span>
                    <div className={`bub ${asEasy ? "easyb" : ""}`}>
                      {asEasy ? (
                        <>
                          <button className="easy-lab" onClick={flipIt} aria-label="原文に戻す">
                            やさしく ×
                          </button>
                          <span className="easy-ja">{easy}</span>
                          <span className="orig">{c.show}</span>
                        </>
                      ) : isNow && mixed ? (
                        <Said audio={audio} text={c.show} from={mixed.starts[i]} to={mixed.ends[i]} />
                      ) : (
                        c.show
                      )}
                      {li !== undefined && making.has(li) && (
                        <span className="easy-making">
                          <span className="spin" /> やさしく…
                        </span>
                      )}
                      {li !== undefined && easyNote?.i === li && <span className="easy-making">{easyNote.text}</span>}
                      {isNow && mixed && <Bar audio={audio} from={mixed.starts[i]} to={mixed.ends[i]} />}
                      {c.back && <span className="react">{c.back.text}</span>}
                    </div>
                  </div>
                  {nw && mixed && <Typing audio={audio} who={nw} from={mixed.ends[i]} to={mixed.starts[i + 1]} />}
                </div>
              );
            })}
          </div>
          {done && k && (
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
          )}
          <div className="radio-dock">
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
                戻る
              </button>
              <button className="radio-play" onClick={toggle} aria-label={playingNow ? "暂停" : "播放"}>
                {phase === "loading" ? <span className="spin" /> : playingNow ? "❚❚" : "▶"}
              </button>
              <button className="player-tool" onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])} aria-label="播放速度">
                {rate}×
              </button>
            </div>
          </div>
          {away && at >= 0 && (
            <button className="now-pill" onClick={backToNow}>
              ↓ 今のセリフ
            </button>
          )}
        </>
      )}
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
            fallbackN > 0 && `${fallbackN} 句用了备用声音`,
            failN > 0 && `${failN} 句没做出来，已跳过`,
          ]
            .filter(Boolean)
            .join("；")}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {/* While the show is on, nothing under the chat but the chat itself. */}
      {(!started || done) && (
        <>
          <Earworm ep={ep} />

          <div className="radio-rows">
            <button className="radio-row" onClick={() => setOpen(!open)}>
              <span>スクリプト</span>
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
                <span>{ep.lines.length} 句</span>
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
            </>
          )}

          </div>
          )}
        </>
      )}

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

// Where the audio is now, read every frame (to a twentieth of a second) while this is on screen.
function useTime(audio: React.RefObject<HTMLAudioElement | null>) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const a = audio.current;
      if (a) setT(Math.round(a.currentTime * 20) / 20);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [audio]);
  return t;
}

// The line being said: the part already said dark, the rest still grey, at the line's own pace.
function Said({ audio, text, from, to }: { audio: React.RefObject<HTMLAudioElement | null>; text: string; from: number; to: number }) {
  const t = useTime(audio);
  const n = Math.round(text.length * Math.max(0, Math.min(1, (t - from) / Math.max(0.3, to - from))));
  return (
    <>
      <span className="said">{text.slice(0, n)}</span>
      <span className="unsaid">{text.slice(n)}</span>
    </>
  );
}

function Bar({ audio, from, to }: { audio: React.RefObject<HTMLAudioElement | null>; from: number; to: number }) {
  const t = useTime(audio);
  return (
    <span className="bub-bar">
      <u style={{ width: `${Math.max(0, Math.min(1, (t - from) / Math.max(0.3, to - from))) * 100}%` }} />
    </span>
  );
}

// The other host about to answer: three dots in the pause between two lines.
function Typing({ audio, who, from, to }: { audio: React.RefObject<HTMLAudioElement | null>; who: "A" | "B"; from: number; to: number }) {
  const t = useTime(audio);
  if (!(t > from + 0.1 && t < to)) return null;
  return (
    <div className={`msg ${who === "A" ? "l" : "r"} typing`}>
      <span className={`av av-${who}`}>{who === "A" ? "春" : "健"}</span>
      <div className="bub">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

// Scrolls just enough that the bubble (and the dots that may follow it) sit above the player at the bottom.
function aboveDock(el: HTMLElement) {
  const dock = document.querySelector(".radio-dock")?.getBoundingClientRect().top ?? window.innerHeight;
  const below = el.getBoundingClientRect().bottom - (dock - 70);
  const top = Math.max(0, el.getBoundingClientRect().top - (document.querySelector(".radio-float")?.getBoundingClientRect().bottom ?? 0) - 12);
  // A bubble taller than the room left: its top stays in view.
  window.scrollBy({ top: Math.min(below, top), behavior: "smooth" });
}
