"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Game as GameData } from "@/lib/game";
import { bare, closeness, confetti, sfx, verdict as judged } from "@/lib/client/fx";
import { play, preload, ttsUrl, unlock } from "@/lib/client/player";
import {
  dueSkills,
  episodeItems,
  findEpisode,
  RADIO_VOICE,
  recordSkills,
  recordSpeech,
  recordWeakRound,
  skillKey,
  WEAK_EP,
  weakItems,
  useProgress,
  wavSeconds,
  type Progress,
  type RadioEpisode,
  type SkillItem,
} from "@/lib/client/progress";
import { setAudioSession, transcribe } from "@/lib/client/recorder";
import { stepDone } from "@/lib/client/route";
import { useHydrated } from "@/lib/client/hydrated";
import { Star } from "./FeedbackCard";
import HoldButton from "./HoldButton";

type AiQ = GameData["questions"][number];
// match (连连看) is put together on the phone from the round's short items; the rest come from AI.
type Kind = AiQ["kind"] | "match";
type Q = Omit<AiQ, "kind"> & { kind: Kind; choices: string[]; pool: string[]; pairs?: { ja: string; zh: string }[] };

const VOICE = RADIO_VOICE.A;
const shuffle = <T,>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const HEARD: Kind[] = ["meaning", "listen", "reading", "judge", "dictate"];
const CHOICE: Kind[] = ["meaning", "listen", "reading", "pick", "fill"];
const TILES: Kind[] = ["order", "dictate"];
const NATURAL = "自然";
const ODD = "不自然";

// Japanese a question plays once answered: the sentence itself, or the answer once it's Japanese.
function spoken(q: Q) {
  if (q.kind === "judge") return q.answer === ODD && q.options[0] ? q.options[0] : q.ja;
  if (q.kind === "meaning" || q.kind === "listen" || q.kind === "reading") return q.ja;
  if (q.kind === "fill") return q.ja.replace(/＿+|_+/, q.answer);
  return q.answer;
}

function prepare(g: GameData, items: SkillItem[]): Q[] {
  const qs = g.questions
    .filter((q) => q.answer.trim())
    .map((q): Q | null => {
      const tiles = TILES.includes(q.kind) && bare(q.tiles.join("")) === bare(q.answer) && q.tiles.length > 1 ? q.tiles : null;
      if (TILES.includes(q.kind) && !tiles) return null;
      if (CHOICE.includes(q.kind) && q.options.filter((o) => o !== q.answer).length < 2) return null;
      if (q.kind === "judge" && ![NATURAL, ODD].includes(q.answer)) return null;
      return {
        ...q,
        choices: q.kind === "judge" ? [NATURAL, ODD] : shuffle([q.answer, ...q.options.filter((o) => o && o !== q.answer).slice(0, 3)]),
        pool: tiles ? shuffle([...tiles, ...q.options.filter((o) => o && !tiles.includes(o)).slice(0, 2)]) : [],
      };
    })
    .filter((q): q is Q => q !== null);
  // One 连连看 a little way in, when there are enough short items to pair up.
  const short = shuffle(items.filter((x) => x.ja.length <= 10 && x.zh.length <= 14)).slice(0, 5);
  if (short.length >= 3) {
    const match: Q = {
      kind: "match",
      about: "",
      ja: "",
      zh: "",
      answer: "",
      options: [],
      tiles: [],
      explain_zh: "",
      choices: [],
      pool: [],
      pairs: short.map((x) => ({ ja: x.ja, zh: x.zh })),
    };
    qs.splice(Math.min(3, qs.length), 0, match);
  }
  return qs;
}

const PROMPT: Record<Kind, string> = {
  meaning: "这句是什么意思？",
  listen: "听一听，是什么意思？",
  reading: "怎么读？",
  pick: "用日语怎么说？",
  judge: "这句日语说得自然吗？",
  fill: "空里填什么？",
  order: "排成日语句子",
  dictate: "听写：把听到的排出来",
  say: "用日语说出来",
  match: "连连看：日语和意思配对",
};

// Each finished set is kept so it can be practised again (再练这一套), one per episode and one for 練習.
type SavedSet = { items: SkillItem[]; data: GameData };
const SET_KEY = (id: string) => `nihongo-speak:game:${id}`;
function saveSet(id: string, set: SavedSet) {
  try {
    localStorage.setItem(SET_KEY(id), JSON.stringify(set));
  } catch {}
}
function savedSet(id: string): SavedSet | null {
  try {
    return JSON.parse(localStorage.getItem(SET_KEY(id)) ?? "null");
  } catch {
    return null;
  }
}
export const hasSavedSet = (id: string) => savedSet(id) !== null;

