"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ASK_VOICE } from "@/content/kokoro-patterns";
import { CHAINED, LEVELS, TIERS, TIER_NAME, replyPass, seedKey, tierOf, type DrillOp, type DrillReply, type DrillStep, type Ladder } from "@/lib/drill-model";
import { BUILD_PATH, DRILL_PATH, PATH_ITEMS } from "@/content/drill-path";
import { DAYS_TO_CLEAR, cleared, dueAgain, fastDays, fastMs, findSeed, judge, loadLadder, marked as splitMark, nextOnPath, prefetchLadder, readSeeds, replyRound, saveSeed, withReplies, type Seed } from "@/lib/client/drill";
import { flowOf } from "@/lib/client/fluency";
import { chime, confetti, verdict, type Kind } from "@/lib/client/fx";
import { play, preload, stop as stopAudio, ttsUrl, unlock } from "@/lib/client/player";
import { recordDrill, recordSpeech, useProgress, wavSeconds } from "@/lib/client/progress";
import { transcribe } from "@/lib/client/recorder";
import { readSilent, writeSilent } from "@/lib/client/silent";
import ReplyRound, { type ReplyRun } from "./DrillReply";
import DrillTime from "./DrillTime";
import HoldButton, { type MicPhase } from "./HoldButton";
import Info from "./Info";

const VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";
const SPEED = LEVELS + 1; // the level after the four: every sentence again, as fast as it comes
const IDLE = 45_000; // no tap or voice for this long: the clock stops
const FLUSH = 15; // seconds counted before they are saved

// Reaction time as if the sentence were 12 characters, by the same length rule as the speed clock.
const scaled = (ms: number, ja: string) => Math.round((ms * (2000 + 60 * 12)) / (2000 + 60 * ja.length));
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

type Mode = "home" | "loading" | "play" | "up" | "reply" | "done";
type Result = { kind: Kind; heard: string; ms: number | null; peek?: boolean };
type Run = { i: number; ok: boolean; ms: number | null };

// Said right, from memory, and soon enough for its length.
const fastRun = (l: Ladder, r: Run) => r.ok && r.ms !== null && r.ms <= fastMs(l.steps[r.i].ja, tierOf(l));

const OP_MARK: Record<DrillOp, string> = { base: "●", sub: "⇄", form: "形", add: "＋", build: "組", fix: "直", join: "繋", put: "入", finish: "…" };
// The level-up screen names what the next level does.
const OP_NAME: Partial<Record<DrillOp, string>> = { build: "組み立てる", fix: "直す", join: "つなぐ", put: "入れる", finish: "最後まで" };
const LV_NAME = ["", "", "広げる", "形を変える", "長くする"];

// Mixed up, so the order gives nothing away.
const shuffle = (xs: number[]) => {
  const a = [...xs];
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [a[k], a[j]] = [a[j], a[k]];
  }
  return a;
};

