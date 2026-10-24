"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NEWS_VOICES, VOICE_LABEL, type NewsArticle } from "@/lib/news-model";
import { useHydrated } from "@/lib/client/hydrated";
import { useNews, voiceOf } from "@/lib/client/news";
import { play, stop, ttsUrl, unlock } from "@/lib/client/player";
import { findEpisode, hasCard, markNews, RADIO_VOICE, toggleCard, useProgress } from "@/lib/client/progress";
import { verdict } from "@/lib/client/fx";
import { loadPause, startPause, stopPause } from "@/lib/client/bgm";
import { renewAudio } from "@/lib/client/audio";
import HoldButton from "./HoldButton";
import { Ruby } from "./News";

// 一句一句讲三遍: one sentence of a news article, said back three times with less on screen each time —
// the whole sentence, then only the first letter of each word, then nothing but the Chinese. Judged by meaning,
// from what the learner said: after the third, their own words (slips underlined), where they got stuck, and
// their sentence made right in their own words; the article's sentence only small underneath. Then on to the next sentence. Opened from the button beside each
// sentence on the article page (/news/[id]/say?i=n), and the same for every line of a radio episode
// (/ep/[id]/say?i=n), each line in its own host's voice.

type Part = { t: string; ok: boolean };
type Check = { said: string; verdict: "good" | "close" | "off"; mine: Part[]; stuck_zh: string; better: string; better_zh: string; parts: Part[] };
type Got = Check | "wait" | "fail";

const SAYS = ["看着说", "只看首字母", "什么都不看"] as const;

const whole = (c: Check) => c.verdict === "good";
const bare = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
const grade = (g: Got | undefined) => (!g || g === "wait" ? "…" : g === "fail" ? "?" : g.verdict === "good" ? "✓" : g.verdict === "close" ? "≈" : "!");

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
  return <Say a={a} from={Math.min(Math.max(0, from), a.sentences.length - 1)} home={`/news/${a.id}`} />;
}

// A radio episode's lines, as an article to say back line by line. Kept under "radio:<id>" in the news marks.
export function RadioSayPage({ id, from }: { id: string; from: number }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const ep = hydrated ? findEpisode(p, id) : undefined;
  if (!hydrated) return <main className="page" />;
  if (!ep?.lines.length)
    return (
      <main className="page">
        <Link href="/" className="back">‹ 听</Link>
        <p className="muted">找不到这一期了（只保留最近 50 期）。</p>
      </main>
    );
  const title = ep.title_ja ?? ep.title_zh;
  const a: NewsArticle = {
    id: `radio:${ep.id}`,
    day: ep.date,
    at: "",
    rank: 0,
    title: [{ t: title }],
    title_ja: title,
    title_zh: ep.title_zh,
    sentences: ep.lines.map((l) => ({ segs: [{ t: l.ja }], ja: l.ja, say: l.ja, zh: l.zh, voice: RADIO_VOICE[l.who] })),
    words: [],
    keys: [],
    summary: [],
    url: "",
  };
  return <Say a={a} from={Math.min(Math.max(0, from), a.sentences.length - 1)} home={`/ep/${ep.id}`} radio />;
}

function toBase64(b: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => fail(r.error);
    r.readAsDataURL(b);
  });
}

