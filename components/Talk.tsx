"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Scenario } from "@/content/scenarios";
import type { Feedback, Hint, Turn, TurnCheck } from "@/lib/claude";
import { byChars, type Part } from "@/lib/say-match";
import { closeness, sfx, verdict } from "@/lib/client/fx";
import { npc } from "@/lib/client/game";
import { play, stop, ttsUrl, unlock } from "@/lib/client/player";
import { transcribe } from "@/lib/client/recorder";
import {
  knownTags,
  recordFeedback,
  recordPoints,
  recordSpeech,
  recordTalkTurn,
  useProgress,
  wavSeconds,
} from "@/lib/client/progress";
import HoldButton from "./HoldButton";
import TurnNote from "./TurnNote";
import FeedbackCard, { Star } from "./FeedbackCard";
import Note from "./Note";

type Message = Turn & { zh?: string };
type Plan = { tasks: string[]; twist?: { zh: string; ja: string } };
type Phase = "brief" | "live" | "end";
type Reply = { ja: string; zh: string; finished: boolean; done: number[] };

// The partner is told to close after 8 things said; one more and the round ends here whatever it does.
const MAX_TURNS = 9;
// Lines to say again once the talk is over: enough to be worth it, few enough to finish.
const REDO_MAX = 3;
// Said closely enough to count (speech recognition writes kanji or kana as it likes).
const REDO_PASS = 0.8;

const hira = (s: string) => s.normalize("NFKC").replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "出错了");
  return data as T;
}

