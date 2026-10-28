"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { calls, people } from "@/content/calls";
import type { RetellEnd, RetellFix, RetellKeys, RetellReview } from "@/lib/claude";
import type { Heard } from "@/lib/gemini-hear";
import { play, progress, stop as stopAudio, ttsUrl, unlock } from "@/lib/client/player";
import { loadPause, startPause, stopPause } from "@/lib/client/bgm";
import {
  dayKey,
  ensureReadings,
  hasCard,
  knownTags,
  markNews,
  RADIO_VOICE,
  recordNote,
  recordPoints,
  recordKeyRuns,
  recordRetell,
  recordSpeech,
  retellCarry,
  retellUsual,
  toggleCard,
  useProgress,
  wavSeconds,
  type Progress,
  retellToday,
  type Retell,
  type RetellPoint,
} from "@/lib/client/progress";
import { flowOf, moraRate, runClips, wavSlice, type Flow } from "@/lib/client/fluency";
import { Recorder, transcribeLong } from "@/lib/client/recorder";
import SayAlong from "@/components/SayAlong";
import { heardToday, stepDone, useOnRoute } from "@/lib/client/route";
import { newsItems, newsToday } from "@/lib/client/news";
import type { NewsArticle } from "@/lib/news-model";
import { useHydrated } from "@/lib/client/hydrated";
import { LIFE_TOPICS, latest, retellList, retellScore, topicLogs } from "@/lib/client/retell-history";
import Note from "./Note";
import { SenseiFace, speakClip, SENSEI_VOICE } from "./Sensei";
import { Ears, joinWavs } from "@/lib/client/ears";
import { audioCtx, renewAudio } from "@/lib/client/audio";
import { chime } from "@/lib/client/fx";
import { preload } from "@/lib/client/player";

// 三回話す: tell today's radio story three times, each time to a different person (so there is nothing
// new to add, only saying it better), with the one thing to fix shown between the first and second time.
// Built on the 4/3/2 research: the same content repeated is what lasts (de Jong & Perfetti 2011); time
// pressure itself matters little, so the times only shrink a bit; one delayed correction lets accuracy
// grow with fluency (Tran & Saito); three times, not six, or it turns into reciting (Suzuki & Hanzawa).
// Easier to start: keywords and ready-made opening lines on screen, no score while speaking, and a
// listener who reacts. The first telling of each day is always a new story, so its speed across days
// is the honest measure of progress. A point still not said right at the end of a day comes back before
// the next day's first telling, on a new story, until it is said right there.
// The radio's ハル retells the story in three sentences before this (a model to notice against, Hanaoka
// & Izumi), and the keywords are the story's skeleton; they stay up every time, and before each retelling
// the ones already used well give their place to new ones. The fix is first a prompt to find the better way
// yourself (Lyster & Saito), then the answer. The end pairs what you said with the natural version
// (Lynch's reformulation). Speed is morae per second with long pauses counted, and a day after a
// telling the old story is told once more before the new one (spaced repetition, Bui et al. 2019).
// Each telling is written down word for word by Gemini, piece by piece between the long silences, so
// a silence in the middle of a sentence (stuck, not planning) is known: the longest one becomes the one
// thing between the first and second telling, the words go to フレーズ帳 and 瞬間, and stalls per minute
// are the progress measure. The listener answers what was actually told (Bavelas et al. 2000); the next
// day's retelling is checked for yesterday's natural sentences (Loewen 2005); the end can be said along
// with the natural version (shadowing, 王 2018).

const SECONDS = [90, 75, 60];
// Yesterday's story, once, before today's: to ゆい, 60 seconds. Only within a week of telling it.
const AGAIN_SECONDS = 60;
const AGAIN_DAYS = 7;
const LISTENERS = ["yamada", "yui", "sato"];
// Said at once when a telling ends, while it is being written down; the real reaction follows.
const AIZUCHI: Record<string, string> = { yamada: "うん、うん。", yui: "うんうん！", sato: "へえー。" };
// Only when the reaction about the story itself couldn't be made.
const REACTIONS: Record<string, string[]> = {
  yamada: ["へえ、そうなんだ。面白いね。", "なるほどね、知らなかったよ。"],
  yui: ["えー、うそ！知らなかった！", "まじで？めっちゃ面白いじゃん！"],
  sato: ["マジですか、それ初めて聞きました。", "へえー、なんか得した気分です。"],
};

type Key = { ja: string; kana?: string };
// pool: more words from the story, for the keywords that take a learned one's place.
// title: how the story is stored in the history; ja / zh: how it is shown.
// opinion: a starter for the third telling only (the learner's own view). model: the story told well, shown after.
type Topic = { title: string; ja: string; zh: string; about: string; keys: Key[]; pool: Key[]; starters: string[]; ep?: string; news?: string; opinion?: string; model?: string[] };

const epKeys = (ep: Progress["episodes"][number]) =>
  (ep.story?.keys.length ? ep.story.keys : (ep.words ?? [])).slice(0, 3).map((w) => ({ ja: w.ja, kana: w.kana }));

function epTopic(ep: Progress["episodes"][number]): Topic {
  const main = ep.lines.filter((l) => l.part === "main").map((l) => l.ja);
  return {
    title: ep.title_zh,
    ja: ep.title_ja ?? ep.title_zh,
    zh: ep.title_ja ? ep.title_zh : "",
    about: `${ep.title_zh}\n${(main.length ? main : ep.lines.map((l) => l.ja)).join("").slice(0, 600)}`,
    keys: epKeys(ep),
    pool: [...(ep.story?.keys ?? []), ...(ep.words ?? [])].map((w) => ({ ja: w.ja, kana: w.kana })),
    ep: ep.id,
    starters: ["今日ラジオで、〜って話を聞いたんですけど。", "びっくりしたのは、〜ってことです。", "だから、〜らしいですよ。"],
  };
}

// An NHK news article heard this morning: its skeleton words, NHK's text as what it is about.
function newsTopic(a: NewsArticle): Topic {
  return {
    title: a.title_ja,
    ja: a.title_ja,
    zh: a.title_zh,
    about: `${a.title_ja}\n${a.sentences.map((s) => s.ja).join("").slice(0, 700)}`,
    keys: a.keys.slice(0, 3).map((k) => ({ ja: k.ja, kana: k.kana })),
    pool: [...a.keys, ...a.words].map((w) => ({ ja: w.ja, kana: w.kana })),
    news: a.id,
    starters: ["ニュースで、〜と言っていました。", "〜そうです。"],
    opinion: "わたしは〜と思います。",
    model: a.summary,
  };
}

const lifeTopic = (t: string): Topic => ({
  title: t,
  ja: LIFE_TOPICS.find((l) => l.zh === t)?.ja ?? t,
  zh: t,
  about: t,
  keys: [],
  pool: [],
  starters: ["実は、〜んですよ。", "それで、〜。", "結局、〜って感じでした。"],
});

// What there is to tell, first one first: today's episode once it has been heard, else something from
// the learner's own day; then the other heard episodes and life topics, for practising off the route.
// A story not heard yet can't be retold.
// The story asked for in the address (?ep=<id> or ?life=<n>), from the history list.
export function pickedTopic(p: Progress, q: URLSearchParams): Topic | null {
  const ep = q.get("ep") && p.episodes.find((e) => e.id === q.get("ep"));
  if (ep) return epTopic(ep);
  const a = q.get("news") && newsItems().find((x) => x.id === q.get("news"));
  if (a) return newsTopic(a);
  const life = LIFE_TOPICS[Number(q.get("life"))];
  return q.has("life") && life ? lifeTopic(life.zh) : null;
}