// The stamp at the end, by how much was right the first time.
const STAMP = (rate: number) => (rate === 1 ? "満点" : rate >= 0.8 ? "合格" : rate >= 0.5 ? "まあまあ" : "もう一回");

type Result = { q: Q; ok: boolean };

// What a round practises: an episode's own items (what was asked about first, then grammar, sentences,
// words not yet solid) with a few older ones that are due again mixed in, or, for the daily round,
// what is due plus the grammar the learner keeps getting wrong when speaking (the weak points), so
// mistakes turn into tomorrow's questions by themselves.
const EP_ITEMS = 8;
const OLD_ITEMS = 3;
const DAILY_ITEMS = 10;
const WEAK_ITEMS = 3;
function roundItems(p: Progress, ep: RadioEpisode | null): SkillItem[] {
  if (!ep) {
    const weak = weakItems(p, WEAK_ITEMS);
    return [...weak, ...dueSkills(p, DAILY_ITEMS - weak.length)];
  }
  const order = { asked: 0, grammar: 1, phrase: 2, word: 3, weak: 1 };
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
  const set = useRef<GameData | null>(null);
  const saved = useRef(-1);
  // replay: this round is the set from last time again.
  const [replay, setReplay] = useState(false);
  const [combo, setCombo] = useState(0);
  const [best, setBest] = useState(0);
  const [cheer, setCheer] = useState<{ n: number; key: number } | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [endedAt, setEndedAt] = useState(0);
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
    setCombo(0);
    setBest(0);
    setCheer(null);
    // Opened with ?again (from the episode page), or 再练这一套: the last set, shuffled anew.
    const again = replay || (round === 0 && new URLSearchParams(location.search).has("again"));
    const old = again ? savedSet(id) : null;
    const start = (qs: Q[]) => {
      setQueue(qs);
      setTotal(qs.length);
      setStartedAt(Date.now());
      preload(qs.map((q) => ttsUrl(spoken(q), VOICE)).concat(qs.flatMap((q) => (q.pairs ?? []).map((x) => ttsUrl(x.ja, VOICE)))));
    };
    if (old) {
      setReplay(true);
      items.current = old.items;
      set.current = old.data;
      return start(prepare(old.data, old.items));
    }
    items.current = roundItems(p, ep ?? null);
    if (!items.current.length) return setQueue([]);
    load(items.current, p, ep?.title_zh)
      .then((data) => {
        set.current = data;
        const qs = prepare(data, items.current);
        if (!qs.length) throw new Error("这次没出好题，再试一次");
        start(qs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "AI 出错了"));
  }, [hydrated, daily, ep, p, round, replay, id]);

  // Nothing due today: the route moves on rather than waiting on an empty stop.
  useEffect(() => {
    if (queue && !total) stepDone();
  }, [queue, total]);

  // Reschedule every item once the round is over, by how it went the first time through.
  useEffect(() => {
    if (!queue || queue.length || !total || saved.current === round) return;
    saved.current = round;
    setEndedAt(Date.now());
    if (set.current) saveSet(id, { items: items.current, data: set.current });
    const byKey = new Map(items.current.map((x) => [skillKey(x.ja), x]));
    const scored = results
      .slice(0, total)
      .map((r) => ({ item: byKey.get(skillKey(r.q.about))!, ok: r.ok }))
      .filter((r) => r.item);
    recordSkills(
      scored.filter((r) => r.item.kind !== "weak"),
      replay,
    );
    // A weak point is scored per question, so one slip doesn't undo a round of right answers.
    if (!replay) recordWeakRound(scored.filter((r) => r.item.kind === "weak").map((r) => ({ tag: r.item.ep.slice(WEAK_EP.length), ok: r.ok })));
    const rate = results.slice(0, total).filter((r) => r.ok).length / total;
    setTimeout(() => sfx("stamp"), 350);
    stepDone();
    setTimeout(() => {
      sfx("win");
      if (rate >= 0.5) confetti(rate === 1 ? 120 : 60);
    }, 650);
  }, [queue, total, results, round, replay, id]);

  if (!hydrated) return <main className="page" />;
  if (!daily && !ep) {
    return (
      <main className="page">
        <Link href="/" className="back">← 今日</Link>
        <p className="muted">找不到这一期了（只保留最近 50 期）。</p>
      </main>
    );
  }

  const back = ep ? (
    <Link href={`/ep/${ep.id}`} className="back">
      ← 这一期
    </Link>
  ) : (
    <Link href="/" className="back">
      ← 今日
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
        <h1 className="ep-head">練習</h1>
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
        <h1 className="ep-head">今日の練習はなし</h1>
        <p className="muted">听完一期、练一练之后，学过的内容会按记忆曲线回到这里；说话时常错的点也会混进来。</p>
      </main>
    );
  }
  if (!queue.length) {
    const right = firstTry.filter((r) => r.ok).length;
    const missed = [...new Map(firstTry.filter((r) => !r.ok && r.q.about).map((r) => [r.q.about, r.q])).values()];
    const secs = Math.max(1, Math.round((endedAt - startedAt) / 1000));
    return (
      <main className="page">
        {back}
        <div className="game-end">
          <div className={`hanko ${right === total ? "full" : ""}`}>{STAMP(right / total)}</div>
          <div className="game-stats">
            <div>
              <b>{Math.round((right / total) * 100)}%</b>
              <span>一次答对</span>
            </div>
            <div>
              <b>{best}</b>
              <span>最高连对</span>
            </div>
            <div>
              <b>{secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : `${secs}秒`}</b>
              <span>用时</span>
            </div>
          </div>
        </div>
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
        <button className="btn primary game-next" onClick={() => (setReplay(false), setRound((r) => r + 1))}>
          换一套新题
        </button>
        <button className="btn game-again" onClick={() => (setReplay(true), setRound((r) => r + 1))}>
          再练这一套
        </button>
      </main>
    );
  }

  const q = queue[0];
  return (
    <main className="page game">
      <div className="game-top">
        {back}
        <div className={`game-bar ${combo >= 3 ? "hot" : ""}`}>
          <div style={{ width: `${(Math.min(done, total) / total) * 100}%` }} />
        </div>
        <span className={`game-combo ${combo >= 2 ? "on" : ""}`} key={combo}>
          {combo >= 2 ? `${combo} 連` : ""}
        </span>
      </div>
      {cheer && (
        <div className="game-cheer" key={cheer.key}>
          {cheer.n} 連続！
        </div>
      )}
      <Question
        key={`${round}-${done}`}
        q={q}
        again={done >= total}
        from={fromOf(items.current, q, ep?.id)}
        onAnswer={(ok) => {
          if (!ok) return setCombo(0);
          const n = combo + 1;
          setCombo(n);
          setBest((b) => Math.max(b, n));
          if ([3, 5, 8, 12, 16].includes(n)) {
            setTimeout(() => sfx("combo"), 450);
            const key = Date.now();
            setCheer({ n, key });
            setTimeout(() => setCheer((c) => (c?.key === key ? null : c)), 1400);
            confetti(30);
          }
        }}
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

// Rounds asked for ahead of time (the episode page starts one when it opens, so 练一练 is ready by
// the time it's tapped), by request body. Taken once: the next round is written fresh.
const early = new Map<string, Promise<GameData>>();

function request(items: SkillItem[], p: Progress, topic?: string) {
  return JSON.stringify({
    topic: topic?.slice(0, 80),
    items: items.map((x) => ({ ja: x.ja, zh: x.zh, kind: x.kind, note: x.note, level: p.skills[skillKey(x.ja)]?.level ?? 0 })),
  });
}

async function fetchGame(body: string): Promise<GameData> {
  const res = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json" }, body });
  // A timeout comes back as a plain-text page, not JSON; say so instead of showing the parse error.
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error ?? "AI 这次太慢了，再试一次");
  return data as GameData;
}