// The scene's conversation, as a small job to get done: three things to get said (ticked off as the
// partner hears them), help that starts with the first words only, and when the talk is over the
// lines that came out wrong are said again before a second round with one new turn in it.
export default function Talk({ scenario, active }: { scenario: Scenario; active: boolean }) {
  const [phase, setPhase] = useState<Phase>("brief");
  const [round, setRound] = useState(1);
  const [messages, setMessages] = useState<Message[]>([]);
  const [done, setDone] = useState<number[]>([]);
  const [notes, setNotes] = useState<Record<number, TurnCheck>>({});
  const [shownZh, setShownZh] = useState<Set<number>>(new Set());
  // The partner's lines whose words are on screen. A new line is heard first (blurred, like 聞く), and
  // read once its voice has finished or it is tapped: ears before eyes, the text still there to check.
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"" | "stt" | "ai" | "hint">("");
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [hintOpen, setHintOpen] = useState(false);
  const [hintFull, setHintFull] = useState(false);
  const [wantZh, setWantZh] = useState("");
  const [hint, setHint] = useState<Hint | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [redoAt, setRedoAt] = useState(0);
  const [redoTry, setRedoTry] = useState<{ parts: Part[]; ok: boolean } | null>(null);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const progress = useProgress();

  // A scene written before scenes had tasks is given some the first time its talk is opened.
  const own = scenario.talk.tasks?.length ? { tasks: scenario.talk.tasks, twist: scenario.talk.twist } : null;
  const [plan, setPlan] = useState<Plan | null>(own);
  const [planning, setPlanning] = useState(false);
  const asked = useRef(false);
  useEffect(() => {
    if (own || !active || asked.current) return;
    asked.current = true;
    let live = true;
    setPlanning(true);
    post<Plan>("/api/chat", { scenarioId: scenario.id, talk: scenario.talk, history: [], mode: "plan" })
      .then((p) => live && setPlan(p))
      .catch(() => {})
      .finally(() => live && setPlanning(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, scenario.id]);
  const talk = useMemo(() => (plan ? { ...scenario.talk, tasks: plan.tasks, twist: plan.twist } : scenario.talk), [scenario.talk, plan]);
  const tasks = plan?.tasks ?? [];
  const twist = plan?.twist;
  const card = { p: progress, voice: talk.aiVoice, scenarioId: scenario.id };

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, hint, hintFull, hintOpen, feedback, phase, redoAt, redoTry]);

  // A reply that comes back after the page was left (or the tab switched, or the round started over) is dropped.
  const here = useRef(active);
  here.current = active;
  const run = useRef(0);
  useEffect(
    () => () => {
      here.current = false;
      stop();
    },
    [],
  );

  const history = (list: Message[]): Turn[] => list.map(({ role, text }) => ({ role, text }));
  const say = (text: string) => (here.current ? play(ttsUrl(text, talk.aiVoice), 1).catch(() => {}) : undefined);
  const reveal = (i: number) => setSeen((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
  // Says a new line of the partner's and shows its words when the voice is done (or can't be played).
  function hear(i: number, text: string) {
    const id = run.current;
    const voice = say(text);
    const show = () => run.current === id && reveal(i);
    if (voice) voice.then(show);
    else show();
  }
  const todo = tasks.findIndex((_, i) => !done.includes(i));

  function start(n = 1) {
    unlock();
    run.current++;
    const first: Message = { role: "assistant", text: talk.opening.ja, zh: talk.opening.zh };
    setRound(n);
    setPhase("live");
    setMessages([first]);
    setDone([]);
    setNotes({});
    setFeedback(null);
    setReviewing(false);
    setHint(null);
    setHintOpen(false);
    setShownZh(new Set());
    setSeen(new Set());
    setRedoAt(0);
    setRedoTry(null);
    setError("");
    hear(0, first.text);
  }

  // The round is over: it counts as talked through, and the whole of it goes to the teacher's page.
  function finish(list: Message[], all: boolean) {
    setHintOpen(false);
    if (!list.some((m) => m.role === "user")) {
      stop();
      setPhase("brief");
      setMessages([]);
      return;
    }
    setPhase("end");
    recordFeedback(scenario.id);
    if (all) setTimeout(() => sfx("win"), 600);
    const id = run.current;
    setReviewing(true);
    post<Feedback>("/api/feedback", { scenarioId: scenario.id, talk, history: history(list), known: knownTags(progress) })
      .then((f) => {
        if (run.current !== id) return;
        setFeedback(f);
        if (f.point.tag) recordPoints([{ ...f.point, ok: false }], f.fix.better ? [f.fix] : []);
      })
      .catch(() => {})
      .finally(() => run.current === id && setReviewing(false));
  }

  async function send(text: string) {
    const id = run.current;
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next);
    setHint(null);
    setHintOpen(false);
    setBusy("ai");
    try {
      const reply = await post<Reply>("/api/chat", { scenarioId: scenario.id, talk, history: history(next), round, done });
      if (run.current !== id) return;
      const list = [...next, { role: "assistant" as const, text: reply.ja, zh: reply.zh }];
      setMessages(list);
      const now = [...new Set([...done, ...(reply.done ?? [])])];
      if (now.length > done.length) verdict("right", false, false);
      setDone(now);
      recordTalkTurn();
      hear(list.length - 1, reply.ja);
      const all = tasks.length > 0 && now.length >= tasks.length;
      const turns = list.filter((m) => m.role === "user").length;
      // The server ends the round when everything is said (and, in a later round, its new turn answered).
      if (reply.finished || turns >= MAX_TURNS) finish(list, all);
    } catch (e) {
      if (run.current === id) setError(e instanceof Error ? e.message : "AI 出错了");
    } finally {
      if (run.current === id) setBusy("");
    }
  }

  async function onRecorded(wav: Blob) {
    setError("");
    setBusy("stt");
    try {
      const { text } = await transcribe(wav);
      setBusy("");
      if (!text) {
        setError("没听清，再说一次试试");
        return;
      }
      recordSpeech(wavSeconds(wav));
      await send(text);
    } catch (e) {
      setBusy("");
      setError(e instanceof Error ? e.message : "语音识别失败");
    }
  }

  async function getHint(want?: string) {
    setError("");
    setHintOpen(true);
    setHintFull(false);
    setHint(null);
    setBusy("hint");
    try {
      setHint(
        await post<Hint>("/api/chat", {
          scenarioId: scenario.id,
          talk,
          history: history(messages),
          mode: "hint",
          round,
          ...(want ? { wantZh: want } : todo >= 0 ? { todo } : {}),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取提示失败");
      setHintOpen(false);
    } finally {
      setBusy("");
    }
  }

  function toggleZh(i: number) {
    setShownZh((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // The lines that came out wrong, in the order they were said, each with the better way to say it.
  const redo = useMemo(
    () =>
      messages
        .map((m, i) => ({ said: m.text, note: m.role === "user" ? notes[i] : undefined }))
        .filter((x) => x.note && x.note.verdict !== "good" && x.note.better)
        .slice(0, REDO_MAX)
        .map((x) => ({ said: x.said, better: x.note!.better, kana: x.note!.better_kana ?? "" })),
    [messages, notes],
  );
  const again = phase === "end" ? redo[redoAt] : undefined;
  // The last line's check may still be on its way when the talk ends: the closing buttons wait a moment
  // for it, so a line to say again doesn't appear above them after they are already on screen.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (phase !== "end") return;
    const t = setTimeout(() => setWaited(true), 8000);
    return () => clearTimeout(t);
  }, [phase, round]);
  const pending = phase === "end" && !waited && messages.some((m, i) => m.role === "user" && !notes[i]);

  async function onRedo(wav: Blob) {
    if (!again) return;
    setError("");
    setBusy("stt");
    try {
      const r = await transcribe(wav, again.better);
      if (!r.text) {
        setError("没听清，再说一次试试");
        return;
      }
      recordSpeech(wavSeconds(wav));
      const near = Math.max(closeness(r.text, again.better), again.kana && r.kana ? closeness(hira(r.kana), hira(again.kana)) : 0);
      const ok = near >= REDO_PASS;
      verdict(ok ? "right" : "close", false, false);
      // By its reading it was all there: nothing to mark as missing.
      setRedoTry({ ok, parts: ok ? [{ t: again.better, ok: true }] : byChars(again.better, r.text) });
      if (ok) {
        const at = redoAt;
        setTimeout(() => {
          setRedoAt((n) => (n === at ? n + 1 : n));
          setRedoTry(null);
        }, 1100);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "语音识别失败");
    } finally {
      setBusy("");
    }
  }

  const who = npc(scenario).name;

  return (
    <div className="tk">
      {phase !== "end" && (
        <div className="card tk-brief">
          <div className="tk-who">
            {who}
            {round > 1 && twist && phase === "live" && <span className="tk-round">第 {round} 遍 · {twist.zh}</span>}
          </div>
          {tasks.length > 0 ? (
            <ol className="tk-tasks">
              {tasks.map((t, i) => (
                <li key={t} className={done.includes(i) ? "ok" : ""}>
                  <i aria-hidden>{done.includes(i) ? "✓" : i + 1}</i>
                  {t}
                </li>
              ))}
            </ol>
          ) : planning ? (
            <Note wait text="准备任务…" />
          ) : (
            <div className="tk-goal">{talk.goalZh}</div>
          )}
        </div>
      )}

      {phase !== "brief" &&
        messages.map((m, i) =>
          m.role === "assistant" ? (
            <div key={`${round}-${i}`} className="bubble ai">
              <div className={`ja ${seen.has(i) || phase === "end" ? "" : "hidden-text"}`} onClick={() => reveal(i)}>{m.text}</div>
              {shownZh.has(i) && <div className="zh">{m.zh}</div>}
              <div className="row tk-tools">
                <button className="small" aria-label="再听一遍" onClick={() => { unlock(); say(m.text); }}>▶</button>
                <button
                  className={`small ${shownZh.has(i) ? "on" : ""}`}
                  onClick={() => {
                    reveal(i);
                    toggleZh(i);
                  }}
                >
                  中文
                </button>
                {m.zh && <Star {...card} ja={m.text} zh={m.zh} />}
              </div>
            </div>
          ) : (
            <div key={`${round}-${i}`}>
              <div className="bubble me">{m.text}</div>
              <TurnNote
                scenarioId={scenario.id}
                talk={talk}
                history={history(messages.slice(0, i + 1))}
                voice={talk.aiVoice}
                onResult={(c) => setNotes((prev) => (prev[i] === c ? prev : { ...prev, [i]: c }))}
              />
            </div>
          ),
        )}

      {phase === "live" && busy === "stt" && <div className="bubble me tk-dots3" aria-label="识别中"><i /><i /><i /></div>}
      {phase === "live" && busy === "ai" && <div className="bubble ai tk-dots3" aria-label="对方正在回答"><i /><i /><i /></div>}

      {phase === "live" && hintOpen && (
        <div className="card tk-hint">
          <button className="tk-x" aria-label="关闭提示" onClick={() => setHintOpen(false)}>×</button>
          {!hint ? (
            <Note wait text="想一想…" />
          ) : (
            <>
              <div className="zh">{hint.zh}</div>
              <div className="ja tk-hint-ja">{hintFull ? hint.ja : <>{hint.start}<span>…</span></>}</div>
              {hintFull ? (
                <button className="small" onClick={() => { unlock(); say(hint.ja); }}>▶ 听</button>
              ) : (
                <button className="small" onClick={() => setHintFull(true)}>整句</button>
              )}
            </>
          )}
          <form
            className="tk-want"
            onSubmit={(e) => {
              e.preventDefault();
              if (!wantZh.trim() || busy) return;
              getHint(wantZh.trim());
              setWantZh("");
            }}
          >
            <input value={wantZh} onChange={(e) => setWantZh(e.target.value)} placeholder="想说别的？写中文" aria-label="想说的中文" />
            <button className="small" type="submit" disabled={!!busy || !wantZh.trim()} aria-label="换成日语">→</button>
          </form>
        </div>
      )}

      {phase === "end" && (
        <div className="tk-end">
          {tasks.length > 0 && (
            <ol className="tk-tasks tk-result">
              {tasks.map((t, i) => (
                <li key={t} className={done.includes(i) ? "ok" : ""}>
                  <i aria-hidden>{done.includes(i) ? "✓" : ""}</i>
                  {t}
                </li>
              ))}
            </ol>
          )}
          {again ? (
            <div className="card tk-redo" key={redoAt}>
              <div className="label">再说一遍 {redoAt + 1}/{redo.length}</div>
              <div className="tk-said">{again.said}</div>
              <button
                className={`tk-better ja ${redoTry?.ok ? "won" : ""}`}
                aria-label="听这句"
                onClick={() => {
                  unlock();
                  say(again.better);
                }}
              >
                {redoTry ? redoTry.parts.map((x, i) => <span key={i} className={x.ok ? "hit" : "miss"}>{x.t}</span>) : again.better}
                {redoTry?.ok && <em aria-label="说对了">✓</em>}
              </button>
              {!redoTry?.ok && (
                <button
                  className="text-btn"
                  onClick={() => {
                    setRedoAt(redoAt + 1);
                    setRedoTry(null);
                  }}
                >
                  跳过
                </button>
              )}
            </div>
          ) : (
            <>
              {(reviewing || pending) && <Note wait text="老师在看这段对话…" />}
              {feedback && <FeedbackCard bare feedback={feedback} area="scene" title={scenario.titleZh} />}
              <div className="tk-go" hidden={pending}>
                <button className="primary" onClick={() => start(round + 1)}>
                  再来一遍
                  {twist && <small>这次：{twist.zh}</small>}
                </button>
                <Link href="/scenes" className="btn">返回</Link>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <div ref={bottom} />

      {active && phase === "brief" && (
        <div className="sticky-cta">
          <button className="primary" onClick={() => start(1)} disabled={planning}>开始对话</button>
        </div>
      )}

      {active && phase === "end" && again && !redoTry?.ok && (
        <div className="dock">
          <div className="dock-inner">
            <HoldButton label={busy === "stt" ? "识别中…" : "说这句"} disabled={!!busy} onRecorded={onRedo} onError={setError} />
          </div>
        </div>
      )}

      {active && phase === "live" && (
        <div className="dock">
          <div className="dock-inner">
            <div className="tk-now">
              {tasks.length > 0 && (
                <>
                  <span className="tk-pips" aria-label={`任务 ${done.length}/${tasks.length}`}>
                    {tasks.map((t, i) => (
                      <i key={t} className={done.includes(i) ? "ok" : i === todo ? "now" : ""} />
                    ))}
                  </span>
                  <b key={todo}>{todo >= 0 ? tasks[todo] : (twist && round > 1 ? twist.zh : "")}</b>
                </>
              )}
              <button className="text-btn" onClick={() => finish(messages, tasks.length > 0 && done.length >= tasks.length)} disabled={!!busy}>
                结束
              </button>
            </div>
            {typing ? (
              <form
                className="row"
                style={{ flexWrap: "nowrap" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!draft.trim() || busy) return;
                  unlock();
                  send(draft.trim());
                  setDraft("");
                }}
              >
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="用日语输入" />
                <button className="primary" type="submit" disabled={!!busy}>发送</button>
                <button type="button" onClick={() => setTyping(false)}>语音</button>
              </form>
            ) : (
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <button onClick={() => (hintOpen ? setHintOpen(false) : getHint())} disabled={!!busy}>提示</button>
                <div style={{ flex: 1 }}>
                  <HoldButton disabled={!!busy} onRecorded={onRecorded} onError={setError} />
                </div>
                <button onClick={() => setTyping(true)}>打字</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
