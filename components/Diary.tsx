"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { Recorder, transcribe } from "@/lib/client/recorder";
import {
  addDiary,
  dayKey,
  diaryToday,
  hasCard,
  recordSpeech,
  toggleCard,
  useProgress,
  wavSeconds,
  type DiaryEntry,
} from "@/lib/client/progress";
import { diaryMetrics } from "@/lib/client/metrics";
import HoldButton from "./HoldButton";
import Nav from "./Nav";

const VOICE = "ja-JP-Nanami:DragonHDLatestNeural|ja-JP-NanamiNeural";
const LIMIT = 60;

// A different question each day so there is always something to talk about.
const PROMPTS = [
  { ja: "今日はどんな一日でしたか？", zh: "今天过得怎么样？" },
  { ja: "今日、仕事で何をしましたか？", zh: "今天工作做了什么？" },
  { ja: "最近、困っていることはありますか？", zh: "最近有什么烦恼吗？" },
  { ja: "今日の昼ご飯について話してください。", zh: "说说今天的午饭。" },
  { ja: "週末は何をする予定ですか？", zh: "周末打算做什么？" },
  { ja: "最近うれしかったことは何ですか？", zh: "最近有什么开心的事？" },
  { ja: "今やっている仕事を、日本語で説明してみてください。", zh: "用日语说明一下你现在做的工作。" },
  { ja: "日本に来て、驚いたことは何ですか？", zh: "来日本后有什么让你惊讶的事？" },
  { ja: "明日の予定を話してください。", zh: "说说明天的安排。" },
  { ja: "最近見た動画や読んだ記事について話してください。", zh: "说说最近看的视频或文章。" },
];

function promptFor(day: string) {
  const n = day.split("-").reduce((a, b) => a * 31 + Number(b), 7);
  return PROMPTS[n % PROMPTS.length];
}

type Phase = "idle" | "recording" | "working" | "done";