export function topicsFor(p: Progress): Topic[] {
  // The news article heard this morning, else the episode heard on today's route (even one written the day before).
  const a = newsToday(p);
  const ep = heardToday(p);
  const day = Number(dayKey().replace(/-/g, ""));
  const life = LIFE_TOPICS.map((_, i) => lifeTopic(LIFE_TOPICS[(day + i) % LIFE_TOPICS.length].zh));
  const eps = p.episodes.filter((e) => e !== ep && e.heard).slice(0, 8).map(epTopic);
  const first = a ? newsTopic(a) : ep ? epTopic(ep) : null;
  return first ? [first, ...life.slice(0, 1), ...(a && ep ? [epTopic(ep)] : []), ...eps, ...life.slice(1)] : [life[0], ...eps, ...life.slice(1)];
}

// An earlier day's story to tell once more, with how its last telling went.
type Again = { topic: Topic; last?: number; natural?: string[] };
function againFor(p: Progress): Again | null {
  const past = (p.retells ?? []).filter((r) => r.date !== dayKey());
  const r = past[past.length - 1];
  if (!r || (Date.parse(dayKey()) - Date.parse(r.date)) / 86400000 > AGAIN_DAYS) return null;
  const ep = p.episodes.find((e) => e.title_zh === r.topic);
  const a = newsItems().find((x) => x.title_ja === r.topic);
  const topic = ep ? epTopic(ep) : a ? newsTopic(a) : LIFE_TOPICS.some((l) => l.zh === r.topic) ? lifeTopic(r.topic) : null;
  return topic && { topic, last: r.mps?.[2], natural: r.natural };
}

const voiceOf = (person: string) => calls.find((c) => c.person === person)?.talk.aiVoice ?? RADIO_VOICE.B;
const nameOf = (person: string) => people.find((x) => x.id === person)?.name ?? person;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;
const chars = (s: string) => s.replace(/[\s、。，,.!！?？「」…]/g, "").length;

// perMin: long silences per minute; stalls: those in the middle of a sentence, per minute (only when
// Gemini wrote the telling down).
type Take = { text: string; sec: number; cpm: number; span: number; pauses: number; perMin: number; stalls?: number; mps?: number; good?: string };
// The longest silence in the middle of a sentence in the first telling, where it is in the recording.
type Stall = { before: string; after: string; secs: number; from: number; to: number };
const STALL_MIN_S = 1.5;
const perMinute = (n: number, span: number) => (span > 0 ? Math.round((n / (span / 60)) * 10) / 10 : 0);

// The transcript with its silences marked, the way the coach reads it.
function marked(h: Heard, f: Flow) {
  return h.runs
    .map((r, i) => (i < f.gaps.length ? `${r.text}（…${r.cut ? "詰まった " : ""}${f.gaps[i].toFixed(1)}秒…）` : r.text))
    .join("");
}

function stallOf(h: Heard, f: Flow): Stall | null {
  let best: Stall | null = null;
  h.runs.forEach((r, i) => {
    const g = f.gaps[i];
    if (!r.cut || g === undefined || g < STALL_MIN_S || !r.text.trim() || (best && best.secs >= g)) return;
    best = { before: r.text.slice(-40), after: h.runs[i + 1]?.text.slice(0, 40) ?? "", secs: Math.round(g * 10) / 10, from: Math.max(0, f.runs[i][1] - 3), to: f.runs[i + 1][0] + 1 };
  });
  return best;
}
type Phase = "ready" | "starting" | "talk" | "between" | "end";

// The fix as a point to remember. Points the coach can't name by grammar are named by the fixed words,
// so they still reach 苦手.
function pointOf(f: RetellFix): RetellPoint | null {
  if (!f.fix.better) return null;
  return { tag: f.point.tag || f.fix.better.slice(0, 16), zh: f.point.zh || f.focus_zh, focus_zh: f.focus_zh, you_said: f.fix.you_said, better: f.fix.better };
}

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/retell", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "AI 出错了");
  return data as T;
}

// 森先生 helping while the learner tells (/api/help), only when they call her (森先生，帮我一下): she
// never steps in by herself (that came too soon or at the wrong moment). Like a real teacher she says back
// what they were saying, then her guess at what they meant: when she can tell, the whole sentence; when she
// can't, two or three meanings to pick from (是这个意思吗？), and the one picked is said for them to repeat.
// The mic is shut and the clock stopped while she helps, so her voice isn't taken as theirs.
// Each phrase is written down once the learner pauses this long, while they go on telling, so only her
// line is left to write when they call her.
const PHRASE_S = 0.5;
const GO_ON = "うん、それで？";
// Her guesses at what the learner meant (opts, most likely first; sure: only one). next/zh/added/audio.next
// are the one she says: the first, or the one the learner picked.
type HelpOpt = { ja: string; zh: string; added: string; audio?: string };
// rest: when her line came streamed, the guesses still on their way.
type HelpRes = {
  said: string;
  say: string;
  added: string;
  next: string;
  zh: string;
  sure?: boolean;
  opts?: HelpOpt[];
  audio?: { say: string; next: string };
  rest?: Promise<void>;
};
// step 0: she is about to speak; 1: her line (and the guesses to pick from); 2: the whole sentence.
// reading: the line her voice is on now (lit as she goes); turn: she has said it and waits for 接着说.
type HelpNow = HelpRes & { step: 0 | 1 | 2; reading?: "say" | "next" | null; turn?: boolean };
type HelpWire = { said?: string; say?: string; audio?: string; error?: string; sure?: boolean; opts?: HelpOpt[] };
function fill(h: HelpRes, b: HelpWire) {
  h.opts = b.opts ?? [];
  h.sure = b.sure ?? h.opts.length < 2;
  const o = h.opts[0];
  h.next = o?.ja ?? "";
  h.zh = o?.zh ?? "";
  h.added = o?.added ?? "";
  h.audio!.next = o?.audio ?? "";
}
// A place she helped, kept for after the telling (round: which telling).
type Helped = { round: number; said: string; say: string; added: string; next: string; zh: string };
// A streamed help (/api/help with what was said): one JSON line with her first line and its voice, then one
// with the whole sentence; the first resolves, the second fills in the same object when it comes (rest).
async function readHelp(res: Response): Promise<HelpRes> {
  if (!res.ok || !res.body) throw new Error(String(res.status));
  if (!res.headers.get("content-type")?.includes("ndjson")) {
    const b = (await res.json()) as HelpWire;
    if (!b.say) throw new Error(b.error ?? "no help");
    const h: HelpRes = { said: b.said ?? "", say: b.say, added: "", next: "", zh: "", audio: { say: b.audio ?? "", next: "" } };
    fill(h, b);
    return h;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  async function line(): Promise<HelpWire | null> {
    for (;;) {
      const i = buf.indexOf("\n");
      if (i >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + 1);
        return JSON.parse(l);
      }
      const { done, value } = await reader.read();
      if (done) return null;
      buf += dec.decode(value, { stream: true });
    }
  }
  const a = await line();
  if (!a || a.error || !a.say) throw new Error(a?.error ?? "no help");
  const h: HelpRes = { said: a.said ?? "", say: a.say, added: "", next: "", zh: "", audio: { say: a.audio ?? "", next: "" } };
  h.rest = line()
    .then((b) => {
      if (b && !b.error) fill(h, b);
    })
    .catch(() => {});
  return h;
}

const clipUrl = (b64?: string) => (b64 ? `data:audio/mpeg;base64,${b64}` : "");
const unDots = (t: string) => t.replace(/[…。？?]+$/, "");

// Her line with the words she added marked.
function Added({ text, added }: { text: string; added: string }) {
  const at = added ? text.indexOf(added) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{added}</mark>
      {text.slice(at + added.length)}
    </>
  );
}