// 型ドリル: type a word or grammar point; 森先生 gives one change at a time (swap a word, change the
// form, say more) and the whole sentence is said out loud at once, four levels from two words up. Then
// a speed round of every sentence from its Chinese alone, mixed up, with no sentence before it to copy
// from (the cue a tap away, and then not counted fast), again until each comes in time. Last, 返す
// (DrillReply.tsx): 森先生 says a line and it is answered with the word or grammar point, in sentences
// the ladder never had. A 返す round passed is what counts as a day toward 升级; on the second day it is
// played straight away, without the ladder first.
export default function Drill() {
  const [mode, setMode] = useState<Mode>("home");
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [text, setText] = useState("");
  const [ladder, setLadder] = useState<Ladder | null>(null);
  const [error, setError] = useState("");
  const [lv, setLv] = useState(1);
  const [queue, setQueue] = useState<number[]>([]);
  const [pos, setPos] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [combo, setCombo] = useState(0);
  const [done, setDone] = useState(0); // steps said right in the levels
  const [lastRuns, setLastRuns] = useState<Run[]>([]);
  // 返す: the round being played, how it went, and whether it was played without the ladder before it
  // (the second day's check).
  const [round, setRound] = useState<DrillReply[] | null>(null);
  const [reRuns, setReRuns] = useState<ReplyRun[] | null>(null);
  const [direct, setDirect] = useState(false);
  const t = useRef({ shown: 0, live: 0, again: new Set<number>(), ok: new Set<number>(), runs: [] as Run[], typed: "", card: 0, next: 0 as ReturnType<typeof setTimeout> | 0, act: 0, pend: 0, sess: 0, replied: false }).current;
  const progress = useProgress();
  const [sess, setSess] = useState(0); // seconds this word, for the done screen
  const [mic, setMic] = useState<MicPhase>("idle");
  // 声なし: said in the head, the answer heard, marked by the learner. reveal: the answer is shown and
  // waits for that mark, with how soon 頭で言えた was tapped.
  const [silent, setSilent] = useState(false);
  const [reveal, setReveal] = useState<{ ms: number } | null>(null);
  const quietRun = useRef(false);
  // Speed round: the cue was looked at for this card.
  const [hint, setHint] = useState(false);

  // Practice time: while a card or level-up is on screen, the page is in view and something happened
  // in the last 45 s. Saved every 15 s, and when leaving play or the page.
  useEffect(() => {
    if (mode !== "play" && mode !== "up" && mode !== "reply") return;
    const flush = () => {
      if (t.pend) recordDrill(t.pend);
      t.pend = 0;
    };
    const tick = setInterval(() => {
      if (document.hidden || Date.now() - t.act > IDLE) return;
      t.pend++;
      t.sess++;
      if (t.pend >= FLUSH) flush();
    }, 1000);
    const hide = () => document.hidden && flush();
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", hide);
      flush();
      setSess(t.sess);
    };
  }, [mode, t]);

  useEffect(() => {
    setSeeds(readSeeds());
    setSilent(readSilent());
    // Opened from 話す or 私の一言 with a word to start on.
    const s = new URLSearchParams(location.search).get("s");
    if (s) {
      history.replaceState(null, "", "/drill");
      open(s);
    }
    return () => {
      t.card++;
      stopAudio();
      if (t.next) clearTimeout(t.next);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On the done screen, the ladder its main button opens is made now (升级, or the next on the list),
  // so the tap starts at once instead of a 30-90 s wait.
  useEffect(() => {
    if (mode !== "done" || !ladder || !passedNow(ladder)) return;
    const tier = tierOf(ladder);
    if (cleared(findSeed(seeds, t.typed), tier) && tier < TIERS) return prefetchLadder(t.typed, tier + 1);
    const after = nextOnPath(seeds);
    const rec = after ? findSeed(seeds, after.seed) : undefined;
    if (after && seedKey(after.seed) !== seedKey(t.typed) && (!rec || dueAgain(rec))) prefetchLadder(after.seed, rec?.tier ?? 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const i = queue[pos] ?? -1;
  const step: DrillStep | null = ladder && i >= 0 ? ladder.steps[i] : null;

  // A new card: the clock starts for how soon speaking begins.
  useEffect(() => {
    t.shown = Date.now();
    t.act = t.shown;
    t.live = 0;
    setHint(false);
  }, [pos, queue, mode, t]);

  // Today counts toward 升级: this session's 返す round passed, or, on a ladder with none, its speed
  // round came fast all through.
  const passedNow = (l: Ladder) =>
    reRuns ? reRuns.filter((x) => x.kind === "right").length >= replyPass(reRuns.length) : !l.replies?.length && lastRuns.length > 0 && lastRuns.every((r) => fastRun(l, r));

  // A word or grammar point at its tier: the highest opened unless one is given (升级, or 新しい文 at this one).
  async function open(seed: string, fresh = false, tier?: number) {
    const s = seed.trim();
    if (!s) return;
    unlock();
    setError("");
    setMode("loading");
    t.typed = s;
    try {
      const rec = findSeed(readSeeds(), s);
      let l = await loadLadder(s, fresh, tier ?? rec?.tier ?? 1);
      // Due for its second day: 返す straight away (new sentences, nothing warmed up first). Not in 声なし,
      // which is the ladder said in the head.
      const due = !fresh && tier === undefined && dueAgain(rec) && !readSilent();
      // A ladder kept from before 返す gets its rounds: waited for when they are all there is to play,
      // else written while the ladder is practised.
      if (due && !l.replies?.length) l = await withReplies(s, l).catch(() => l);
      else if (!l.replies?.length) withReplies(s, l).then((got) => t.typed === s && setLadder((cur) => (cur && cur.made === got.made ? got : cur)), () => {});
      // Every sentence's voice fetched now, so a right answer is heard at once.
      preload(l.steps.map((x) => ttsUrl(x.ja, VOICE)));
      setLadder(l);
      setLastRuns([]);
      setReRuns(null);
      t.replied = false;
      t.sess = 0;
      quietRun.current = false;
      if (!(due && startReply(l, true))) startLevels(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : "出题失败");
      setSeeds(readSeeds());
      setMode("home");
    }
  }

  const levelSteps = (l: Ladder, n: number) => l.steps.map((s, k) => (s.lv === n ? k : -1)).filter((k) => k >= 0);

  function startLevels(l: Ladder) {
    t.again.clear();
    t.ok.clear();
    setCombo(0);
    setDone(0);
    t.runs = [];
    quietRun.current = false;
    goLevel(l, 1);
  }

  // 返す on this ladder: the round not played yet. false when it has none.
  function startReply(l: Ladder, alone: boolean) {
    const next = replyRound(l, findSeed(readSeeds(), t.typed));
    if (!next) return false;
    preload(next.map((x) => ttsUrl(x.ask, ASK_VOICE)));
    t.replied = true;
    t.act = Date.now();
    setRound(next);
    setDirect(alone);
    setResult(null);
    setReveal(null);
    setMode("reply");
    return true;
  }

  function replied(runs: ReplyRun[]) {
    if (!ladder) return;
    const right = runs.filter((x) => x.kind === "right").length;
    saveSeed(ladder, null, Date.now(), t.typed, { right, total: runs.length });
    if (right >= replyPass(runs.length)) confetti(70);
    setReRuns(runs);
    setSeeds(readSeeds());
    setMode("done");
  }

  function goLevel(l: Ladder, n: number) {
    let k = n;
    while (k <= LEVELS && !levelSteps(l, k).length) k++;
    setLv(k);
    // The speed round counts toward 定着 by itself: said aloud there, it counts whatever the levels were.
    if (k > LEVELS) quietRun.current = false;
    setQueue(k > LEVELS ? shuffle(l.steps.map((_, x) => x)) : levelSteps(l, k));
    setPos(0);
    setResult(null);
    setReveal(null);
    setHint(false);
    setMode("play");
  }

  // The speed round again, with only what wasn't fast yet.
  function speedAgain() {
    if (!ladder) return;
    const slow = lastRuns.filter((r) => !fastRun(ladder, r)).map((r) => r.i);
    setLv(SPEED);
    setQueue(shuffle(slow.length ? slow : ladder.steps.map((_, x) => x)));
    t.runs = [];
    quietRun.current = false;
    setHint(false);
    setPos(0);
    setResult(null);
    setMode("play");
  }

  const say = (ja: string) => play(ttsUrl(ja, VOICE)).catch(() => {});
  const hear = (s: DrillStep) => say(s.ja);

  // After a 返す round that didn't pass: the ladder once more, and 返す (its other round) after it.
  function ladderAgain(l: Ladder) {
    setReRuns(null);
    setLastRuns([]);
    setDirect(false);
    t.replied = false;
    startLevels(l);
  }

  async function onRecorded(wav: Blob) {
    if (!step) return;
    const card = t.card;
    const live = t.live;
    t.act = Date.now();
    setBusy(true);
    setError("");
    try {
      // How soon after the card the voice began: the mic going live plus where speech starts in it.
      const flow = await flowOf(wav).catch(() => null);
      const ms = live && flow?.runs.length ? Math.max(0, Math.round(live + flow.runs[0][0] * 1000 - t.shown)) : null;
      const r = await transcribe(wav, step.ja);
      // Left (×) or moved on while it was being checked: this result is for a card no longer shown.
      if (card !== t.card) return;
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      if (!r.text) {
        setError("聞き取れませんでした");
        return;
      }
      show(judge(r, step, i > 0 ? ladder?.steps[i - 1] : undefined), r.text, ms);
    } catch {
      setError("聞き取れませんでした");
    } finally {
      setBusy(false);
    }
  }

  function peek() {
    t.act = Date.now();
    if (!step) return;
    show("wrong", "", null, true);
  }

  // 声なし: 頭で言えた shows the answer and plays it; the learner marks it.
  function thought() {
    if (!step) return;
    t.act = Date.now();
    setReveal({ ms: Date.now() - t.shown });
    hear(step);
  }

  function marked(ok: boolean) {
    if (!reveal) return;
    quietRun.current = true;
    const ms = reveal.ms;
    setReveal(null);
    show(ok ? "right" : "wrong", "", ms, false, true);
  }

  // quiet: marked by the learner after hearing it (声なし): not played again, and its time is a tap, not a voice.
  function show(kind: Kind, heard: string, ms: number | null, peeked = false, quiet = false) {
    if (!step || !ladder) return;
    verdict(kind, peeked, false);
    setResult({ kind, heard, ms, peek: peeked });
    setCombo((c) => {
      const n = kind === "right" ? c + 1 : 0;
      // 5, 10, 15… right in a row: a little burst.
      if (n >= 5 && n % 5 === 0) setTimeout(() => confetti(n >= 10 ? 36 : 18), 120);
      return n;
    });
    let quick = false;
    if (lv === SPEED) {
      // Said again after a miss or the answer, or after the cue was looked at: right, but not from
      // memory, so no time.
      const first = !t.runs.some((x) => x.i === i) && !hint;
      if (kind === "right" && first && ms !== null && !quiet) recordDrill(0, scaled(ms, step.ja));
      t.runs = [...t.runs.filter((x) => x.i !== i), { i, ok: kind === "right", ms: kind === "right" && first ? ms : null }];
      quick = kind === "right" && first && ms !== null && ms <= fastMs(step.ja, tierOf(ladder));
    } else if (kind === "right") {
      if (!t.ok.has(i)) {
        t.ok.add(i);
        setDone((d) => d + 1);
      }
    } else if (!t.again.has(i)) {
      // Missed: comes back at the end of this level.
      t.again.add(i);
      setQueue((q) => [...q, i]);
    }
    // Right: the sentence is said once, then on by itself.
    const card = t.card;
    // Fast in the speed round: the ピンポン only and straight on, so the round keeps its beat.
    const said = quiet || quick ? new Promise<void>((ok) => setTimeout(ok, quick ? 100 : 150)) : hear(step);
    // Not when the learner moved on (or said it again) while it played.
    if (kind === "right") said.then(() => card === t.card && (t.next = setTimeout(next, lv === SPEED ? 250 : 500)));
  }

  function retry() {
    t.act = Date.now();
    t.card++;
    stopAudio();
    setResult(null);
    setReveal(null);
    t.shown = Date.now();
    t.live = 0;
  }

  function next() {
    t.card++;
    if (t.next) clearTimeout(t.next);
    t.next = 0;
    stopAudio();
    if (!ladder) return;
    setResult(null);
    setReveal(null);
    // In the same render as the next card, so its cue never shows for a frame.
    setHint(false);
    if (pos + 1 < queue.length) {
      setPos((p) => p + 1);
      return;
    }
    if (lv === SPEED) {
      const r = t.runs;
      const fast = r.filter((x) => fastRun(ladder, x)).length;
      setLastRuns(r);
      // A second speed round has only the slow ones: the rest were fast already. Said in the head
      // (声なし), it isn't the mouth being fast: kept as practised, not toward 定着.
      if (quietRun.current) saveSeed(ladder, null, Date.now(), t.typed);
      else saveSeed(ladder, fast + (ladder.steps.length - r.length), Date.now(), t.typed);
      setSeeds(readSeeds());
      // Then 返す, once a session, said aloud.
      if (!t.replied && !quietRun.current && !silent && ladder.replies?.length) {
        chime(true);
        setMode("up");
        t.next = setTimeout(() => startReply(ladder, false) || setMode("done"), 1500);
        return;
      }
      if (fast === r.length) confetti(70);
      setMode("done");
      return;
    }
    // A level done.
    if (lv === LEVELS) saveSeed(ladder, null, Date.now(), t.typed);
    chime(true);
    if (lv === LEVELS) confetti(40);
    setMode("up");
    const to = lv + 1;
    t.next = setTimeout(() => goLevel(ladder, to), 1500);
  }

  function home() {
    t.card++;
    stopAudio();
    if (t.next) clearTimeout(t.next);
    setSeeds(readSeeds());
    setMode("home");
    setResult(null);
    setReveal(null);
  }

  function toggleSilent() {
    writeSilent(!silent);
    setSilent(!silent);
    setReveal(null);
  }

  const silentBtn = (
    <button className={`hi-silent${silent ? " on" : ""}`} aria-pressed={silent} onClick={toggleSilent}>
      {silent ? "🔇 声なし" : "🔈 声あり"}
    </button>
  );

  // ---- screens ----

  if (mode === "home" || mode === "loading") {
    const loading = mode === "loading";
    const nextItem = nextOnPath(seeds);
    // Typed by the learner, not on the list.
    const own = seeds.filter((x) => !PATH_ITEMS.some((p) => findSeed([x], p.seed)));
    return (
      <main className="dr">
        <Link href="/speak" className="back" aria-label="戻る">←</Link>
        <div className="dr-head">
          <h1 className="dr-title">型ドリル</h1>
          {silentBtn}
          <Info label="声なし">
            不能出声时用：看到提示，在脑子里把整句完整说出来（能动嘴不出声更好），点「頭で言えた」，听答案，自己判 ✓/✕。研究：在脑中提取和出声提取对记忆的帮助差不多（Smith 等 2013），但嘴的熟练只能靠出声练，所以声なし不算进「定着」和升级。
          </Info>
        </div>
        <DrillTime p={progress} />
        {error && <p className="error">{error}</p>}
        {loading ? (
          <div className="dr-making" aria-label="作成中">
            {[0, 1, 2, 3].map((k) => (
              <i key={k} style={{ animationDelay: `${k * 0.18}s` }} />
            ))}
          </div>
        ) : (
          <>
            {nextItem && (
              <button className="dr-next" onClick={() => open(nextItem.seed)}>
                <span>
                  <b>{nextItem.seed}</b>
                  <small lang="zh-Hans">{nextItem.zh}</small>
                </span>
                <i aria-hidden>▶</i>
              </button>
            )}
            <form
              className="dr-input"
              onSubmit={(e) => {
                e.preventDefault();
                open(text);
              }}
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="食べる・〜てしまう"
                aria-label="単語・文法"
                maxLength={30}
                enterKeyHint="go"
                disabled={loading}
              />
              <button type="submit" disabled={loading || !text.trim()} aria-label="始める">
                {loading ? <span className="dr-spin" /> : "▶"}
              </button>
            </form>
            {own.length > 0 && (
              <div className="dr-seeds">
                {own.map((x) => (
                  <Chip key={x.seed} seed={x.seed} rec={x} onOpen={() => open(x.seed)} />
                ))}
              </div>
            )}
            {[...BUILD_PATH, ...DRILL_PATH].map((stage) => (
              <section key={stage.name} className="dr-stage">
                <h2>
                  {stage.name}
                  <span>
                    {stage.items.filter((x) => cleared(findSeed(seeds, x.seed), 1)).length}/{stage.items.length}
                  </span>
                </h2>
                <div className="dr-seeds">
                  {stage.items.map((x) => (
                    <Chip key={x.seed} seed={x.seed} rec={findSeed(seeds, x.seed)} onOpen={() => open(x.seed)} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    );
  }

  if (!ladder) return null;

  if (mode === "up") {
    const to = lv + 1;
    const firstOp = to <= LEVELS ? ladder.steps.find((x) => x.lv === to)?.op : undefined;
    const name = firstOp && OP_NAME[firstOp] ? OP_NAME[firstOp] : LV_NAME[to];
    return (
      <main className="dr dr-upwrap">
        <div className="dr-up">
          <span>{lv === SPEED ? "返" : to > LEVELS ? "⚡" : `Lv${to}`}</span>
          <b>{lv === SPEED ? "返す" : to > LEVELS ? "スピード" : name}</b>
        </div>
      </main>
    );
  }

  if (mode === "reply") {
    if (!round) return null;
    return <ReplyRound key={`${ladder.made}-${round[0]?.ask}`} ladder={ladder} round={round} onAct={() => (t.act = Date.now())} onClose={home} onDone={replied} />;
  }

  if (mode === "done") {
    const fast = lastRuns.filter((r) => fastRun(ladder, r));
    const all = fast.length === lastRuns.length;
    const tier = tierOf(ladder);
    const right = reRuns?.filter((x) => x.kind === "right").length ?? 0;
    // Today counted (返す passed; on a ladder with none, every sentence fast).
    const passed = passedNow(ladder);
    // …and it was the second day: the next tier opens.
    const up = passed && cleared(findSeed(seeds, t.typed), tier) && tier < TIERS;
    const days = Math.min(DAYS_TO_CLEAR, fastDays(findSeed(seeds, t.typed), tier));
    const after = nextOnPath(seeds);
    // Where the main button goes once today is done: the next on the list (one never opened, or one due
    // for its second day), not this word again.
    const onward = after && seedKey(after.seed) !== seedKey(t.typed) && (findSeed(seeds, after.seed) === undefined || dueAgain(findSeed(seeds, after.seed)));
    return (
      <main className="dr">
        <button className="back" aria-label="戻る" onClick={home}>←</button>
        <h1 className="dr-title">
          {ladder.seed}
          {tier > 1 && <span className="dr-tier">{TIER_NAME[tier]}</span>}
        </h1>
        {reRuns && (
          <div className={`dr-score${passed ? " all" : ""}`} aria-label={`返す ${right}/${reRuns.length}`}>
            <b>返 {right}</b>
            <span>/ {reRuns.length}</span>
            {sess > 0 && <em aria-label="練習時間">⏱ {clock(sess)}</em>}
          </div>
        )}
        {lastRuns.length > 0 && (
          <div className={`dr-score${all ? " all" : ""}${reRuns ? " sub" : ""}`}>
            <b>⚡ {fast.length}</b>
            <span>/ {lastRuns.length}</span>
            {!reRuns && sess > 0 && <em aria-label="練習時間">⏱ {clock(sess)}</em>}
            {quietRun.current && <em aria-label="声なし">🔇</em>}
          </div>
        )}
        {passed && tier < TIERS && !quietRun.current && (
          <div className={`dr-days${up ? " met" : ""}`} aria-label={`定着 ${days}/${DAYS_TO_CLEAR}`}>
            <span>定着</span>
            {Array.from({ length: DAYS_TO_CLEAR }, (_, k) => (
              <i key={k} className={k < days ? "on" : ""}>{k < days ? "⚡" : ""}</i>
            ))}
            {!up && <b>明日 ↑{TIER_NAME[tier + 1]}</b>}
            <Info label="升级条件">
              「返す」过关（6 句里对 5 句）算一天，分开两天都过关才升级。「返す」是听森先生说一句、用这个型回一句，句子都是阶梯里没练过的：在新句子里用得出来才算会（de Jong &amp; Perfetti 2011）。同一天练到熟只是短期记忆，隔天还能做到才算记住（Rawson &amp; Dunlosky，连续再学习）。
            </Info>
          </div>
        )}
        <div className="dr-list">
          {reRuns?.map((x, k) => (
            <button key={`re${k}`} className="dr-row" onClick={() => say((x.r.own && (x.better || x.said)) || x.r.ja)}>
              <i className={x.kind === "right" ? "ok" : x.kind === "close" ? "mid" : "no"} aria-hidden>{x.fast ? "⚡" : x.kind === "right" ? "✓" : x.kind === "close" ? "△" : "✕"}</i>
              <span>
                {(x.r.own && (x.better || x.said)) || x.r.ja}
                <small>{x.r.ask}</small>
              </span>
              {x.ms !== null && <em>{(x.ms / 1000).toFixed(1)}s</em>}
            </button>
          ))}
          {lastRuns.map((r) => {
            const s = ladder.steps[r.i];
            const ok = fastRun(ladder, r);
            return (
              <button key={r.i} className="dr-row" onClick={() => hear(s)}>
                <i className={ok ? "ok" : r.ok ? "mid" : "no"} aria-hidden>{ok ? "⚡" : r.ok ? "✓" : "✕"}</i>
                <span>
                  {s.ja}
                  <small>{s.zh}</small>
                </span>
                {r.ok && r.ms !== null && <em>{(r.ms / 1000).toFixed(1)}s</em>}
              </button>
            );
          })}
        </div>
        <div className="dr-foot">
          {up ? (
            <>
              <button
                className="dr-go dr-up-go"
                onClick={() => open(t.typed, false, tier + 1)}
              >
                ↑ {TIER_NAME[tier + 1]}
              </button>
              <button className="ko-on" onClick={() => open(t.typed, true, tier)}>＋ 新しい文</button>
            </>
          ) : reRuns && !passed ? (
            <>
              {/* 返す not passed: the ladder when it was played without it, else the other round. */}
              {direct ? (
                <button className="dr-go" onClick={() => ladderAgain(ladder)}>▶ はしご</button>
              ) : (
                <button className="dr-go" onClick={() => startReply(ladder, false)}>返 もう一回</button>
              )}
              <button className="ko-on" onClick={home}>一覧</button>
            </>
          ) : !reRuns && !all ? (
            <>
              <button className="dr-go" onClick={speedAgain}>⚡ もう一回</button>
              <button className="ko-on" onClick={() => open(t.typed, true, tier)}>＋ 新しい文</button>
            </>
          ) : (
            <>
              {onward ? (
                <button className="dr-go" onClick={() => open(after.seed)}>▶ {after.seed}</button>
              ) : (
                <button className="dr-go" onClick={() => open(t.typed, true, tier)}>＋ 新しい文</button>
              )}
              <button className="ko-on" onClick={home}>一覧</button>
            </>
          )}
        </div>
      </main>
    );
  }

  // ---- play ----
  if (!step) return null;
  const speed = lv === SPEED;
  const prev = i > 0 ? ladder.steps[i - 1].ja : "";
  const chained = CHAINED.includes(step.op);
  const [same1, changed, same2] = splitMark(step, prev);
  const won = result?.kind === "right";
  const total = speed ? queue.length : ladder.steps.length;
  const count = speed ? pos + (result ? 1 : 0) : done;

  return (
    <main className={`dr dr-play op-${speed ? "speed" : step.op === "finish" ? "join" : step.op === "put" ? "form" : step.op}`}>
      <div className="dr-top">
        <button className="dr-x" aria-label="閉じる" onClick={home}>×</button>
        <div className="dr-lvs" aria-label={speed ? "スピード" : `レベル${lv}`}>
          {Array.from({ length: LEVELS }, (_, k) => (
            <i key={k} className={k + 1 < lv ? "d" : k + 1 === lv ? "n" : ""}>{k + 1}</i>
          ))}
          <i className={speed ? "n bolt" : "bolt"}>⚡</i>
        </div>
        {combo >= 2 ? (
          <span className="dr-combo" key={combo}>{combo >= 5 ? "🔥 " : ""}{combo} 連</span>
        ) : tierOf(ladder) > 1 ? (
          <span className="dr-tier sm">{TIER_NAME[tierOf(ladder)]}</span>
        ) : (
          <span className="dr-combo-sp" />
        )}
        {silentBtn}
      </div>
      <div className="dr-bar" aria-hidden>
        <i style={{ width: `${Math.min(100, (count / Math.max(1, total)) * 100)}%` }} />
      </div>

      <section className={`dr-card${won ? " won" : ""}`} key={`${lv}-${pos}`}>
        {speed ? (
          <div className="dr-zhcue">
            <b lang="zh-Hans">{step.zh}</b>
            {hint ? (
              <span className="dr-hinted">
                <i aria-hidden>{OP_MARK[step.op]}</i>
                {step.op === "base" ? ladder.seed : step.cue}
              </span>
            ) : (
              !result && !reveal && (
                <button className="dr-hint" onClick={() => setHint(true)}>
                  ヒント
                </button>
              )
            )}
          </div>
        ) : chained ? (
          <>
            {prev && step.op !== "base" && <p className="dr-prev">{prev}</p>}
            <div className="dr-cue">
              <span className="dr-op" aria-hidden>{OP_MARK[step.op]}</span>
              <b>{step.op === "base" ? ladder.seed : step.cue}</b>
              <small lang="zh-Hans">{step.op === "base" ? step.zh : step.cue_zh}</small>
            </div>
          </>
        ) : (
          <BuildCard step={step} />
        )}
        {speed && !result && <div className="dr-clock" key={`${pos}-${queue.length}`} style={{ animationDuration: `${fastMs(step.ja, tierOf(ladder))}ms` }} aria-hidden />}
      </section>

      <section className={`dr-ans${result ? ` is-${result.kind}` : ""}`}>
        {reveal && !result ? (
          <>
            <p className="dr-ja" onClick={() => hear(step)}>
              {same1}
              <span className="dr-new">{changed}</span>
              {same2}
            </p>
            {!speed && <p className="dr-zh" lang="zh-Hans">{step.zh}</p>}
          </>
        ) : result ? (
          <>
            <div className="dr-mark" aria-label={result.kind === "right" ? "正解" : result.kind === "close" ? "惜しい" : "答え"}>
              {result.kind === "right" ? "✓" : result.kind === "close" ? "△" : result.peek ? "答え" : "✕"}
              {result.kind === "right" && result.ms !== null && <em>{(result.ms / 1000).toFixed(1)}s</em>}
            </div>
            <p
              className="dr-ja"
              onClick={() => {
                // Hearing it again: stays on this card until 次へ.
                if (result.kind === "right") {
                  t.card++;
                  if (t.next) clearTimeout(t.next);
                  t.next = 0;
                }
                hear(step);
              }}
            >
              {same1}
              <span className="dr-new">{changed}</span>
              {same2}
            </p>
            {!speed && <p className="dr-zh" lang="zh-Hans">{step.zh}</p>}
            {result.heard && result.kind !== "right" && <p className="dr-heard">{result.heard}</p>}
          </>
        ) : (
          <div className={`dr-blank${busy ? "" : ` mic-${mic}`}`} aria-live="polite">
            {busy ? (
              <span className="dr-spin dark" role="img" aria-label="判定中" />
            ) : silent ? (
              <span className="dr-think" aria-hidden>🤫</span>
            ) : mic === "live" ? (
              <>
                <span className="dr-wave" aria-hidden>
                  {[0, 1, 2, 3, 4].map((k) => (
                    <i key={k} style={{ animationDelay: `${[0.2, 0, 0.35, 0.1, 0.25][k]}s` }} />
                  ))}
                </span>
                <b>話して</b>
              </>
            ) : mic === "starting" ? (
              <b>待って…</b>
            ) : (
              <span aria-hidden>？</span>
            )}
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      <div className="dr-dock">
        {result ? (
          <div className="dr-btns">
            {result.kind !== "right" && <button className="dr-ghost" onClick={retry}>もう一回</button>}
            <button className="dr-go" onClick={next}>次へ</button>
          </div>
        ) : reveal ? (
          <div className="dr-btns">
            <button className="dr-ghost hi-no" onClick={() => marked(false)}>✕ 違った</button>
            <button className="dr-go hi-yes" onClick={() => marked(true)}>✓ 言えた</button>
          </div>
        ) : silent ? (
          <div className="dr-btns">
            <button className="dr-ghost" onClick={peek}>答え</button>
            <button className="dr-go" onClick={thought}>頭で言えた</button>
          </div>
        ) : (
          <div className="dr-btns">
            <button className="dr-ghost" onClick={peek} disabled={busy}>答え</button>
            <div className="dr-mic">
              <HoldButton
                label={busy ? "…" : "● 話す"}
                disabled={busy}
                onLive={() => {
                  t.live = Date.now();
                  t.act = t.live;
                }}
                onPhase={setMic}
                onRecorded={onRecorded}
                onError={setError}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// A card that builds its sentence instead of changing the one before: words without their particles to
// put together, a sentence said wrong to fix, short sentences to join, a sentence to put in a frame, or
// the start of one to finish. On a right answer the pieces fly together (CSS .won).
function BuildCard({ step }: { step: DrillStep }) {
  const parts = step.parts?.length ? step.parts : [step.cue];
  // Tiles in an order that isn't the sentence's (the model may give them in order).
  const [tiles] = useState(() => {
    if (step.op !== "build" || parts.length < 2) return parts;
    for (let k = 0; k < 6; k++) {
      const t = shuffle(parts.map((_, x) => x)).map((x) => parts[x]);
      if (t.join() !== parts.join()) return t;
    }
    return [...parts].reverse();
  });
  const head = (
    <span className="dr-op" aria-hidden>
      {OP_MARK[step.op]}
    </span>
  );
  if (step.op === "build")
    return (
      <div className="dr-build">
        {head}
        <div className="dr-tiles">
          {tiles.map((w, k) => (
            <span key={k} className="dr-tile" style={{ animationDelay: `${k * 0.07}s`, ["--r" as string]: `${((k * 37) % 7) - 3}deg` }}>
              {w}
            </span>
          ))}
        </div>
        <small lang="zh-Hans">{step.zh}</small>
      </div>
    );
  if (step.op === "fix")
    return (
      <div className="dr-fixcard">
        {head}
        <p className="dr-wrong">{parts[0]}</p>
        <small lang="zh-Hans">{step.cue_zh}</small>
      </div>
    );
  if (step.op === "join")
    return (
      <div className="dr-joincard">
        <div className="dr-glue">
          {head}
          <b>{step.cue}</b>
        </div>
        <div className="dr-pieces">
          {parts.map((p, k) => (
            <span key={k} className="dr-piece" style={{ animationDelay: `${k * 0.1}s` }}>
              {p}
            </span>
          ))}
        </div>
        <small lang="zh-Hans">{step.cue_zh}</small>
      </div>
    );
  if (step.op === "put") {
    const [a, ...rest] = step.cue.split(/[〜～]/);
    const b = rest.join("〜");
    return (
      <div className="dr-putcard">
        <span className="dr-piece">{parts[0]}</span>
        <i className="dr-down" aria-hidden>↓</i>
        <div className="dr-frame">
          {head}
          <b>
            {a}
            <span className="dr-slot" aria-label="ここに入れる" />
            {rest.length ? b : ""}
          </b>
        </div>
        <small lang="zh-Hans">{step.cue_zh}</small>
      </div>
    );
  }
  return (
    <div className="dr-finishcard">
      {head}
      <p className="dr-half">
        {parts[0]}
        <span className="dr-caret" aria-hidden />
      </p>
      <small lang="zh-Hans">{step.cue_zh}</small>
    </div>
  );
}

// One word or grammar point on the list: ⚡ when every sentence of its current tier came fast, its
// tier once 升级 is open.
function Chip({ seed, rec, onOpen }: { seed: string; rec?: Seed; onOpen: () => void }) {
  const run = rec?.tiers[rec.tier];
  const full = cleared(rec);
  // One day done: one more to go.
  const half = !full && fastDays(rec) >= 1;
  return (
    <button className={`dr-seed${rec ? " seen" : ""}${full ? " full" : ""}${half ? " half" : ""}`} onClick={onOpen}>
      <b>{seed}</b>
      {rec && rec.tier > 1 && <em>{TIER_NAME[rec.tier]}</em>}
      {run && run.fast > 0 ? (
        <span aria-label={half ? "定着 1/2" : `スピード ${run.fast}/${run.total}`}>{full ? "⚡" : half ? "⚡½" : `⚡${run.fast}/${run.total}`}</span>
      ) : rec ? (
        <span className="mid" aria-label="練習した">✓</span>
      ) : null}
    </button>
  );
}