// The 2nd telling's hint: each word as its first letter and a blank as long as the rest; numbers and
// punctuation stay, so the shape of the sentence is there but the words must come from memory.
function Hint({ text }: { text: string }) {
  const out = text.split(/(\s+)/).map((w, k) => {
    if (/^\s+$/.test(w)) return " ";
    if (/^[0-9.,:%$¥€£-]+$/.test(w)) return <b key={k} className="say-chip">{w}</b>;
    const m = /^([^A-Za-z]*)([A-Za-z])([A-Za-z'’-]*)(.*)$/.exec(w);
    if (!m) return w;
    return (
      <span key={k}>
        {m[1]}
        <b className="say-chip">{m[2]}</b>
        {"_".repeat(m[3].length)}
        {m[4]}
      </span>
    );
  });
  return <p className="say-hint">{out}</p>;
}

// Pieces of a sentence shown in a row, spaced as words.
const spaced = (parts: Part[]) => parts.flatMap((x, j) => [j ? " " : "", <span key={j} className={x.ok ? undefined : "m"}>{x.t}</span>]);

function Say({ a, from, home, radio }: { a: NewsArticle; from: number; home: string; radio?: boolean }) {
  const p = useProgress();
  const n = a.sentences.length;
  const [i, setI] = useState(from);
  const [k, setK] = useState(0); // 0-2: the telling, 3: this sentence's result
  const [got, setGot] = useState<Got[]>([]);
  const [rec, setRec] = useState(false);
  const [error, setError] = useState("");
  const [end, setEnd] = useState(false);
  const s = a.sentences[i];
  // A radio line is always heard in its host's voice; a news sentence in the article's.
  const voice = s.voice ?? voiceOf(p, a);
  const turn = useRef(0);

  const listen = (v = voice) => {
    unlock();
    play(ttsUrl(s.say, v)).catch(() => {});
  };
  // Another of the six voices: kept as the article's voice (the article page uses it too) and heard at once.
  const pick = (v: string) => {
    markNews(a.id, { voice: v });
    listen(v);
  };
  // The quiet music of 讲三遍 fills the wait after the third telling, ready before it is needed.
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
          <Link href={home} className="back">‹ {radio ? "电台" : "文章"}</Link>
          <span className="muted">{n} / {n}</span>
        </div>
        <Bar n={n} i={n} />
        <h1 className="say-big">
          练了 {tried} 句，<br />
          <em>{good} 句</em>说对了
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
          {radio ? (
            <Link href={home} className="pil-go on">回到电台</Link>
          ) : good === n ? (
            <>
              <Link href={`/news/${a.id}/full`} className="pil-go on">全文模式</Link>
              <Link href={`/retell?news=${a.id}`} className="say-sub">整篇讲三遍</Link>
            </>
          ) : (
            <Link href={`/retell?news=${a.id}`} className="pil-go on">整篇讲三遍</Link>
          )}
          {bad && <div className="say-sub">标 ! 的句子已放进复习</div>}
        </div>
      </main>
    );
  }

  const last = got[2];
  return (
    <main className="page say-page">
      <div className="say-top">
        <Link href={home} className="back">‹ {radio ? "电台" : "文章"}</Link>
        <span className="muted">{i + 1} / {n}</span>
      </div>
      <Bar n={n} i={i} />
      <div className="say-title">{a.title_ja}</div>

      {k < 3 ? (
        <>
          <div className="say-steps">
            {SAYS.map((l, x) => (
              <span key={l} className={x === k ? "on" : x < k ? (grade(got[x]) === "✓" ? "ok" : "past") : ""}>
                第 {x + 1} 遍{x < k ? ` ${grade(got[x])}` : ""}
              </span>
            ))}
          </div>
          <div className="say-kind">{SAYS[k]}</div>
          <div className="say-card" data-line={k === 0 ? s.ja : undefined}>
            {k === 0 ? (
              <p className="say-s"><Ruby segs={s.segs} /></p>
            ) : k === 1 ? (
              <Hint text={s.ja} />
            ) : (
              <div className="say-q">？</div>
            )}
            {k !== 1 && s.zh && <div className="say-zh">{s.zh}</div>}
          </div>
          {k === 0 && !rec && s.voice && (
            <div className="say-listen-row">
              <button className="say-listen" onClick={() => listen()}>
                <i>▶</i>再听一遍
              </button>
            </div>
          )}
          {k === 0 && !rec && !s.voice && (
            <div className="say-listen-row">
              <button className="say-listen" onClick={() => listen()}>
                <i>▶</i>再听一遍
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
          <div className="say-mic">
            <HoldButton
              compact
              label={
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-label="说">
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
              onRecorded={onRecorded}
              onError={(e) => {
                if (e) setRec(false);
                setError(e);
              }}
            />
            <div className="say-miclab">{rec ? "正在说" : "说"}<small>{rec ? "说完点一下" : ""}</small></div>
            {error && <p className="error">{error}</p>}
          </div>
        </>
      ) : (
        <>
          <div className="say-three">
            {SAYS.map((l, x) => {
              const g = grade(got[x]);
              return (
                <div key={l} className={g === "✓" ? "ok" : g === "≈" ? "mid" : g === "!" ? "no" : ""}>
                  <b>{g}</b>
                  <span>第 {x + 1} 遍</span>
                </div>
              );
            })}
          </div>
          {!last || last === "wait" ? (
            <div className="say-wait">正在听…</div>
          ) : last === "fail" ? (
            <div className="say-wait">没听清，再说一次</div>
          ) : (
            <>
              <div className={`say-blk ${whole(last) ? "g" : "n"}`}>
                <div className="say-bh">{whole(last) ? <><i>✓</i>说对了</> : "你说的"}</div>
                <p className="say-res say-mine">
                  {last.mine.length ? spaced(last.mine) : "（没听到）"}
                </p>
                {last.stuck_zh && <div className="say-zh">{last.stuck_zh}</div>}
              </div>
              {last.better && bare(last.better) !== bare(last.said) && (
                <div className="say-blk g">
                  <div className="say-bh"><i>✓</i>用你的说法改一改</div>
                  <div className="say-miss">
                    <b data-line={last.better}>{last.better}</b>
                    <button className="say-play" onClick={() => (unlock(), play(ttsUrl(last.better, voice)).catch(() => {}))} aria-label="听">▶</button>
                  </div>
                  {last.better_zh && <div className="say-zh">{last.better_zh}</div>}
                </div>
              )}
              <div className="say-orig">
                <div>
                  <small>原文</small>
                  <p data-line={s.ja}>
                    {spaced(last.parts)}
                  </p>
                </div>
                <button className="say-play" onClick={() => listen()} aria-label="听原文">▶</button>
              </div>
            </>
          )}
          <div className="sticky-cta">
            <button className="pil-go on" onClick={next} disabled={!last || last === "wait"}>
              {i + 1 >= n ? "完成" : "下一句"}
            </button>
            <button className="say-sub" onClick={again}>再来一次</button>
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
