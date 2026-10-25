"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NEWS_VOICES, VOICE_LABEL, type NewsArticle, type Seg } from "@/lib/news-model";
import { useHydrated } from "@/lib/client/hydrated";
import { useNews, voiceOf } from "@/lib/client/news";
import { play, stop, ttsUrl, unlock } from "@/lib/client/player";
import { hasCard, markNews, toggleCard, useProgress } from "@/lib/client/progress";
import { verdict } from "@/lib/client/fx";
import { loadPause, startPause, stopPause } from "@/lib/client/bgm";
import { audioCtx, renewAudio } from "@/lib/client/audio";
import { Ears } from "@/lib/client/ears";
import { SenseiFace, speakClip, SENSEI_VOICE } from "./Sensei";
import HoldButton from "./HoldButton";
import { Ruby } from "./News";

// 一文ずつ三回話す: one sentence of an NHK article, said back three times with less on screen each time —
// the whole sentence, then only its kanji words, then nothing but the Chinese. Judged by meaning, from what the
// learner said: after the third, their own words (slips underlined), where they got stuck, and their sentence
// made right in their own words; NHK's sentence only small underneath. Then on to the next sentence. Opened from the button beside each
// sentence on the article page (/news/[id]/say?i=n).

type Part = { t: string; ok: boolean };
type Check = { said: string; verdict: "good" | "close" | "off"; mine: Part[]; stuck_zh: string; better: string; better_zh: string; parts: Part[] };
type Got = Check | "wait" | "fail";

const SAYS = ["見ながら", "ヒントだけ", "何も見ないで"] as const;
const SAYS_ZH = ["看着说一遍", "只看关键词", "只看中文"] as const;

// 森先生 on the 2nd and 3rd telling: once the learner has been quiet STUCK_S after starting (START_S before
// saying anything) the recording ends and she says the clause they were in, up to its next break; then they
// say the sentence again from the start. Her line is asked for already at PREFETCH_S of quiet.
const PREFETCH_S = 1.2;
const STUCK_S = 3;
const START_S = 5;
type Help = { say: string; audio?: string } | "wait";

const whole = (c: Check) => c.verdict === "good";
const bare = (t: string) => t.replace(/[、。，．・「」『』（）！？\s]/g, "");
const grade = (g: Got | undefined) => (!g || g === "wait" ? "…" : g === "fail" ? "?" : g.verdict === "good" ? "✓" : g.verdict === "close" ? "ほぼ" : "!");

export function NewsSayPage({ id, from }: { id: string; from: number }) {
  const items = useNews();
  const hydrated = useHydrated();
  const a = items.find((x) => x.id === id);
  if (!hydrated) return <main className="page" />;
  if (!a)
    return (
      <main className="page">
        <Link href="/" className="back">‹ 听</Link>
        <p className="muted">{items.length ? "这条新闻已经不在了（只保留 14 天）" : "正在读取…"}</p>
      </main>
    );
  return <Say a={a} from={Math.min(Math.max(0, from), a.sentences.length - 1)} />;
}

function toBase64(b: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => fail(r.error);
    r.readAsDataURL(b);
  });
}

// The 2回目 hint: the kanji words (with their readings) and numbers stay, the rest of each stretch is a blank.
function Hint({ segs }: { segs: Seg[] }) {
  const out: React.ReactNode[] = [];
  let chip: Seg[] = [];
  let gap = false;
  const flush = () => {
    if (chip.length) out.push(<b key={out.length} className="say-chip"><Ruby segs={chip} /></b>);
    chip = [];
  };
  for (const s of segs) {
    if (s.r || /^[0-9０-９]+$/.test(s.t)) {
      if (gap) out.push(<u key={out.length} />);
      gap = false;
      chip.push(s);
      continue;
    }
    flush();
    // Kana: a blank, except the punctuation at its end, which shows where the sentence breaks.
    const end = s.t.match(/[、。「」]+$/)?.[0] ?? "";
    if (s.t.length > end.length) gap = true;
    if (end) {
      if (gap) out.push(<u key={out.length} />);
      gap = false;
      out.push(<span key={out.length}>{end}</span>);
    }
  }
  flush();
  if (gap) out.push(<u key={out.length} />);
  return <p className="say-hint">{out}</p>;
}