// Her line as she reads it: the part already said under the highlighter, the rest grey (from how far the
// sound has got, by characters), so eyes can follow her voice.
function Follow({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const { at, of } = progress();
      // The last bit of her clip is silence: the line is lit by the time she stops.
      if (of > 0) setN(Math.min(text.length, Math.ceil((text.length * at) / (of * 0.9))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return (
    <>
      <span className="help-lit">{text.slice(0, n)}</span>
      <span className="help-dim">{text.slice(n)}</span>
    </>
  );
}

// Her card while telling. First only that she is coming (a chime, a ring on her face, the clock stopped),
// then her line, slowly, lit as she reads it; when she isn't sure what the learner meant, her guesses to
// tap (是这个意思吗？). Nothing goes away: her line stays to hear again (slower if asked), and the
// telling goes on only when the learner taps 接着说 (a cough or a noise never restarts it).
type CardActs = { again: (slow: boolean) => void; whole: () => void; pick: (i: number) => void; go: () => void };
function HelpCard({ h, acts }: { h: HelpNow; acts: CardActs }) {
  const ask = h.step === 1 && !h.sure && (h.opts?.length ?? 0) > 1;
  const line = (which: "say" | "next", text: string, node: ReactNode) => (h.reading === which ? <Follow text={text} /> : node);
  return (
    <div className="help-card">
      <div className="help-who">
        <span className={h.step === 0 ? "help-ring" : ""}>
          <SenseiFace size={36} />
        </span>
        <b>森先生</b>
      </div>
      {h.step === 0 ? (
        <>
          <div className="help-say">うん、ちょっと待ってね。</div>
          <div className="help-zh">在听你刚才说的…</div>
          <div className="help-bar" />
        </>
      ) : (
        <>
          <div className={`help-say${h.step === 2 ? " was" : ""}`}>{line("say", h.say, h.say)}</div>
          {ask && (
            <div className="help-opts">
              <span className="help-q">是这个意思吗？</span>
              {h.opts!.map((o, i) => (
                <button key={o.ja} onClick={() => acts.pick(i)}>
                  <span className="help-opt-ja">
                    <Added text={o.ja} added={o.added} />
                  </span>
                  <small>{o.zh}</small>
                </button>
              ))}
            </div>
          )}
          {h.step === 2 && (
            <>
              <div className="help-say">{line("next", h.next, <Added text={h.next} added={h.added} />)}</div>
              <div className="help-zh">{h.zh}</div>
            </>
          )}
          {h.turn && (
            <>
              <div className="help-again">
                <button onClick={() => acts.again(false)}>↻ 再听一遍</button>
                <button onClick={() => acts.again(true)}>慢</button>
                {h.step === 1 && h.sure && h.next && <button onClick={acts.whole}>听整句</button>}
              </div>
              <button className="today-go help-go" onClick={acts.go}>
                接着说
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// After a telling: where she helped (up to two), what the learner said and what she said; and the places
// she helped before that they said by themselves this time.
function HelpedList({ items, self, onHear }: { items: Helped[]; self: Helped[]; onHear: (ja: string) => void }) {
  items = items.filter((x, i) => items.findIndex((y) => (y.next || y.say) === (x.next || x.say)) === i);
  if (!items.length && !self.length) return null;
  return (
    <div className="helped">
      {self.slice(0, 2).map((x) => (
        <div key={`s${x.say}`} className="helped-self">
          <span className="helped-tag">✓ 自分で言えた</span>
          <b>{unDots(x.say)}</b>
        </div>
      ))}
      {items.length > 0 && (
        <>
          <span className="kicker">森先生が手伝ったところ</span>
          {items.slice(0, 2).map((x) => (
            <div key={x.say} className="helped-row">
              {x.said && (
                <div>
                  <span className="helped-who">あなた</span>
                  <span className="helped-mine">{x.said}…</span>
                </div>
              )}
              <button onClick={() => onHear(x.next || x.say)}>
                <span className="helped-who t">先生</span>
                <span className="helped-ja">
                  <Added text={x.next || unDots(x.say)} added={x.added} />
                </span>
                <Play />
              </button>
            </div>
          ))}
          <small className="helped-note">✓ 已收藏</small>
        </>
      )}
    </div>
  );
}

// What the button says while the learner waits (writing down a telling takes ~15s).
const BUSY: Record<string, string> = { listen: "聞き取り中…", fix: "直すところを探し中…", end: "まとめ中…" };

// After the second telling: one line on how it went against the first (mid-sentence stalls per
// minute), and a tick when the words from the fix came out. Never a score, never a new point.
const plain = (t: string) => t.replace(/[\s、。！？!?,.・「」]/g, "");
function secondNote(a: Take | null, b: Take, text: string | undefined, better: string | undefined): string[] {
  const out: string[] = [];
  if (better && text && plain(text).includes(plain(better))) out.push(`✓ 「${better}」这遍用上了`);
  if (a?.stalls !== undefined && b.stalls !== undefined) {
    out.push(
      b.stalls < a.stalls
        ? `句子中间卡住少了：每分钟 ${a.stalls} → ${b.stalls} 次`
        : `句子中间卡住：每分钟 ${a.stalls} → ${b.stalls} 次`,
    );
  }
  return out;
}

// The wait while a telling is written down (~18s): one thing only, or just the bar. Before the last
// telling, the one fix said under the breath three times; after the last, the long pauses per minute
// across the three, counted on the phone. (A plain-form hint before the friend was noise, the user said.)

// One thing said well, in the learner's own words (tap: hear it said by a native voice).
function Good({ ja, onHear }: { ja: string; onHear: (ja: string) => void }) {
  return (
    <button className="good-card" onClick={() => onHear(ja)}>
      <span className="good-tag">言えた</span>
      <span className="good-ja">{ja}</span>
      <Play />
    </button>
  );
}

const Play = () => (
  <i className="play-dot" aria-hidden>
    <svg viewBox="0 0 12 12" width="11" height="11">
      <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
    </svg>
  </i>
);

// A Japanese line to hear: the text and a round play button.
// Everything Opus found in one telling (after every telling): each place to fix, in the order said, with
// what the learner said, the right way to say it (tap to hear), its translation and why; and what was good.
type ReviewState = RetellReview | "wait" | "fail";
function ReviewList({ r, onHear }: { r?: ReviewState; onHear: (ja: string) => void }) {
  if (!r) return null;
  if (r === "wait") return <Note wait text="森先生在看这一遍说的每一句…" />;
  if (r === "fail") return null;
  return (
    <div className="review">
      <div className="review-head">
        <span className="kicker">这一遍的全部反馈</span>
        <span className="review-n">{r.fixes.length ? `${r.fixes.length} 处可以改` : "没有要改的"}</span>
      </div>
      {r.good.map((g) => (
        <button key={`g${g.ja}`} className="review-good" onClick={() => onHear(g.ja)}>
          <span className="review-tag ok">✓ 好</span>
          <span className="review-ja">{g.ja}</span>
          <small>{g.why_zh}</small>
        </button>
      ))}
      {r.fixes.map((f, i) => (
        <div key={`${i}${f.you}`} className="review-fix">
          <div className="review-top">
            <span className="review-tag">{f.kind}</span>
            <span className="review-you">{f.you}</span>
          </div>
          <button className="review-better" onClick={() => onHear(f.better)}>
            <span className="review-ja">{f.better}</span>
            <Play />
          </button>
          <small className="review-zh">{f.zh}</small>
          <small className="review-why">{f.why_zh}</small>
        </div>
      ))}
    </div>
  );
}

function Say({ ja, big, onHear }: { ja: string; big?: boolean; onHear: (ja: string) => void }) {
  return (
    <button className={`say ${big ? "big" : ""}`} onClick={() => onHear(ja)}>
      <span>{ja}</span>
      <Play />
    </button>
  );
}
function WaitCard(a: {
  round: number;
  phrase: string;
  murmurs: number;
  onMurmur: () => void;
  onHear: (ja: string) => void;
  pauses: (number | null | undefined)[];
}) {
  let body: React.ReactNode = null;
  if (a.round === 1 && a.phrase) {
    body = (
      <>
        <div className="wait-ja" onClick={() => a.onHear(a.phrase)}>
          {a.phrase} ▶
        </div>
        <button className="wait-dots" onClick={a.onMurmur} aria-label="说了一遍">
          {[0, 1, 2].map((i) => (
            <i key={i} className={i < a.murmurs ? "on" : ""} />
          ))}
        </button>
        <div className="wait-zh">{a.murmurs >= 3 ? "好，最后一遍用上它" : "小声说 3 遍，每说一遍点一下"}</div>
      </>
    );
  } else if (a.round === 2 && a.pauses.every((x) => typeof x === "number")) {
    body = (
      <>
        <div className="wait-ja">{a.pauses.join(" → ")}</div>
        <div className="wait-zh">停顿 1 秒以上，每分钟几次</div>
      </>
    );
  }
  return (
    <div className="wait-card">
      <i className="wait-bar" />
      {body}
    </div>
  );
}

export default function Retell() {
  const p = useProgress();
  const hydrated = useHydrated();
  const onRoute = useOnRoute();
  const [topics, setTopics] = useState<Topic[]>([]);
  const topic: Topic | null = topics[0] ?? null;
  // This story's latest score before today's telling, and how many times it was told before.
  const prior = useRef<{ score: number | null; times: number; runsToday: number }>({ score: null, times: 0, runsToday: 0 });
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [left, setLeft] = useState(SECONDS[0]);
  const [takes, setTakes] = useState<(Take | null)[]>([null, null, null]);
  const [fix, setFix] = useState<RetellFix | null>(null);
  const [end, setEnd] = useState<RetellEnd | null>(null);
  // The full review of each telling (0-2; 3: the retelling of an earlier story).
  const [reviews, setReviews] = useState<Record<number, ReviewState>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<Recorder | null>(null);
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);
  const known = useRef<string[]>([]);
  // The first telling on an earlier day, to compare with today's first.
  const before = useRef<{ mps: number | null; stalls: number | null }>({ mps: null, stalls: null });
  // The point an earlier day left unfixed, and whether today's first telling got it right (null: not judged).
  const [carry, setCarry] = useState<RetellPoint | null>(null);
  const [carried, setCarried] = useState<RetellFix["carried"] | null>(null);
  // An earlier day's story, told once first; null once it is told (or when there is none).
  const [again, setAgain] = useState<Again | null>(null);
  const [againTake, setAgainTake] = useState<Take | null>(null);
  // Yesterday's natural sentences heard again in today's retelling of that story.
  const [uptake, setUptake] = useState<string[]>([]);
  // What the listener just said back, shown after the second telling with how it went.
  const [said, setSaid] = useState<{ who: string; text: string } | null>(null);
  // While a telling is being written down: its long pauses per minute (counted on the phone, so
  // known at once) and how many times the fix has been said under the breath (WaitCard).
  const [pausesNow, setPausesNow] = useState<number | null>(null);
  const [murmurs, setMurmurs] = useState(0);
  // The first telling's longest stall, and its recording to play back.
  const [stall, setStall] = useState<Stall | null>(null);
  const firstWav = useRef<Blob | null>(null);
  const texts = useRef<string[]>([]);
  // The end's natural version is being said along with (SayAlong).
  const [along, setAlong] = useState(false);
  // The answer to the fix stays hidden until the learner has tried to find it.
  const [shown, setShown] = useState(false);
  // 森先生 while telling (see PHRASE_S): what she is saying now, the places she helped (every telling today), the recordings of this telling (one per stretch between
  // her lines) and how long the clock has been stopped for her.
  const [help, setHelp] = useState<HelpNow | null>(null);
  const helpNow = useRef<HelpNow | null>(null);
  const showHelp = (h: HelpNow | null) => {
    helpNow.current = h;
    setHelp(h);
  };
  const ears = useRef<Ears | null>(null);
  const helping = useRef(false);
  // Her saying it once more by herself; which of her lines is the latest (an older one ending does nothing).
  const autoAgain = useRef<number | undefined>(undefined);
  const saying = useRef(0);
  const live = useRef(false);
  const helped = useRef<Helped[]>([]);
  // Places she helped on an earlier telling that the learner then said by themselves.
  const [selfSaid, setSelfSaid] = useState<Helped[]>([]);
  const segs = useRef<Blob[]>([]);
  // This telling's phrases, being written down as they are said (null: that one failed).
  const phrases = useRef<Promise<string | null>[]>([]);
  const stoppedMs = useRef(0);
  const stoppedAt = useRef(0);
  // Readings of each telling, asked for as soon as it is transcribed (index 3: the telling of the old story).
  const kana = useRef<Promise<string | undefined>[]>([]);
  // The keywords as renewed before each telling after the first (words already used well swapped for
  // new ones), the ones just taken off and the ones just put on; null: the topic's own.
  const [keyed, setKeyed] = useState<(RetellKeys & { fresh: string[] }) | null>(null);
  // Tellings in a row each keyword was used well (from earlier days too), and each telling as the
  // keyword check reads it (with where it stalled).
  const keyRuns = useRef<Record<string, number>>({});
  const saidMarked = useRef<string[]>([]);
  // The same counts, for the half-way ✓ on a keyword used well once.
  const [runsShown, setRunsShown] = useState<Record<string, number>>({});
  // A renewal's outcome; when nothing changed, the last one's marks come off.
  const renew = (k: RetellKeys | null) =>
    setKeyed((was) => {
      if (!k) return was && { ...was, done: [], fresh: [] };
      const before = was?.keys ?? topic!.keys;
      return { ...k, fresh: k.keys.filter((x) => !before.some((b) => b.ja === x.ja)).map((x) => x.ja) };
    });

  useEffect(() => {
    void loadPause();
    preload([ttsUrl(GO_ON, SENSEI_VOICE)]);
  }, []);

  useEffect(() => {
    if (!hydrated || topics.length) return;
    const auto = topicsFor(p);
    const picked = pickedTopic(p, new URLSearchParams(location.search));
    const ts = picked ? [picked] : auto;
    const log = topicLogs(p).get(ts[0].title);
    const today = (p.retells ?? []).find((r) => r.date === dayKey() && r.topic === ts[0].title);
    prior.current = { score: latest(log)?.score ?? null, times: log?.times ?? 0, runsToday: today ? (today.runs ?? 1) : 0 };
    keyRuns.current = Object.fromEntries(Object.entries(p.keyRuns ?? {}).map(([k, v]) => [k, v.n]));
    setRunsShown(keyRuns.current);
    setTopics(ts);
    for (const t of ts) {
      const ep = t.ep && p.episodes.find((e) => e.id === t.ep);
      if (ep) ensureReadings(ep);
    }
    known.current = knownTags(p);
    setCarry(retellCarry(p));
    // The earlier story first only before today's own story, not before one picked from the list.
    if (!retellToday(p) && (!picked || picked.title === auto[0]?.title)) setAgain(againFor(p));
    // Only earlier days counted the same way can be compared.
    before.current = { mps: retellUsual(p, (r) => r.mps?.[0]), stalls: retellUsual(p, (r) => r.stalls?.[0]) };
  }, [hydrated, p, topics]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      stopAudio();
      void stopPause(0);
      live.current = false;
      ears.current?.close();
      rec.current?.stop().catch(() => {});
    },
    [],
  );

  const warming = !!again && !againTake;
  const listener = warming ? "yui" : LISTENERS[round];
  const limit = warming ? AGAIN_SECONDS : SECONDS[round];
  const shownTopic = warming ? again!.topic : topic;
  const slot = warming ? 3 : round;

  // Reading → morae per second; undefined when no clean reading came back.
  async function rated(t: Take, slot: number) {
    return { ...t, mps: moraRate(t.text, await kana.current[slot], t.span) };
  }

  async function begin() {
    unlock();
    // Her ears run on Web Audio, which iPhone only starts inside a tap.
    renewAudio();
    stopAudio();
    setError("");
    setPhase("starting");
    // The music between tellings is gone before the mic opens.
    await stopPause(0.5);
    const r = new Recorder();
    // Set before the mic opens, so leaving the page meanwhile still shuts it.
    rec.current = r;
    try {
      await r.start();
    } catch {
      rec.current = null;
      setPhase(round === 0 ? "ready" : "between");
      setError("麦克风打不开，请允许使用麦克风");
      return;
    }
    segs.current = [];
    stoppedMs.current = 0;
    stoppedAt.current = 0;
    helping.current = false;
    phrases.current = [];
    showHelp(null);
    live.current = true;
    listen(r);
    startedAt.current = Date.now();
    setLeft(limit);
    setPhase("talk");
    timer.current = window.setInterval(() => {
      const now = Date.now();
      const l = limit - (now - startedAt.current - stoppedMs.current - (stoppedAt.current ? now - stoppedAt.current : 0)) / 1000;
      setLeft(l);
      if (l <= 0) finish();
      else watch();
    }, 250);
  }

  function listen(r: Recorder) {
    ears.current?.close();
    ears.current = null;
    try {
      if (r.input) ears.current = new Ears(r.input, audioCtx());
    } catch {}
  }

  // Every quarter second while telling: each phrase written down at its pause.
  function watch() {
    const e = ears.current;
    if (!e || helping.current || !live.current) return;
    if (e.fresh && e.quiet() >= PHRASE_S) phrases.current.push(hearPhrase(e.phrase()));
  }

  const helpPost = (body: object) =>
    fetch("/api/help", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(readHelp);

  function hearPhrase(clip: string): Promise<string | null> {
    if (!clip) return Promise.resolve("");
    // Its own reader: the answer is {text}, not a help line.
    return fetch("/api/help", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hear: true, audio: clip }) })
      .then((r) => (r.ok ? (r.json() as Promise<{ text?: string }>) : Promise.reject(new Error(String(r.status)))))
      .then((r) => r.text ?? "")
      .catch(() => null);
  }

  // Her line: from the phrases already written down (only the last few, the sentence being said), so only
  // her words are left to write; from the recording itself when one of them couldn't be written down.
  function ask(clip: string): Promise<HelpRes | null> {
    const t = shownTopic!;
    const keys = (warming ? t.keys : (keyed?.keys ?? topic!.keys)).map((k) => k.ja);
    const before = helped.current.filter((x) => x.round === slot).map((x) => x.next).join("");
    const base = { topic: `${t.ja}\n${t.about}`.slice(0, 300), keys, before };
    const last = phrases.current.slice(-4);
    const fromText = (said: string) => helpPost({ ...base, said }) as Promise<HelpRes>;
    // From the recording when the phrases couldn't all be written down; if that fails too, from what was
    // written down (or from nothing): she always has a real line, never a guess at a keyword.
    const fromAudio = (said: string) => (helpPost({ ...base, audio: clip }) as Promise<HelpRes>).catch(() => fromText(said));
    const go = clip && last.length
      ? Promise.all(last).then((texts) => {
          const said = texts.join("");
          return texts.some((x) => x === null) || !said.trim() ? fromAudio(said) : fromText(said).catch(() => fromAudio(said));
        })
      : clip
        ? fromAudio("")
        : fromText("");
    return go.catch(() => null);
  }

  // The mic is shut and the clock stopped from the moment she steps in until the learner taps 接着说.
  // First the chime and a second to notice her, then her line, slowly; then her line stays to hear again,
  // and she says it once more by herself if nothing is tapped (on the first telling, when she knows what
  // they meant, the whole sentence instead). Also from a tap on her.
  async function stepIn() {
    const r = rec.current;
    if (helping.current || !live.current || !r) return;
    helping.current = true;
    stoppedAt.current = Date.now();
    const e = ears.current;
    // What was said since the last phrase went down is written down now too.
    if (e?.fresh) phrases.current.push(hearPhrase(e.phrase()));
    const pending = ask(e?.spoke ? e.clip(12) : "");
    e?.close();
    ears.current = null;
    rec.current = null;
    showHelp({ said: "", say: "", added: "", next: "", zh: "", step: 0 });
    chime();
    const [, got] = await Promise.all([
      r.stop().then((w) => void segs.current.push(w)).catch(() => {}),
      pending ?? Promise.resolve(null),
      new Promise((ok) => setTimeout(ok, 800)),
    ]);
    if (!live.current) return;
    // Without an answer (or on the third telling): 「うん、それで？」.
    const res: HelpRes = got?.say ? got : { said: "", say: GO_ON, added: "", next: "", zh: "" };
    if (got?.say) {
      const keep = () => {
        // Unsure guesses are kept only once the learner picks one.
        if (got.sure !== false) keepHelp(got);
        // The card shown before the guesses came: now with them.
        const now = helpNow.current;
        if (now && now.say === got.say) showHelp({ ...now, next: got.next, zh: got.zh, added: got.added, sure: got.sure, opts: got.opts, audio: got.audio });
      };
      if (got.rest) void got.rest.then(keep);
      else keep();
    }
    showHelp({ ...res, step: 1 });
    await voiceLine("say");
  }

  // Her voice on one line of the card, lit as she reads; then her turn is over until something is tapped.
  const SLOW = 0.88;
  const SLOWER = 0.72;
  async function voiceLine(which: "say" | "next", rate = SLOW, auto = true) {
    const h = helpNow.current;
    if (!h || !live.current) return;
    window.clearTimeout(autoAgain.current);
    const id = ++saying.current;
    const text = which === "say" ? h.say : h.next;
    const src = clipUrl(which === "say" ? h.audio?.say : h.audio?.next) || ttsUrl(text, SENSEI_VOICE);
    showHelp({ ...h, reading: which });
    await speakClip(src, rate);
    if (id !== saying.current || !live.current || !helping.current) return;
    const now = helpNow.current!;
    showHelp({ ...now, reading: null, turn: true });
    if (!auto) return;
    // Nothing tapped for a while: once more, slower (the whole sentence, when she is sure and it's the first
    // telling); when she asked which meaning, she waits for the pick.
    autoAgain.current = window.setTimeout(() => {
      const n = helpNow.current;
      if (!n || !n.turn || n.reading || !helping.current || !live.current) return;
      if (n.step === 1 && !n.sure && (n.opts?.length ?? 0) > 1) return;
      if (n.step === 1 && n.sure && n.next) void whole(false);
      else void voiceLine(which, SLOWER, false);
    }, 5000);
  }

  function hearAgain(slow: boolean) {
    const h = helpNow.current;
    if (!h || h.reading) return;
    void voiceLine(h.step === 2 ? "next" : "say", slow ? SLOWER : SLOW, false);
  }

  function whole(tapped = true) {
    const h = helpNow.current;
    if (!h || !h.next || h.reading) return;
    keepHelp(h);
    showHelp({ ...h, step: 2 });
    return voiceLine("next", SLOW, tapped);
  }

  function pickOpt(i: number) {
    const h = helpNow.current;
    const o = h?.opts?.[i];
    if (!h || !o || h.reading) return;
    const c: HelpNow = { ...h, next: o.ja, zh: o.zh, added: o.added, audio: { say: h.audio?.say ?? "", next: o.audio ?? "" }, step: 2 };
    keepHelp(c);
    showHelp(c);
    void voiceLine("next", SLOW, false);
  }

  // 接着说: her voice stops, the mic opens again and the clock goes on. Her card stays.
  async function goOn() {
    if (!helping.current || !live.current || rec.current) return;
    window.clearTimeout(autoAgain.current);
    saying.current++;
    stopAudio();
    const h = helpNow.current;
    if (h) showHelp({ ...h, reading: null, turn: false });
    const n = new Recorder();
    rec.current = n;
    try {
      await n.start();
    } catch {
      rec.current = null;
      helping.current = false;
      void finish();
      return;
    }
    if (!live.current) return void n.stop().catch(() => {});
    listen(n);
    stoppedMs.current += Date.now() - stoppedAt.current;
    stoppedAt.current = 0;
    helping.current = false;
  }

  // A place she helped, for after the telling; her sentence goes to フレーズ帳 (and so to 瞬間 and the review).
  function keepHelp(h: HelpRes) {
    if (!h.next || helped.current.some((x) => x.round === slot && x.next === h.next)) return;
    helped.current.push({ round: slot, said: h.said, say: h.say, added: h.added, next: h.next, zh: h.zh });
    if (h.zh && !hasCard(p, h.next)) toggleCard({ ja: h.next, zh: h.zh, voice: RADIO_VOICE.A, scenarioId: "retell" });
  }

  async function finish() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (!live.current) return;
    live.current = false;
    window.clearTimeout(autoAgain.current);
    saying.current++;
    const r = rec.current;
    rec.current = null;
    ears.current?.close();
    ears.current = null;
    stopAudio();
    showHelp(null);
    const n = round;
    const old = warming;
    setPhase("between");
    setBusy("listen");
    let wav: Blob;
    try {
      if (r) segs.current.push(await r.stop());
      wav = await joinWavs(segs.current);
      segs.current = [];
    } catch {
      setBusy("");
      setError("录音出错了，这一遍再说一次");
      return;
    }
    const sec = wavSeconds(wav);
    // Soft music fills the pause until the next telling starts (none after the last).
    if (old || n < 2) void startPause();
    // The listener nods at once, like a person would, while the recording is being written down.
    const who = listener;
    play(ttsUrl(AIZUCHI[who], voiceOf(who)), 1).catch(() => {});
    const flow: Flow = await flowOf(wav).catch(() => ({ span: sec, pauses: 0, runs: [], gaps: [] }));
    setPausesNow(perMinute(flow.pauses, flow.span || sec));
    setMurmurs(0);
    // Gemini first (word for word, with where the silences fell); Azure if that fails.
    let heard: Heard | null = null;
    if (flow.runs.length) {
      try {
        const clips = await runClips(wav, flow.runs);
        // Expressions praised on earlier days or earlier today aren't praised again.
        const avoid = [...(p.retells ?? []).slice(-14).flatMap((r) => r.good ?? []), ...takes.flatMap((t) => (t?.good ? [t.good] : []))];
        heard = await post<Heard>({ kind: "hear", clips, listener: who, topic: shownTopic!.title, avoid });
      } catch {}
    }
    let text = heard ? heard.runs.map((r) => r.text).join("") : "";
    if (!heard) {
      try {
        text = await transcribeLong(wav);
      } catch {}
    }
    if (sec < 8 || chars(text) < 5) {
      setBusy("");
      setError("这一遍没听清，或者太短了。不要紧，再说一次这一遍。");
      return;
    }
    const lines = REACTIONS[who];
    const reaction = heard?.reaction || lines[Math.floor(Math.random() * lines.length)];
    play(ttsUrl(reaction, voiceOf(who)), 1).catch(() => {});
    setSaid({ who, text: reaction });
    recordSpeech(sec);
    {
      const at = old ? 3 : n;
      const t = shownTopic!;
      setReviews((r) => ({ ...r, [at]: "wait" }));
      post<RetellReview>({ kind: "review", topic: `${t.ja}\n${t.about}`.slice(0, 900), said: heard ? marked(heard, flow) : text, round: old ? 1 : n + 1 })
        .then((v) => setReviews((r) => ({ ...r, [at]: v })))
        .catch(() => setReviews((r) => ({ ...r, [at]: "fail" })));
    }
    const span = flow.span || sec;
    const take: Take = {
      text,
      sec,
      cpm: Math.round((chars(text) / sec) * 60),
      span,
      pauses: flow.pauses,
      perMin: perMinute(flow.pauses, span),
      ...(heard && { stalls: perMinute(heard.runs.filter((r) => r.cut).length, span) }),
      ...(heard?.good && { good: heard.good }),
    };
    const slot = old ? 3 : n;
    kana.current[slot] = heard
      ? Promise.resolve(heard.runs.map((r) => r.kana).join(""))
      : post<{ kana: string[] }>({ kind: "kana", texts: [text] })
          .then((r) => r.kana[0])
          .catch(() => undefined);
    if (old) {
      setAgainTake(await rated(take, 3));
      if (again?.natural?.length) {
        post<{ used: string[] }>({ kind: "uptake", natural: again.natural, said: text })
          .then((r) => setUptake(r.used))
          .catch(() => {});
      }
      setBusy("");
      setPhase("ready");
      return;
    }
    texts.current[n] = text;
    // Places she helped on an earlier telling, said this time without her.
    const plainT = plain(text);
    setSelfSaid(
      helped.current.filter(
        (x) => x.round < n && plain(x.added).length >= 2 && plainT.includes(plain(x.added)) && !helped.current.some((y) => y.round === n && y.added === x.added),
      ),
    );
    const next = takes.map((t, i) => (i === n ? take : t));
    setTakes(next);
    saidMarked.current[n] = heard ? marked(heard, flow) : text;
    // After every telling, how each keyword was used is counted; one used well two tellings in a row
    // gives its place to a new one. After the first this is decided while the fix is (and waited for
    // with it); after the second it comes in while the learner reads, and a telling already under way
    // keeps the words it started with; after the third it is only counted.
    const now = keyed?.keys ?? topic!.keys;
    const swap = post<RetellKeys>({
      kind: "keys",
      topic: topic!.about,
      keys: now.map((k) => ({ ...k, runs: keyRuns.current[k.ja] ?? 0 })),
      pool: topic!.pool,
      said: saidMarked.current.slice(0, n + 1),
    })
      .then((k) => {
        Object.assign(keyRuns.current, k.runs);
        setRunsShown({ ...keyRuns.current });
        if (Object.keys(k.runs).length) recordKeyRuns(k.runs);
        return k.done.length || k.keys.length !== now.length ? k : null;
      })
      .catch(() => null);
    if (n === 0) {
      setBusy("fix");
      // Where she helped, the learner has her words already: no second answer for the same stall.
      const st = heard && !helped.current.some((x) => x.round === 0) ? stallOf(heard, flow) : null;
      firstWav.current = wav;
      try {
        const f = await post<RetellFix>({
          kind: "fix",
          topic: topic!.about,
          said: heard ? marked(heard, flow) : text,
          known: known.current,
          carry: carry ? { focus_zh: carry.focus_zh, better: carry.better } : undefined,
          stall: st ? { before: st.before, after: st.after, secs: st.secs } : undefined,
        });
        setFix(f);
        if (carry) {
          setCarried(f.carried);
          // Not coming up at all is neither right nor wrong: the point just waits for the next story.
          if (f.carried !== "unused") recordPoints([{ tag: carry.tag, zh: carry.zh, ok: f.carried === "right" }], f.carried === "right" ? [] : [carry]);
        }
        if (st && f.stall.better) {
          // The words that were missing: kept for 瞬間 (say it fast from the Chinese) and the review.
          setStall(st);
          if (f.stall.zh && !hasCard(p, f.stall.better)) toggleCard({ ja: f.stall.better, zh: f.stall.zh, voice: RADIO_VOICE.A, scenarioId: "retell" });
        } else {
          const pt = pointOf(f);
          if (pt && pt.tag !== carry?.tag) recordPoints([{ tag: pt.tag, zh: pt.zh, ok: false }], [pt]);
        }
      } catch {
        // The tellings still work without the one point.
      }
      renew(await swap);
      setBusy("");
      setRound(1);
      return;
    }
    if (n === 1) {
      setBusy("");
      setRound(2);
      swap.then((k) => {
        if (!rec.current) renew(k);
      });
      return;
    }
    // Third time: done.
    setBusy("end");
    const all = await Promise.all(next.map((t, i) => rated(t!, i)));
    setTakes(all);
    const cpm = all.map((t) => t.cpm);
    const mps = all.every((t) => t.mps) ? all.map((t) => t.mps!) : undefined;
    const stalls = all.every((t) => t.stalls !== undefined) ? all.map((t) => t.stalls!) : undefined;
    // What tomorrow carries: an older point not yet said right first (dropped after it hasn't come up
    // for three days running), else today's grammar point until the third telling shows it right.
    const pt = fix && !stall ? pointOf(fix) : null;
    const open = carry && carried !== "right" ? { ...carry, skips: carried === "unused" ? (carry.skips ?? 0) + 1 : 0 } : null;
    const keep = open && open.skips < 3 ? open : pt;
    const day: Retell = {
      date: dayKey(),
      topic: topic!.title,
      cpm,
      ...(mps && { mps }),
      pauses: all.map((t) => t.pauses),
      perMin: all.map((t) => t.perMin),
      ...(stalls && { stalls }),
      texts: texts.current.slice(0, 3),
      ...(prior.current.runsToday && { runs: prior.current.runsToday + 1 }),
      ...(all.some((t) => t.good) && { good: all.flatMap((t) => (t.good ? [t.good] : [])) }),
      ...(again &&
        againTake && { again: { topic: again.topic.title, mps: againTake.mps, pauses: againTake.pauses, stalls: againTake.stalls, ...(uptake.length && { uptake }) } }),
    };
    recordRetell(keep ? { ...day, next: keep } : day);
    if (topic!.news) markNews(topic!.news, { told: dayKey() });
    setPhase("end");
    stepDone();
    try {
      const e = await post<RetellEnd>({ kind: "end", topic: topic!.about, first: next[0]!.text, last: text, focus: pt ? fix?.focus_zh : "" });
      setEnd(e);
      const changed = e.natural.find((x) => x.you && x.you !== x.ja);
      recordNote({
        area: "retell",
        title: topic!.ja,
        good: e.praise_zh,
        ...(changed && { fix: { said: changed.you, better: changed.ja, zh: changed.zh } }),
        lines: e.natural,
      });
      if (pt && e.used !== "unused") recordPoints([{ tag: pt.tag, zh: pt.zh, ok: e.used === "right" }], e.used === "right" ? [] : [pt]);
      const settled = pt && e.used === "right" && keep === pt;
      recordRetell({ ...day, ...(keep && !settled && { next: keep }), natural: e.natural.map((x) => x.ja) });
    } catch {}
    setBusy("");
  }

  function hear(ja: string) {
    unlock();
    play(ttsUrl(ja, RADIO_VOICE.A), 1).catch(() => {});
  }

  // The learner's own few seconds around the stall.
  async function hearStall() {
    if (!stall || !firstWav.current) return;
    unlock();
    const url = URL.createObjectURL(await wavSlice(firstWav.current, stall.from, stall.to));
    play(url, 1)
      .catch(() => {})
      .finally(() => URL.revokeObjectURL(url));
  }

  if (!hydrated || !topic) return <main className="page" />;

  const back = !onRoute && (
    <Link href="/speak" className="back">
      ← 说
    </Link>
  );

  // ---- The end: three numbers, what got better, and the story said naturally ----
  if (phase === "end") {
    const all = takes.filter((t): t is Take => !!t);
    const byMora = all.length === 3 && all.every((t) => t.mps);
    const speed = all.map((t) => (byMora ? t.mps! : t.cpm));
    const top = Math.max(...speed, 1);
    const gain = speed[0] ? Math.round(((speed[2] - speed[0]) / speed[0]) * 100) : 0;
    const stalls = all.length === 3 && all.every((t) => t.stalls !== undefined) ? all.map((t) => t.stalls!) : null;
    const perMin = all.map((t) => t.perMin);
    const usual = stalls ? before.current.stalls : null;
    const score = stalls ? retellScore({ date: "", topic: "", cpm: [], stalls }) : null;
    const prev = prior.current.score;
    const nextPick = retellList(p, heardToday(p)).picks.find((r) => r.key !== topic.title);
    return (
      <main className="page">
        {back}
        <h1 className="ep-head">讲三遍</h1>
        <div className="retell-score">
          <span className="kicker">{prior.current.times + 1}回目</span>
          <b className="retell-score-t">{topic.ja}</b>
          {score !== null ? (
            <>
              <span className={`retell-score-n ${prev === null || score >= prev ? "ok" : ""}`}>{score}</span>
              {prev !== null && (
                <span className={`retell-score-up ${score >= prev ? "ok" : ""}`}>
                  {score > prev ? `↑ ${score - prev}` : score < prev ? `↓ ${prev - score}` : "±0"}　前回 {prev}
                </span>
              )}
            </>
          ) : (
            <span className="muted retell-score-zh">这次没算出分数</span>
          )}
        </div>
        <div className="today retell-end">
          <span className="kicker">{byMora ? "每秒说出的音拍" : "每分钟说出的字数"}</span>
          <div className="retell-bars">
            {speed.map((c, i) => (
              <div key={i}>
                <i style={{ height: `${Math.max(8, (c / top) * 100)}%` }} className={i === 2 ? "now" : ""} />
                <b>{c}</b>
                <span>{nameOf(LISTENERS[i])}</span>
              </div>
            ))}
          </div>
          <span className="today-zh">
            {gain > 0 ? `第三遍比第一遍快了 ${gain}%。` : "三遍速度差不多，说明第一遍就已经比较顺了。"}
            {byMora && before.current.mps ? ` 第一遍：最近一般 ${before.current.mps} → 今天 ${speed[0]}。` : ""}
          </span>
          <span className="today-zh">
            {stalls ? `句子中间卡住，每分钟：${stalls.join(" → ")} 次` : `停了 1 秒以上，每分钟：${perMin.join(" → ")} 次`}
            {stalls && usual !== null ? `（第一遍最近一般 ${usual} 次）` : ""}
          </span>
          {againTake && (
            <span className="today-zh">
              上次的故事又讲了一遍{again?.last && againTake.mps ? `：上次最后一遍 ${again.last} → 今天 ${againTake.mps}` : ""}。
            </span>
          )}
        </div>
        <HelpedList items={[]} self={selfSaid} onHear={hear} />
        <ReviewList r={reviews[2]} onHear={hear} />
        {busy === "end" && <Note wait text="在看你的第三遍…" />}
        {end && (
          <>
            <Link href="/me#retell" className="to-sensei">
              <span>
                <b>老师的点评</b>
                <small>你讲的 → 更自然的说法，{end.natural.filter((x) => x.you && x.you !== x.ja).length} 处</small>
              </span>
              <i>›</i>
            </Link>
            {along ? (
              <SayAlong lines={end.natural.map((x) => ({ ja: x.ja, zh: x.zh }))} voice={RADIO_VOICE.A} onClose={() => setAlong(false)} />
            ) : (
              <>
                <button
                  className="today-go retell-along"
                  onClick={() => {
                    unlock();
                    setAlong(true);
                  }}
                >
                  跟着说
                </button>
              </>
            )}
          </>
        )}
        {!onRoute && nextPick && (
          <Link href={nextPick.href} className="retell-next">
            <span>
              <small>おすすめ · 次は</small>
              <b>{nextPick.ja}</b>
            </span>
            {nextPick.score !== null && <em>{nextPick.score}</em>}
            <i>›</i>
          </Link>
        )}
        {!onRoute && (
          <Link href="/retell/list" className="retell-pick">
            一覧から選ぶ
          </Link>
        )}
      </main>
    );
  }

  const take0 = takes[0];
  // The one thing for the second and third telling: the words missing where the first one got stuck,
  // else the grammar point.
  const focus = stall && fix?.stall.better ? `卡住的地方这样说：「${fix.stall.better}」` : fix?.focus_zh;
  const talking = phase === "talk";
  const shownT = shownTopic!;
  // Keys from the episode as it is now: its readings may have been checked since the topic was picked.
  const shownEp = shownT.ep ? p.episodes.find((e) => e.id === shownT.ep) : undefined;
  const shownKeys = shownEp ? epKeys(shownEp) : shownT.keys;
  // Keywords every time (renewed as they are learned); the ready-made openings only the first time.
  const keys = warming ? shownKeys : (keyed?.keys ?? shownKeys);
  const showStarters = warming || round === 0;

  return (
    <main className="page">
      {!talking && back}
      <h1 className="ep-head">讲三遍</h1>
      <div className="today retell">
        <span className="kicker">
          {warming ? `先把上次的故事再讲一遍 · 讲给${nameOf(listener)}` : `第 ${round + 1} 遍 · 讲给${nameOf(listener)}`}
        </span>
        <span className="today-title">
          <span className="retell-topic">
            <b>{shownT.ja}</b>
            {shownT.zh && <small>{shownT.zh}</small>}
          </span>
          {!warming && round === 0 && phase === "ready" && shownT.news ? (
            <Link href={`/news/${shownT.news}`} className="retell-other">
              聞き直す ›
            </Link>
          ) : (
            !warming &&
            round === 0 &&
            phase === "ready" &&
            !onRoute && (
              <Link href="/retell/list" className="retell-other">
                一覧 ›
              </Link>
            )
          )}
          {talking && (
            <span className={`today-big ${left < 10 ? "hurry" : ""}${help?.turn || help?.reading || help?.step === 0 ? " paused" : ""}`}>{clock(left)}</span>
          )}
        </span>
        {keys.length > 0 && (
          <div className="retell-keys">
            {keys.map((k) => (
              <span key={k.ja} className={!warming && keyed?.fresh.includes(k.ja) ? "new" : ""}>
                {k.ja}
                {k.kana && /[一-龯々]/.test(k.ja) && <small>{k.kana}</small>}
                {!warming && runsShown[k.ja] === 1 && <i className="key-ok">✓</i>}
              </span>
            ))}
          </div>
        )}
        {!warming && !talking && keyed && keyed.done.length > 0 && <span className="retell-done">✓ 说熟了：{keyed.done.join("・")}</span>}
        {showStarters && (
          <div className="retell-starters">
            {shownT.starters.map((s) => (
              <div key={s}>{s}</div>
            ))}
          </div>
        )}
        {!warming && round === 2 && shownT.opinion && (
          <div className="retell-starters">
            <div>{shownT.opinion}</div>
          </div>
        )}
        {!warming && round === 0 && carry && <span className="retell-focus">这次留意：{carry.focus_zh}</span>}
        {/* Under the card while the fix is being read; inside it only while telling, so it shows once. */}
        {round > 0 && focus && (talking || round === 2) && <span className="retell-focus">只注意：{focus}</span>}
        {talking ? (
          <button className="today-go retell-stop" onClick={finish}>
            <span className="rec-dot" /> 说完了
          </button>
        ) : (
          <button className="today-go retell-go" onClick={begin} disabled={phase === "starting" || !!busy}>
            {phase === "starting" ? "マイク準備中…" : busy ? (BUSY[busy] ?? "…") : round === 0 ? "说" : `${nameOf(listener)}に話す`}
          </button>
        )}
      </div>

      {talking && help && <HelpCard h={help} acts={{ again: hearAgain, whole: () => void whole(), pick: pickOpt, go: () => void goOn() }} />}
      {/* Her button, whenever the mic is on: she comes only when called. */}
      {talking && (!help || (help.step > 0 && !help.turn && !help.reading)) && (
        <button className="help-call" onClick={() => void stepIn()}>
          <SenseiFace size={36} />
          <b>森先生，帮我一下</b>
        </button>
      )}
      {!warming && !talking && !error && (busy === "listen" || busy === "fix") && (
        <WaitCard
          round={round}
          phrase={round === 1 ? (stall && fix?.stall.better) || fix?.fix.better || "" : ""}
          murmurs={murmurs}
          onMurmur={() => setMurmurs((m) => Math.min(3, m + 1))}
          onHear={hear}
          pauses={[takes[0]?.perMin, takes[1]?.perMin, pausesNow]}
        />
      )}
      {!warming && round === 0 && !talking && !error && !busy && againTake && (
        <p className="muted retell-note">
          {uptake.length ? `✓ 用上了：${uptake.map((u) => `「${u}」`).join("")}` : "✓ 上次的故事讲完了"}
        </p>
      )}
      {!warming && round === 0 && !talking && againTake && <ReviewList r={reviews[3]} onHear={hear} />}

      {round === 2 && !talking && !busy && takes[1] && (
        <div className="retell-fix">
          {said && (
            <div className="bubble">
              <span className="bubble-who">{nameOf(said.who)}</span>
              {said.text}
            </div>
          )}
          {takes[1]?.good && <Good ja={takes[1].good} onHear={hear} />}
          <HelpedList items={helped.current.filter((x) => x.round === 1)} self={selfSaid} onHear={hear} />
          {secondNote(takes[0], takes[1], texts.current[1], stall && fix?.stall.better ? fix.stall.better : fix?.fix.better).map((l) => (
            <p key={l} className="small-text fb-note">
              {l}
            </p>
          ))}
          <ReviewList r={reviews[1]} onHear={hear} />
        </div>
      )}

      {round === 1 && !talking && (
        <div className="retell-fix">
          {busy === "fix" ? (
            <Note wait text="在看你的第一遍…" />
          ) : busy ? null : fix ? (
            <>
              {carry && carried !== null && (
                <p className="small-text fb-note">
                  {carried === "right" ? "✓ 上次那一点，这次说对了" : carried === "wrong" ? "! 上次那一点还没改过来" : "上次那一点这次没用到"}
                </p>
              )}
              <HelpedList items={helped.current.filter((x) => x.round === 0)} self={[]} onHear={hear} />
              {take0?.good && <Good ja={take0.good} onHear={hear} />}
              <div className="fix-card">
                <div className="fix-head">
                  <span className="kicker">下一遍只改这里</span>
                  {stall && fix.stall.better && <span className="fix-badge">卡了 {stall.secs} 秒</span>}
                </div>
                {stall && fix.stall.better ? (
                  <>
                    <span className="fix-label">你说的</span>
                    <button className="say mine" onClick={hearStall}>
                      <span>{fix.stall.you_said || stall.before}……</span>
                      <Play />
                    </button>
                    {!shown ? (
                      <button className="fix-reveal" onClick={() => setShown(true)}>
                        想好了，看答案
                      </button>
                    ) : (
                      <div className="fix-answer">
                        <span className="fix-label">这样说</span>
                        <Say ja={fix.stall.better} big onHear={hear} />
                        {fix.stall.zh && <p className="fix-zh">{fix.stall.zh}</p>}
                        {fix.stall.around && (
                          <>
                            <span className="fix-label">想不起来时，绕着说</span>
                            <Say ja={fix.stall.around} onHear={hear} />
                          </>
                        )}
                        <span className="fix-saved">✓ 已存入フレーズ帳</span>
                      </div>
                    )}
                  </>
                ) : fix.fix.better ? (
                  <>
                    {fix.fix.you_said && (
                      <>
                        <span className="fix-label">你说的</span>
                        <div className="say mine static">
                          <span>{fix.fix.you_said}</span>
                        </div>
                      </>
                    )}
                    {!shown ? (
                      <button className="fix-reveal" onClick={() => setShown(true)}>
                        想好了，看答案
                      </button>
                    ) : (
                      <div className="fix-answer">
                        <span className="fix-label">这样说</span>
                        <Say ja={fix.fix.better} big onHear={hear} />
                        <p className="fix-zh">{fix.focus_zh}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="fix-zh">{fix.focus_zh}</p>
                )}
              </div>
              <ReviewList r={reviews[0]} onHear={hear} />
            </>
          ) : take0 ? (
            <>
              <ReviewList r={reviews[0]} onHear={hear} />
            </>
          ) : null}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
