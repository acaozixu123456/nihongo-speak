"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Game as GameData } from "@/lib/claude";
import { play, preload, ttsUrl, unlock } from "@/lib/client/player";
import {
  dueSkills,
  episodeItems,
  findEpisode,
  RADIO_VOICE,
  recordSkills,
  recordSpeech,
  skillKey,
  useProgress,
  wavSeconds,
  type Progress,
  type RadioEpisode,
  type SkillItem,
} from "@/lib/client/progress";
import { transcribe } from "@/lib/client/recorder";
import { useHydrated } from "@/lib/client/hydrated";
import { Star } from "./FeedbackCard";
import HoldButton from "./HoldButton";
import Nav from "./Nav";

type Q = GameData["questions"][number] & { choices: string[]; pool: string[] };

const VOICE = RADIO_VOICE.A;
const shuffle = <T,>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// Punctuation and spaces don't count when comparing what was said or built.
const bare = (s: string) => s.replace(/[\s、。，,.!！?？「」『』・〜~…]/g, "");

// How much of the answer the learner said, by longest common subsequence (speech recognition writes
// kanji or kana as it likes, so a near miss still counts).
function closeness(said: string, want: string) {
  const a = [...bare(said)];
  const b = [...bare(want)];
  if (!b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (const ca of a) {
    const cur = [0];
    for (let j = 0; j < b.length; j++) cur.push(ca === b[j] ? prev[j] + 1 : Math.max(prev[j + 1], cur[j]));
    prev = cur;
  }
  return prev[b.length] / Math.max(a.length, b.length);
}

// Japanese a question plays: the sentence itself, or the answer once it's Japanese.
const spoken = (q: Q) => (q.kind === "meaning" || q.kind === "listen" ? q.ja : q.kind === "fill" ? q.ja.replace(/＿+|_+/, q.answer) : q.answer);

function prepare(g: GameData): Q[] {
  return g.questions
    .filter((q) => q.answer.trim())
    .map((q) => {
      const tiles = q.kind === "order" && bare(q.tiles.join("")) === bare(q.answer) && q.tiles.length > 1 ? q.tiles : null;
      if (q.kind === "order" && !tiles) return null;
      if (["meaning", "listen", "pick", "fill"].includes(q.kind) && q.options.filter((o) => o !== q.answer).length < 2) return null;
      return {
        ...q,
        choices: shuffle([q.answer, ...q.options.filter((o) => o && o !== q.answer).slice(0, 3)]),
        pool: tiles ? shuffle([...tiles, ...q.options.filter((o) => o && !tiles.includes(o)).slice(0, 2)]) : [],
      };
    })
    .filter((q): q is Q => q !== null);
}

const PROMPT: Record<Q["kind"], string> = {
  meaning: "这句是什么意思？",
  listen: "听一听，是什么意思？",
  pick: "用日语怎么说？",
  fill: "空里填什么？",
  order: "排成日语句子",
  say: "用日语说出来",
};

type Result = { q: Q; ok: boolean };

// What a round practises: an episode's own items (what was asked about first, then grammar, sentences,
// words not yet solid) with a few older ones that are due again mixed in, or, for the daily round,
// only what is due.
const EP_ITEMS = 8;
const OLD_ITEMS = 3;
const DAILY_ITEMS = 10;
function roundItems(p: Progress, ep: RadioEpisode | null): SkillItem[] {
  if (!ep) return dueSkills(p, DAILY_ITEMS);
  const order = { asked: 0, grammar: 1, phrase: 2, word: 3 };
  const own = episodeItems(ep)
    .filter((x) => (p.skills[skillKey(x.ja)]?.level ?? 0) < 4)
    .sort((a, b) => order[a.kind] - order[b.kind])
    .slice(0, EP_ITEMS);
  const mine = new Set(episodeItems(ep).map((x) => skillKey(x.ja)));
  const old = dueSkills(p, OLD_ITEMS, mine);
  return own.length ? [...own, ...old] : [...episodeItems(ep).slice(0, EP_ITEMS), ...old];
}

// 练一练: a Duolingo-style round made by AI. Each item gets two exercises from different angles,
// harder ones as its level rises (recognise → use in a new sentence → say it), with new sentences
// every round. A miss comes back once at the end. Afterwards every item is rescheduled: right every
// time moves it up and further out, a miss brings it back tomorrow. id "today" is the daily round of
// everything due, across episodes.
export default function Game({ id }: { id: string }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const daily = id === "today";
  const ep = hydrated && !daily ? findEpisode(p, id) : undefined;
  const items = useRef<SkillItem[]>([]);
  const saved = useRef(-1);
  const [queue, setQueue] = useState<Q[] | null>(null);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  const loaded = useRef(-1);

  useEffect(() => {
    if (!hydrated || (!daily && !ep) || loaded.current === round) return;
    loaded.current = round;
    setQueue(null);
    setResults([]);
    setError("");
    items.current = roundItems(p, ep ?? null);
    if (!items.current.length) return setQueue([]);
    load(items.current, p, ep?.title_zh)
      .then((qs) => {
        setQueue(qs);
        setTotal(qs.length);
        preload(qs.map((q) => ttsUrl(spoken(q), VOICE)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "AI 出错了"));
  }, [hydrated, daily, ep, p, round]);

  // Reschedule every item once the round is over, by how it went the first time through.
  useEffect(() => {
    if (!queue || queue.length || !total || saved.current === round) return;
    saved.current = round;
    const byKey = new Map(items.current.map((x) => [skillKey(x.ja), x]));
    recordSkills(
      results
        .slice(0, total)
        .map((r) => ({ item: byKey.get(skillKey(r.q.about))!, ok: r.ok }))
        .filter((r) => r.item),
    );
  }, [queue, total, results, round]);

  if (!hydrated) return <main className="page" />;
  if (!daily && !ep) {
    return (
      <main className="page">
        <Link href="/" className="back">← 聴く</Link>
        <p className="muted">找不到这一期了（只保留最近 50 期）。</p>
        <Nav on="listen" />
      </main>
    );
  }

  const back = ep ? (
    <Link href={`/ep/${ep.id}`} className="back">
      ← 这一期
    </Link>
  ) : (
    <Link href="/" className="back">
      ← 聴く
    </Link>
  );
  if (error) {
    return (
      <main className="page">
        {back}
        <p className="error">{error}</p>
        <button className="btn cta" onClick={() => ((loaded.current = -1), setRound((r) => r + 1))}>
          再试一次
        </button>
      </main>
    );
  }
  if (!queue) {
    return (
      <main className="page">
        {back}
        <h1 className="ep-head">练一练</h1>
        <p className="muted game-wait">
          <span className="spin" /> AI 正在出题…
        </p>
      </main>
    );
  }

  const done = results.length;
  const firstTry = results.slice(0, total);
  if (!total) {
    return (
      <main className="page">
        {back}
        <h1 className="ep-head">今天没有要复习的</h1>
        <p className="muted">听完一期、练一练之后，学过的内容会按记忆曲线回到这里。</p>
        <Nav on="listen" />
      </main>
    );
  }
  if (!queue.length) {
    const right = firstTry.filter((r) => r.ok).length;
    const missed = [...new Map(firstTry.filter((r) => !r.ok).map((r) => [r.q.about, r.q])).values()];
    return (
      <main className="page">
        {back}
        <h1 className="ep-head">练完了</h1>
        <p className="game-score">
          一次答对 <b>{right}</b> / {total}
        </p>
        {missed.length > 0 && (
          <>
            <p className="note-head">这些明天会再练，也可以收藏进复习卡片：</p>
            {missed.map((q) => (
              <div key={q.about} className="note">
                <div className="note-main" onClick={() => say(spoken(q))}>
                  <div className="ja">{q.about}</div>
                  <div className="zh">{meaningOf(items.current, q)}</div>
                </div>
                <Star p={p} ja={q.about} zh={meaningOf(items.current, q)} voice={VOICE} scenarioId={`radio:${ep?.id ?? "practice"}`} />
              </div>
            ))}
          </>
        )}
        <button className="btn primary game-next" onClick={() => setRound((r) => r + 1)}>
          再来一轮
        </button>
      </main>
    );
  }

  const q = queue[0];
  return (
    <main className="page game">
      <div className="game-top">
        {back}
        <div className="game-bar">
          <div style={{ width: `${(Math.min(done, total) / total) * 100}%` }} />
        </div>
      </div>
      <Question
        key={`${round}-${done}`}
        q={q}
        again={done >= total}
        onDone={(ok) => {
          setResults((r) => [...r, { q, ok }]);
          // A miss comes back once, after everything else.
          setQueue((cur) => {
            const rest = (cur ?? []).slice(1);
            return ok || done >= total ? rest : [...rest, q];
          });
        }}
      />
    </main>
  );
}

// What a missed item means, for its review card.
function meaningOf(items: SkillItem[], q: Q) {
  return items.find((x) => skillKey(x.ja) === skillKey(q.about))?.zh ?? q.explain_zh;
}

async function load(items: SkillItem[], p: Progress, topic?: string) {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic: topic?.slice(0, 80),
      items: items.map((x) => ({ ja: x.ja, zh: x.zh, kind: x.kind, note: x.note, level: p.skills[skillKey(x.ja)]?.level ?? 0 })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "AI 出错了");
  const qs = prepare(data as GameData);
  if (!qs.length) throw new Error("这次没出好题，再试一次");
  return qs;
}

function say(ja: string) {
  unlock();
  play(ttsUrl(ja, VOICE)).catch(() => {});
}

function Question({ q, again, onDone }: { q: Q; again: boolean; onDone: (ok: boolean) => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [built, setBuilt] = useState<number[]>([]);
  const [heard, setHeard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verdict, setVerdict] = useState<boolean | null>(null);

  // Questions you hear start by playing.
  useEffect(() => {
    if (q.kind === "listen" || q.kind === "meaning") say(q.ja);
  }, [q]);

  const choice = ["meaning", "listen", "pick", "fill"].includes(q.kind);
  const answerText = q.kind === "order" ? built.map((i) => q.pool[i]).join("") : "";

  function check() {
    const ok = choice ? chosen === q.answer : bare(answerText) === bare(q.answer);
    setVerdict(ok);
    say(spoken(q));
  }

  async function onRecorded(wav: Blob) {
    setBusy(true);
    setError("");
    try {
      const { text } = await transcribe(wav);
      recordSpeech(wavSeconds(wav));
      setHeard(text || "");
      if (!text) return setError("没听清，再说一次");
      const ok = closeness(text, q.answer) >= 0.7;
      setVerdict(ok);
      say(q.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "识别失败");
    } finally {
      setBusy(false);
    }
  }

  const fillParts = q.kind === "fill" ? q.ja.split(/＿+|_+/) : [];

  return (
    <>
      <div className="kicker game-kind">{again ? "再来一次 · " : ""}{PROMPT[q.kind]}</div>
      <div className="game-q">
        {q.kind === "listen" ? (
          <button className="game-ear" onClick={() => say(q.ja)} aria-label="再听一遍">
            ▶
          </button>
        ) : q.kind === "meaning" ? (
          <div className="ja game-big" onClick={() => say(q.ja)}>
            {q.ja}
          </div>
        ) : q.kind === "fill" ? (
          <>
            <div className="ja game-big">
              {fillParts[0]}
              <span className={`game-blank ${chosen ? "on" : ""}`}>{chosen ?? "　　"}</span>
              {fillParts.slice(1).join("")}
            </div>
            <div className="zh">{q.zh}</div>
          </>
        ) : (
          <div className="game-big">{q.zh}</div>
        )}
      </div>

      {choice && (
        <div className="game-choices">
          {q.choices.map((c) => (
            <button
              key={c}
              disabled={verdict !== null}
              className={`game-choice ${chosen === c ? "sel" : ""} ${verdict !== null && c === q.answer ? "right" : ""} ${verdict === false && chosen === c ? "wrong" : ""}`}
              onClick={() => {
                setChosen(c);
                if (q.kind === "pick") say(c);
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {q.kind === "order" && (
        <>
          <div className="game-line">
            {built.map((i, n) => (
              <button key={n} className="tile" disabled={verdict !== null} onClick={() => setBuilt(built.filter((_, k) => k !== n))}>
                {q.pool[i]}
              </button>
            ))}
          </div>
          <div className="game-pool">
            {q.pool.map((t, i) => (
              <button key={i} className="tile" disabled={verdict !== null || built.includes(i)} onClick={() => setBuilt([...built, i])}>
                {t}
              </button>
            ))}
          </div>
        </>
      )}

      {q.kind === "say" && verdict === null && (
        <div className="game-say">
          {heard !== null && heard && <p className="muted">听到：{heard}</p>}
          <HoldButton label={busy ? "识别中…" : "点一下说话"} disabled={busy} onRecorded={onRecorded} onError={setError} />
          <button className="small ghost" onClick={() => (setVerdict(false), say(q.answer))}>
            不会，看答案
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {verdict !== null ? (
        <div className={`game-verdict ${verdict ? "ok" : "no"}`}>
          <b>{verdict ? "答对了" : "正确答案"}</b>
          <div className="ja" onClick={() => say(spoken(q))}>
            {q.kind === "meaning" || q.kind === "listen" ? `${q.ja} = ${q.answer}` : spoken(q)}
          </div>
          {q.kind === "say" && heard && !verdict && <div className="muted">你说的：{heard}</div>}
          <p>{q.explain_zh}</p>
          <button className={`btn ${verdict ? "primary" : ""} game-next`} onClick={() => onDone(verdict)}>
            继续
          </button>
        </div>
      ) : (
        q.kind !== "say" && (
          <button className="btn primary game-next" disabled={choice ? !chosen : !built.length} onClick={check}>
            检查
          </button>
        )
      )}
    </>
  );
}