function Say({ a, from }: { a: NewsArticle; from: number }) {
  const p = useProgress();
  const voice = voiceOf(p, a);
  const n = a.sentences.length;
  const [i, setI] = useState(from);
  const [k, setK] = useState(0); // 0-2: the telling, 3: this sentence's result
  const [got, setGot] = useState<Got[]>([]);
  const [rec, setRec] = useState(false);
  const [error, setError] = useState("");
  const [end, setEnd] = useState(false);
  const s = a.sentences[i];
  const turn = useRef(0);
  const [help, setHelp] = useState<Help | null>(null);
  const [stopKey, setStopKey] = useState(0);
  const ears = useRef<Ears | null>(null);
  const ahead = useRef<Promise<Help | null> | null>(null);
  const stuck = useRef(false);
  const watcher = useRef<number | undefined>(undefined);
  const deaf = () => {
    window.clearInterval(watcher.current);
    ears.current?.close();
    ears.current = null;
  };
  useEffect(() => deaf, []);

  const ask = (audio: string): Promise<Help | null> =>
    fetch("/api/help", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sentence: s.ja, audio }) })
      .then((r) => (r.ok ? (r.json() as Promise<{ say: string; audio?: string }>) : null))
      .then((h) => (h?.say ? h : null))
      .catch(() => null);

  // The mic is open: listen alongside it (2nd and 3rd telling only; the 1st has the sentence on screen).
  function onLive(stream: MediaStream) {
    deaf();
    stuck.current = false;
    ahead.current = null;
    if (k < 1) return;
    try {
      ears.current = new Ears(stream, audioCtx());
    } catch {
      return;
    }
    watcher.current = window.setInterval(() => {
      const e = ears.current;
      if (!e || stuck.current) return;
      const q = e.quiet();
      if (q < PREFETCH_S) ahead.current = null;
      else if (!ahead.current && e.spoke) ahead.current = ask(e.clip(12));
      if (q >= (e.spoke ? STUCK_S : START_S)) {
        stuck.current = true;
        setStopKey((x) => x + 1);
      }
    }, 250);
  }

  // Stuck: the recording is not judged; she says the clause, and the sentence is said again.
  async function stepIn(wav: Blob) {
    const pending = ahead.current ?? ask(ears.current?.spoke ? await toBase64(wav) : "");
    deaf();
    ahead.current = null;
    const mine = turn.current;
    setHelp("wait");
    const h = await pending;
    if (turn.current !== mine) return;
    const line = h && h !== "wait" ? h : { say: s.ja.slice(0, (s.ja.search(/[、。]/) + 1) || s.ja.length) };
    setHelp(line);
    void speakClip(line.audio ? `data:audio/mpeg;base64,${line.audio}` : ttsUrl(line.say, SENSEI_VOICE));
  }

  const listen = (v = voice) => {
    unlock();
    play(ttsUrl(s.say, v)).catch(() => {});
  };
  // Another of the six voices: kept as the article's voice (the article page uses it too) and heard at once.
  const pick = (v: string) => {
    markNews(a.id, { voice: v });
    listen(v);
  };
  // The quiet music of 三回話す fills the wait after the third telling, ready before it is needed.
  useEffect(() => {
    void loadPause();
    return () => void stopPause(0);
  }, []);
  // Each sentence starts by being heard once.
  useEffect(() => {
    if (!end) listen();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, end]);

  async function onRecorded(wav: Blob) {
    setRec(false);
    if (stuck.current) {
      stuck.current = false;
      return stepIn(wav);
    }
    deaf();
    setHelp(null);
    const at = k;
    const mine = turn.current;
    setGot((g) => Object.assign([...g], { [at]: "wait" }));
    setK(at + 1);
    if (at === 2) void startPause();
    try {
      const res = await fetch("/api/say", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ja: s.ja, audio: await toBase64(wav) }) });
      const c = (await res.json()) as Check & { error?: string };
      if (!res.ok) throw new Error(c.error);
      if (turn.current !== mine) return;
      setGot((g) => Object.assign([...g], { [at]: c }));
      if (at === 2) {
        void stopPause(1);
        verdict(c.verdict === "good" ? "right" : c.verdict === "close" ? "close" : "wrong");
        markNews(a.id, { said: { ...p.news?.[a.id]?.said, [i]: whole(c) ? 1 : 0 } });
        if (!whole(c) && !hasCard(p, s.ja)) toggleCard({ ja: s.ja, zh: s.zh, voice, scenarioId: `news:${a.id}` });
      }
    } catch {
      if (turn.current !== mine) return;
      if (at === 2) void stopPause(1);
      setGot((g) => Object.assign([...g], { [at]: "fail" }));
    }
  }

  function again() {
    turn.current++;
    setHelp(null);
    void stopPause(0.3);
    setGot([]);
    setK(0);
    setError("");
  }
  function next() {
    if (i + 1 >= n) setEnd(true);
    else {
      again();
      setI(i + 1);
    }
  }

  if (end) {
    const said = p.news?.[a.id]?.said ?? {};
    const good = a.sentences.filter((_, x) => said[x] === 1).length;
    const tried = a.sentences.filter((_, x) => said[x] !== undefined).length;
    const bad = a.sentences.some((_, x) => said[x] === 0);
    return (
      <main className="page say-page">
        <div className="say-top">
          <Link href={`/news/${a.id}`} className="back">‹ 記事</Link>
          <span className="muted">{n} / {n}</span>
        </div>
        <Bar n={n} i={n} />
        <h1 className="say-big">
          {tried}文のうち、<br />
          <em>{good}文</em>言えた
        </h1>
        <div className="say-bigzh">练过的{tried}句里，{good}句第3遍把意思说对了</div>
        <div className="pl-grid say-list">
          {a.sentences.map((x, j) => (
            <button key={j} className="pl say-row" onClick={() => (again(), setI(j), setEnd(false))}>
              <i className={said[j] === 1 ? "g" : said[j] === 0 ? "r" : ""}>{said[j] === 1 ? "✓" : said[j] === 0 ? "!" : ""}</i>
              <span>{x.ja}</span>
            </button>
          ))}
        </div>
        <div className="sticky-cta">
          {good === n ? (
            <>
              <Link href={`/news/${a.id}/full`} className="pil-go on">全文モード</Link>
              <Link href={`/retell?news=${a.id}`} className="say-sub">記事全体を三回話す</Link>
            </>
          ) : (
            <Link href={`/retell?news=${a.id}`} className="pil-go on">記事全体を三回話す</Link>
          )}
          {bad && <div className="say-sub">! の文は 復習 に入れました</div>}
        </div>
      </main>
    );
  }

  const last = got[2];
  return (
    <main className="page say-page">
      <div className="say-top">
        <Link href={`/news/${a.id}`} className="back">‹ 記事</Link>
        <span className="muted">{i + 1} / {n}</span>
      </div>
      <Bar n={n} i={i} />
      <div className="say-title">{a.title_ja}</div>

      {k < 3 ? (
        <>
          {/* Which telling, as a big numeral; the three marks beside it fill in green as each is ✓. */}
          <div className="mg-step">
            <div className="mg-step-n">{k + 1}</div>
            <div className="mg-step-t">
              <b>{SAYS[k]}</b>
              <span>{SAYS_ZH[k]}</span>
            </div>
            <div className="mg-step-dots">
              {SAYS.map((l, x) => (
                <i key={l} className={x === k ? "on" : x < k ? (grade(got[x]) === "✓" ? "ok" : "past") : ""} />
              ))}
            </div>
          </div>
          <div className="say-card" data-line={k === 0 ? s.ja : undefined}>
            {k === 0 ? (
              <p className="say-s"><Ruby segs={s.segs} /></p>
            ) : k === 1 ? (
              <Hint segs={s.segs} />
            ) : (
              <div className="say-q">？</div>
            )}
            {k !== 1 && s.zh && <div className="say-zh">{s.zh}</div>}
          </div>
          {k === 0 && !rec && (
            <div className="say-listen-row">
              <button className="say-listen" onClick={() => listen()}>
                <i>▶</i>もう一度聞く
              </button>
              <div className="say-voices">
                {NEWS_VOICES.map((v, x) => (
                  <button key={v} className={v === voice ? "on" : ""} onClick={() => pick(v)}>
                    {VOICE_LABEL[x]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {help && (
            <div className="help-card mg-help">
              <div className="help-who">
                <SenseiFace size={36} />
                <b>森先生</b>
              </div>
              <div className={`help-say${help === "wait" ? " wait" : ""}`}>{help === "wait" ? "うん…" : help.say}</div>
              {help !== "wait" && <div className="help-zh">接着这里，再从头说一遍</div>}
            </div>
          )}
          <div className="say-mic">
            <HoldButton
              compact
              label={
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-label="話す">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              }
              onStart={() => {
                // iPhone only lets a Web Audio context start inside a tap, and the music after the third telling
                // starts once the recording is sent, well after the tap. So the tap that opens the mic makes it.
                renewAudio();
                setRec(true);
              }}
              onLive={onLive}
              stopKey={stopKey}
              onRecorded={onRecorded}
              onError={(e) => {
                if (e) {
                  setRec(false);
                  stuck.current = false;
                  deaf();
                }
                setError(e);
              }}
            />
            <div className="say-miclab">{rec ? "話しています" : "話す"}<small>{rec ? "说完点一下" : ""}</small></div>
            {error && <p className="error">{error}</p>}
          </div>
        </>
      ) : (
        <>
          <div className="say-three">
            {SAYS.map((l, x) => {
              const g = grade(got[x]);
              return (
                <div key={l} className={g === "✓" ? "ok" : g === "ほぼ" ? "mid" : g === "!" ? "no" : ""}>
                  <b>{g}</b>
                  <span>{x + 1}回目</span>
                </div>
              );
            })}
          </div>
          {!last || last === "wait" ? (
            <div className="say-wait">聞いています…</div>
          ) : last === "fail" ? (
            <div className="say-wait">没听清，再说一次</div>
          ) : (
            <>
              <div className={`say-blk ${whole(last) ? "g" : "n"}`}>
                <div className="say-bh">{whole(last) ? <><i>✓</i>言えた</> : "言ったこと"}</div>
                <p className="say-res say-mine">
                  {last.mine.length ? last.mine.map((x, j) => <span key={j} className={x.ok ? undefined : "m"}>{x.t}</span>) : "（聞こえなかった）"}
                </p>
                {last.stuck_zh && <div className="say-zh">{last.stuck_zh}</div>}
              </div>
              {last.better && bare(last.better) !== bare(last.said) && (
                <div className="say-blk g">
                  <div className="say-bh"><i>✓</i>あなたの言い方で</div>
                  <div className="say-miss">
                    <b data-line={last.better}>{last.better}</b>
                    <button className="say-play" onClick={() => (unlock(), play(ttsUrl(last.better, voice)).catch(() => {}))} aria-label="聞く">▶</button>
                  </div>
                  {last.better_zh && <div className="say-zh">{last.better_zh}</div>}
                </div>
              )}
              <div className="say-orig">
                <div>
                  <small>元の文</small>
                  <p data-line={s.ja}>
                    {last.parts.map((x, j) => <span key={j} className={x.ok ? undefined : "m"}>{x.t}</span>)}
                  </p>
                </div>
                <button className="say-play" onClick={() => listen()} aria-label="元の文を聞く">▶</button>
              </div>
            </>
          )}
          <div className="sticky-cta">
            <button className="pil-go on" onClick={next} disabled={!last || last === "wait"}>
              {i + 1 >= n ? "終わり" : "次の文"}
            </button>
            <button className="say-sub" onClick={again}>もう一回</button>
          </div>
        </>
      )}
    </main>
  );
}

function Bar({ n, i }: { n: number; i: number }) {
  return (
    <div className="say-bar">
      {Array.from({ length: n }, (_, x) => (
        <i key={x} className={x < i ? "d" : x === i ? "n" : ""} />
      ))}
    </div>
  );
}