export function prefetchGame(p: Progress, ep: RadioEpisode) {
  const items = roundItems(p, ep);
  if (!items.length) return;
  const body = request(items, p, ep.title_zh);
  if (early.has(body)) return;
  const job = fetchGame(body);
  job.catch(() => early.delete(body));
  early.set(body, job);
}

async function load(items: SkillItem[], p: Progress, topic?: string) {
  const body = request(items, p, topic);
  const ready = early.get(body);
  early.delete(body);
  return ready?.catch(() => fetchGame(body)) ?? fetchGame(body);
}

function say(ja: string) {
  unlock();
  play(ttsUrl(ja, VOICE)).catch(() => {});
}

// Where a question that isn't from this episode comes from, so an unfamiliar word doesn't look like a mistake.
function fromOf(items: SkillItem[], q: Q, epId?: string) {
  const it = q.about ? items.find((x) => skillKey(x.ja) === skillKey(q.about)) : undefined;
  if (!it) return "";
  if (it.kind === "weak") return "苦手";
  return epId && it.ep !== epId ? "前の回" : "";
}

function Question({ q, again, from, onAnswer, onDone }: { q: Q; again: boolean; from: string; onAnswer: (ok: boolean) => void; onDone: (ok: boolean) => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [built, setBuilt] = useState<number[]>([]);
  const [heard, setHeard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verdict, setVerdict] = useState<boolean | null>(null);
  // unsure: the learner said they don't know rather than guessing. Counts as a miss (it comes back at
  // the end and the item is rescheduled for tomorrow), but without the buzzer and shake of a wrong pick.
  const [unsure, setUnsure] = useState(false);

  // Questions you hear start by playing.
  useEffect(() => {
    if (HEARD.includes(q.kind) && q.kind !== "reading") say(q.ja);
  }, [q]);

  const choice = CHOICE.includes(q.kind) || q.kind === "judge";
  const answerText = TILES.includes(q.kind) ? built.map((i) => q.pool[i]).join("") : "";

  function decide(ok: boolean, sayAfter = true, soft = false) {
    setVerdict(ok);
    setUnsure(soft);
    // The same ピンポン, haptics and day-long run as every other practice page; the round cheers its own run.
    judged(ok ? "right" : "wrong", soft, false);
    onAnswer(ok);
    if (sayAfter) setTimeout(() => say(spoken(q)), 550);
  }

  function check() {
    decide(choice ? chosen === q.answer : bare(answerText) === bare(q.answer));
  }

  async function onRecorded(wav: Blob) {
    setBusy(true);
    setError("");
    try {
      const { text } = await transcribe(wav);
      recordSpeech(wavSeconds(wav));
      setHeard(text || "");
      if (!text) return setError("没听清，再说一次");
      decide(closeness(text, q.answer) >= 0.7);
    } catch (e) {
      setError(e instanceof Error ? e.message : "识别失败");
    } finally {
      setBusy(false);
    }
  }

  const tap = () => {
    setAudioSession("playback");
    sfx("tap");
  };
  const fillParts = q.kind === "fill" ? q.ja.split(/＿+|_+/) : [];

  return (
    <div className={`game-card ${verdict === false && !unsure ? "shake" : ""}`}>
      <div className="kicker game-kind">
        {again ? "再来一次 · " : ""}
        {from ? `${from} · ` : ""}
        {PROMPT[q.kind]}
      </div>
      {verdict !== null && !unsure && <div className={`game-mark ${verdict ? "ok" : "no"}`}>{verdict ? "◯" : "✕"}</div>}

      {q.kind === "match" ? (
        <Match pairs={q.pairs!} onDone={(ok) => decide(ok, false)} />
      ) : (
        <div className="game-q">
          {q.kind === "listen" || q.kind === "dictate" ? (
            <button className="game-ear" onClick={() => say(q.ja)} aria-label="再听一遍">
              ▶
            </button>
          ) : q.kind === "meaning" || q.kind === "judge" ? (
            <>
              <div className="ja game-big" onClick={() => say(q.ja)}>
                {q.ja}
              </div>
              {q.kind === "judge" && verdict !== null && <div className="zh">{q.zh}</div>}
            </>
          ) : q.kind === "reading" ? (
            <div className="ja game-huge">{q.ja}</div>
          ) : q.kind === "fill" ? (
            <>
              <div className="ja game-big">
                {fillParts[0]}
                <span className={`game-blank ${chosen ? "on" : ""}`}>{chosen ?? "\u3000\u3000"}</span>
                {fillParts.slice(1).join("")}
              </div>
              <div className="zh">{q.zh}</div>
            </>
          ) : (
            <div className="game-zh">{q.zh}</div>
          )}
        </div>
      )}

      {choice && (
        <div className={`game-choices ${q.kind === "judge" ? "two" : ""}`}>
          {q.choices.map((c) => (
            <button
              key={c}
              disabled={verdict !== null}
              className={`game-choice ${q.kind === "pick" || q.kind === "fill" || q.kind === "reading" ? "jp" : ""} ${chosen === c ? "sel" : ""} ${verdict !== null && c === q.answer ? "right" : ""} ${verdict === false && chosen === c ? "wrong" : ""}`}
              onClick={() => {
                tap();
                setChosen(c);
                if (q.kind === "pick") say(c);
              }}
            >
              {q.kind === "judge" ? (c === NATURAL ? "◯ 自然" : "✕ 不自然") : c}
            </button>
          ))}
        </div>
      )}

      {TILES.includes(q.kind) && (
        <>
          <div className="game-line">
            {built.map((i, n) => (
              <button key={n} className="tile pop" disabled={verdict !== null} onClick={() => (tap(), setBuilt(built.filter((_, k) => k !== n)))}>
                {q.pool[i]}
              </button>
            ))}
          </div>
          <div className="game-pool">
            {q.pool.map((t, i) => (
              <button key={i} className="tile" disabled={verdict !== null || built.includes(i)} onClick={() => (tap(), setBuilt([...built, i]))}>
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
          <button className="small ghost" onClick={() => decide(false, true, true)}>
            わからない・答えを見る
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {verdict === null && q.kind !== "say" && q.kind !== "match" && (
        <div className="sticky-cta">
          <button className="btn primary game-next" disabled={choice ? !chosen : !built.length} onClick={check}>
            確認
          </button>
          <button className="small ghost game-unsure" onClick={() => decide(false, true, true)}>
            {q.kind === "listen" || q.kind === "dictate" ? "聞き取れない・答えを見る" : "わからない・答えを見る"}
          </button>
        </div>
      )}

      {verdict !== null && (
        <div className={`game-sheet ${verdict ? "ok" : "no"}`}>
          <b>{verdict ? PRAISE[Math.floor(Math.random() * PRAISE.length)] : unsure ? "没关系，记住这个" : "正确答案"}</b>
          {q.kind !== "match" && (
            <div className="ja" onClick={() => say(spoken(q))}>
              {q.kind === "meaning" || q.kind === "listen" ? `${q.ja} = ${q.answer}` : q.kind === "reading" ? `${q.ja}（${q.answer}）` : spoken(q)}
            </div>
          )}
          {q.kind === "say" && heard && !verdict && <div className="muted">你说的：{heard}</div>}
          {q.explain_zh && <p>{q.explain_zh}</p>}
          <button className={`btn ${verdict ? "primary" : "dark"} game-next`} onClick={() => onDone(verdict)}>
            继续
          </button>
        </div>
      )}
    </div>
  );
}

const PRAISE = ["正解！", "すごい！", "いいね！", "完璧！", "その通り！"];

// 连连看: tap a Japanese card, then its meaning. More than one wrong pair counts as a miss.
function Match({ pairs, onDone }: { pairs: { ja: string; zh: string }[]; onDone: (ok: boolean) => void }) {
  const [left] = useState(() => shuffle(pairs.map((p) => p.ja)));
  const [right] = useState(() => shuffle(pairs.map((p) => p.zh)));
  const [pick, setPick] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [bad, setBad] = useState<string[]>([]);
  const misses = useRef(0);

  function tapZh(zh: string) {
    if (!pick) return;
    const pair = pairs.find((p) => p.ja === pick)!;
    if (pair.zh === zh) {
      sfx("pair");
      const next = [...done, pick];
      setDone(next);
      setPick(null);
      if (next.length === pairs.length) setTimeout(() => onDone(misses.current <= 1), 300);
    } else {
      sfx("wrong");
      misses.current++;
      setBad([pick, zh]);
      setTimeout(() => setBad([]), 450);
      setPick(null);
    }
  }

  const doneZh = done.map((ja) => pairs.find((p) => p.ja === ja)!.zh);
  return (
    <div className="match">
      <div>
        {left.map((ja) => (
          <button
            key={ja}
            className={`match-card ${pick === ja ? "sel" : ""} ${done.includes(ja) ? "gone" : ""} ${bad.includes(ja) ? "bad" : ""}`}
            disabled={done.includes(ja)}
            onClick={() => {
              setAudioSession("playback");
              sfx("tap");
              setPick(ja);
              say(ja);
            }}
          >
            {ja}
          </button>
        ))}
      </div>
      <div>
        {right.map((zh) => (
          <button
            key={zh}
            className={`match-card zh-card ${doneZh.includes(zh) ? "gone" : ""} ${bad.includes(zh) ? "bad" : ""}`}
            disabled={doneZh.includes(zh)}
            onClick={() => tapZh(zh)}
          >
            {zh}
          </button>
        ))}
      </div>
    </div>
  );
}
