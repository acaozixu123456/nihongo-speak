"use client";

import { useEffect, useMemo, useState } from "react";
import { CAPTION_LABEL, CAPTION_MODES, type CaptionMode, type NewsArticle } from "@/lib/news-model";
import { verdict } from "@/lib/client/fx";
import { play, preload, stop, ttsUrl, unlock } from "@/lib/client/player";

// Pictures with the NHK articles (lib/pictures.ts draws them): the sentence's situation while it is heard,
// a word's picture on its card, and a check of what was understood by picking the sentence's picture.

// The picture of the sentence being said (NHK's picture of the story before the first one, or for a sentence
// without one). off: faded out, so the learner says the sentence from the sound alone, not the picture.
export function SceneStage({ a, at, off, big }: { a: NewsArticle; at: number; off?: boolean; big?: boolean }) {
  const src = a.sentences[at]?.scene_image ?? (a.image ? `/api/news/img/${a.id}` : null);
  // The next sentence's picture is fetched ahead, so it is there when its sentence starts.
  const next = a.sentences[at + 1]?.scene_image;
  if (!src) return null;
  return (
    <div className={`sc-stage${big ? " big" : ""}${off ? " off" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={src} src={src} alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {next && <img className="sc-pre" src={next} alt="" aria-hidden />}
    </div>
  );
}

// 字幕: one layer at a time.
export function CaptionSwitch({ mode, set }: { mode: CaptionMode; set: (m: CaptionMode) => void }) {
  return (
    <div className="cap-sw" role="group" aria-label="字幕">
      {CAPTION_MODES.map((m) => (
        <button key={m} className={m === mode ? "on" : ""} onClick={() => set(m)}>
          {CAPTION_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

// A word's picture, small, on its row (and a card's front).
export function WordPic({ src, size = 52 }: { src?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="w-pic" src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />;
}

type Q = { i: number; options: string[] };
const shuffle = <T,>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map(([, x]) => x);

// 聞いて選ぶ: a sentence is said, four pictures, pick the one it is about. Three sentences; the other pictures
// are one from a part of this article further away (so not the same moment) and the rest from other stories.
function makeQuiz(a: NewsArticle, others: NewsArticle[]): Q[] {
  const has = a.sentences.flatMap((s, i) => (s.scene_image ? [i] : []));
  const elsewhere = shuffle(others.filter((o) => o.id !== a.id).flatMap((o) => o.sentences.flatMap((s) => (s.scene_image ? [s.scene_image] : []))));
  return shuffle(has)
    .slice(0, 3)
    .map((i) => {
      const near = shuffle(has.filter((j) => Math.abs(j - i) >= 2)).slice(0, 1).map((j) => a.sentences[j].scene_image!);
      const far = elsewhere.splice(0, 4 - 1 - near.length);
      return { i, options: shuffle([a.sentences[i].scene_image!, ...near, ...far]) };
    })
    .filter((q) => q.options.length >= 3);
}

export function PicQuiz({ a, others, voice }: { a: NewsArticle; others: NewsArticle[]; voice: string }) {
  const [quiz, setQuiz] = useState<Q[] | null>(null);
  const [k, setK] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [right, setRight] = useState(0);
  const can = useMemo(() => a.sentences.filter((s) => s.scene_image).length >= 3, [a]);
  const q = quiz?.[k];
  const say = (i: number) => {
    unlock();
    play(ttsUrl(a.sentences[i].say, voice)).catch(() => {});
  };
  useEffect(() => {
    if (!q) return;
    preload(q.options);
    const t = setTimeout(() => say(q.i), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => () => stop(), []);
  if (!can) return null;
  if (!quiz)
    return (
      <button className="nw-chip big" onClick={() => setQuiz(makeQuiz(a, others))}>
        聞いて絵を選ぶ
      </button>
    );
  if (!q)
    return (
      <div className="pq-end">
        <b>{right} / {quiz.length}</b> ✓
        <button className="nw-chip" onClick={() => (setQuiz(makeQuiz(a, others)), setK(0), setRight(0))}>もう一回</button>
      </div>
    );
  const answer = a.sentences[q.i].scene_image!;
  return (
    <div className="pq">
      <div className="pq-h">
        <span>{k + 1} / {quiz.length}</span>
        <button className="nw-chip" onClick={() => say(q.i)}>▶ もう一度</button>
      </div>
      <div className="pq-grid">
        {q.options.map((src) => (
          <button
            key={src}
            className={`pq-o${picked ? (src === answer ? " ok" : src === picked ? " ng" : " dim") : ""}`}
            disabled={!!picked}
            onClick={() => {
              setPicked(src);
              const ok = src === answer;
              verdict(ok ? "right" : "wrong");
              if (ok) setRight((n) => n + 1);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" />
            {picked && src === answer && <i>✓</i>}
          </button>
        ))}
      </div>
      {picked && (
        <div className="pq-after">
          <p className="pq-ja">{a.sentences[q.i].ja}</p>
          <p className="pq-zh">{a.sentences[q.i].zh}</p>
          <button className="pil-go on" onClick={() => (stop(), setPicked(null), setK(k + 1))}>次へ</button>
        </div>
      )}
    </div>
  );
}