function Sentence({ s, entryId }: { s: DiaryEntry["natural"][number]; entryId: string }) {
  const p = useProgress();
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saved = hasCard(p, s.ja);

  async function onRecorded(wav: Blob) {
    setBusy(true);
    setError("");
    try {
      const r = await transcribe(wav, s.ja);
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      setScore(r.scores?.pron ?? null);
      if (!r.text) setError("没听清，再说一次");
    } catch (e) {
      setError(e instanceof Error ? e.message : "评分失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="ja">{s.ja}</div>
      <div className="kana">{s.kana}</div>
      <div className="zh">{s.zh}</div>
      <div className="row" style={{ marginTop: 8, flexWrap: "nowrap" }}>
        <button
          className="small"
          onClick={() => {
            unlock();
            play(ttsUrl(s.ja, VOICE)).catch(() => setError("音频播放失败"));
          }}
        >
          ▶ 听
        </button>
        <div style={{ flex: 1 }}>
          <HoldButton label={busy ? "评分中…" : "按住跟读"} disabled={busy} onRecorded={onRecorded} onError={setError} />
        </div>
        {score !== null && (
          <strong className={score >= 80 ? "good" : score >= 60 ? "warn" : "bad"} style={{ fontSize: 20 }}>
            {score}
          </strong>
        )}
        <button
          className={`star ${saved ? "on" : ""}`}
          aria-label={saved ? "取消收藏" : "收藏到复习"}
          onClick={() => toggleCard({ ja: s.ja, reading: s.kana, zh: s.zh, voice: VOICE, scenarioId: `diary:${entryId}` })}
        >
          {saved ? "★" : "☆"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Result({ entry }: { entry: DiaryEntry }) {
  const m = diaryMetrics(entry);
  return (
    <>
      <div className="card">
        <div className="kpis">
          <div className="kpi">
            <b>{Math.round(entry.sec)}s</b>
            <span>说了多久</span>
          </div>
          <div className="kpi">
            <b>{m.perMin ?? "–"}</b>
            <span>每分钟字数</span>
          </div>
          <div className="kpi">
            <b>{entry.corrections.length}</b>
            <span>需要改的地方</span>
          </div>
        </div>
        <p style={{ marginBottom: 0 }}>{entry.comment}</p>
      </div>
      <h2>你说的</h2>
      <div className="card">
        <div>{entry.text}</div>
      </div>
      {entry.corrections.length > 0 && (
        <>
          <h2>可以说得更好</h2>
          <div className="card">
            {entry.corrections.map((c, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div className="muted">你说：{c.you_said}</div>
                <div className="ja">→ {c.better}</div>
                <div className="zh">{c.why_zh}</div>
              </div>
            ))}
          </div>
        </>
      )}
      <h2>自然的说法，跟读一遍</h2>
      {entry.natural.map((s, i) => (
        <Sentence key={i} s={s} entryId={entry.id} />
      ))}
    </>
  );
}

export default function Diary() {
  const p = useProgress();
  const today = dayKey();
  const prompt = promptFor(today);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<DiaryEntry | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const started = useRef(0);
  const recording = useRef(false);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      const s = (Date.now() - started.current) / 1000;
      setElapsed(s);
      if (s >= LIMIT) void finish();
    }, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function begin() {
    unlock();
    setError("");
    recorder.current ??= new Recorder();
    try {
      setPhase("recording");
      recording.current = true;
      started.current = Date.now();
      setElapsed(0);
      await recorder.current.start();
    } catch (err) {
      recording.current = false;
      setPhase("idle");
      setError(err instanceof Error && err.name === "NotAllowedError" ? "需要允许使用麦克风" : "无法打开麦克风");
    }
  }

  async function finish() {
    if (!recorder.current || !recording.current) return;
    recording.current = false;
    const wav = recorder.current.stop();
    const sec = wavSeconds(wav);
    if (sec < 3) {
      setPhase("idle");
      setError("说得太短了，至少说几句");
      return;
    }
    setPhase("working");
    try {
      const { text } = await transcribe(wav);
      if (!text) throw new Error("没听清，再试一次");
      recordSpeech(sec);
      const res = await fetch("/api/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.ja, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "点评失败");
      const entry: DiaryEntry = {
        id: `${today}-${Date.now().toString(36)}`,
        date: today,
        prompt: prompt.ja,
        text,
        sec,
        comment: data.comment_zh,
        natural: data.natural,
        corrections: data.corrections,
      };
      addDiary(entry);
      setCurrent(entry);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "出错了");
      setPhase("idle");
    }
  }

  const r = 70;
  const c = 2 * Math.PI * r;
  const history = p.diary.filter((d) => d.id !== current?.id);

  return (
    <main>
      <Link href="/" className="muted">← 今天</Link>
      <h1>一分钟口语日记</h1>

      {phase !== "done" && (
        <div className="card prompt-card">
          <div className="small-text">今天的话题</div>
          <div className="ja" style={{ margin: "6px 0 2px" }}>{prompt.ja}</div>
          <div className="zh">{prompt.zh}</div>
          <button
            className={`mic ${phase === "recording" ? "recording" : ""}`}
            style={{ marginTop: 18 }}
            disabled={phase === "working"}
            onClick={() => (phase === "recording" ? finish() : begin())}
          >
            {phase === "recording" && (
              <svg className="timer" width="144" height="144" viewBox="0 0 144 144">
                <circle cx="72" cy="72" r={r} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="4" />
                <circle
                  cx="72"
                  cy="72"
                  r={r}
                  fill="none"
                  stroke="#fff"
                  strokeWidth="4"
                  strokeDasharray={c}
                  strokeDashoffset={c * (1 - Math.min(1, elapsed / LIMIT))}
                />
              </svg>
            )}
            {phase === "idle" && "点一下开始"}
            {phase === "recording" && (
              <span>
                {Math.max(0, Math.ceil(LIMIT - elapsed))}s
                <br />
                点一下结束
              </span>
            )}
            {phase === "working" && "AI 在看…"}
          </button>
          <p className="small-text" style={{ marginBottom: 0 }}>
            {phase === "recording"
              ? "想到什么说什么，说错也没关系。"
              : diaryToday(p)
                ? "今天已经说过了，想多练可以再来一段。"
                : "最多一分钟。说完后 AI 帮你改成自然的日语，再跟读一遍。"}
          </p>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {phase === "done" && current && (
        <>
          <Result entry={current} />
          <button className="next-cta" onClick={() => setPhase("idle")}>再说一段</button>
        </>
      )}

      {history.length > 0 && (
        <>
          <h2>以前的日记</h2>
          {history.slice(0, 20).map((d) => {
            const m = diaryMetrics(d);
            return (
              <div key={d.id}>
                <button className="card" style={{ width: "100%", textAlign: "left", display: "block" }} onClick={() => setOpen(open === d.id ? null : d.id)}>
                  <div className="row spread">
                    <strong>{d.date.slice(5).replace("-", "月")}日</strong>
                    <span className="small-text">
                      {Math.round(d.sec)}s · {m.perMin ?? "–"} 字/分 · 改 {d.corrections.length} 处
                    </span>
                  </div>
                  <div className="small-text ellipsis">{d.text}</div>
                </button>
                {open === d.id && <Result entry={d} />}
              </div>
            );
          })}
        </>
      )}
      <Nav on="today" />
    </main>
  );
}
