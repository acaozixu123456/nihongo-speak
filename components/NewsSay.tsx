"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NewsArticle, Seg } from "@/lib/news-model";
import { useHydrated } from "@/lib/client/hydrated";
import { useNews, voiceOf } from "@/lib/client/news";
import { play, stop, ttsUrl, unlock } from "@/lib/client/player";
import { hasCard, markNews, toggleCard, useProgress } from "@/lib/client/progress";
import { verdict } from "@/lib/client/fx";
import HoldButton from "./HoldButton";
import { Ruby } from "./News";

// 一文ずつ三回話す: one sentence of an NHK article, said back three times with less on screen each time —
// the whole sentence, then only its kanji words, then nothing but the Chinese. After the third, what was said
// is green and what was left out red; then on to the next sentence. Opened from the button beside each
// sentence on the article page (/news/[id]/say?i=n).

type Check = { said: string; parts: { t: string; ok: boolean }[]; miss_zh: string };
type Got = Check | "wait" | "fail";

const SAYS = ["見ながら", "ヒントだけ", "何も見ないで"] as const;
const MARK = /^[、。，．・「」『』（）！？\s]+$/;

const whole = (c: Check) => c.parts.every((p) => p.ok || MARK.test(p.t));
const share = (c: Check) => {
  const n = c.parts.reduce((s, p) => s + p.t.length, 0);
  return n ? c.parts.reduce((s, p) => s + (p.ok ? p.t.length : 0), 0) / n : 0;
};
const grade = (g: Got | undefined) => (!g || g === "wait" ? "…" : g === "fail" ? "?" : whole(g) ? "✓" : share(g) >= 0.7 ? "ほぼ" : "!");

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

  const listen = () => {
    unlock();
    play(ttsUrl(s.say, voice)).catch(() => {});
  };
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
    try {
      const res = await fetch("/api/say", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ja: s.ja, audio: await toBase64(wav) }) });
      const c = (await res.json()) as Check & { error?: string };
      if (!res.ok) throw new Error(c.error);
      if (turn.current !== mine) return;
      setGot((g) => Object.assign([...g], { [at]: c }));
      if (at === 2) {
        verdict(whole(c) ? "right" : share(c) >= 0.7 ? "close" : "wrong");
        markNews(a.id, { said: { ...p.news?.[a.id]?.said, [i]: whole(c) ? 1 : 0 } });
        if (!whole(c) && !hasCard(p, s.ja)) toggleCard({ ja: s.ja, zh: s.zh, voice, scenarioId: `news:${a.id}` });
      }
    } catch {
      if (turn.current === mine) setGot((g) => Object.assign([...g], { [at]: "fail" }));
    }
  }

  function again() {
    turn.current++;
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
          <em>{good}文</em>そのまま言えた
        </h1>
        <div className="say-bigzh">练过的{tried}句里，{good}句第3遍完整说出</div>
        <div className="pl-grid say-list">
          {a.sentences.map((x, j) => (
            <button key={j} className="pl say-row" onClick={() => (again(), setI(j), setEnd(false))}>
              <i className={said[j] === 1 ? "g" : said[j] === 0 ? "r" : ""}>{said[j] === 1 ? "✓" : said[j] === 0 ? "!" : ""}</i>
              <span>{x.ja}</span>
            </button>
          ))}
        </div>
        <div className="sticky-cta">
          <Link href={`/retell?news=${a.id}`} className="pil-go on">記事全体を三回話す</Link>
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
          <div className="say-steps">
            {SAYS.map((l, x) => (
              <span key={l} className={x === k ? "on" : x < k ? (grade(got[x]) === "✓" ? "ok" : "past") : ""}>
                {x + 1}回目{x < k ? ` ${grade(got[x])}` : ""}
              </span>
            ))}
          </div>
          <div className="say-kind">{SAYS[k]}</div>
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
            <button className="say-listen" onClick={listen}>
              <i>▶</i>もう一度聞く
            </button>
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
              onStart={() => setRec(true)}
              onRecorded={onRecorded}
              onError={(e) => {
                if (e) setRec(false);
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
              <div className="say-blk g">
                <div className="say-bh"><i>✓</i>{whole(last) ? "全部言えた" : "言えた"}</div>
                <p className="say-res" data-line={s.ja}>
                  {last.parts.map((x, j) => (
                    <span key={j} className={x.ok || MARK.test(x.t) ? "y" : "m"}>{x.t}</span>
                  ))}
                </p>
              </div>
              {!whole(last) && (
                <div className="say-blk r">
                  <div className="say-bh"><i>!</i>ここが抜けた</div>
                  <div className="say-miss">
                    <b>{last.parts.filter((x) => !x.ok && !MARK.test(x.t)).map((x) => x.t).join(" … ")}</b>
                    <button className="say-play" onClick={listen} aria-label="原文を聞く">▶</button>
                  </div>
                  {last.miss_zh && <div className="say-zh">{last.miss_zh}</div>}
                </div>
              )}
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
