"use client";

import { play, ttsUrl, unlock } from "@/lib/client/player";
import type { TeacherFix, TeacherGood } from "@/lib/client/progress";

const VOICE = "en-US-Emma:DragonHDLatestNeural|en-US-EmmaNeural";

// The teacher's marked part of a sentence, coloured where it sits.
export function Marked({ text, mark, as: Tag }: { text: string; mark: string; as: "mark" | "em" }) {
  const i = mark ? text.indexOf(mark) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <Tag>{mark}</Tag>
      {text.slice(i + mark.length)}
    </>
  );
}

// 上手になった: what the learner now says right, against how they said it before.
export function GoodBlock({ g }: { g: TeacherGood }) {
  return (
    <div className="memo-blk m-good">
      <div className="memo-hd">
        <span className="memo-mk">✓</span>进步了
      </div>
      <div className="memo-ln m-old">
        <span className="memo-t">以前</span>
        {g.before}
      </div>
      <div className="memo-ln m-new">
        <span className="memo-t">现在</span>
        <span>
          <Marked text={g.after} mark={g.mark} as="mark" />
        </span>
      </div>
      {g.zh && <div className="memo-zh">{g.zh}</div>}
    </div>
  );
}

// ここを直そう: what was said, the right way with the changed part marked, and why.
export function FixBlock({ f }: { f: TeacherFix }) {
  return (
    <div className="memo-blk m-bad">
      <div className="memo-hd">
        <span className="memo-mk">!</span>要改的地方
      </div>
      <div className="memo-ln m-wrong">
        <span className="memo-t">你说的</span>
        <s>{f.said}</s>
      </div>
      <div className="memo-ln m-right">
        <span className="memo-t">这样说</span>
        <span>
          <Marked text={f.better} mark={f.mark} as="em" />
        </span>
        <button
          className="bag-play memo-play"
          aria-label="听"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            unlock();
            play(ttsUrl(f.better, VOICE), 1).catch(() => {});
          }}
        >
          ▶
        </button>
      </div>
      {f.zh && <div className="memo-zh">{f.zh}</div>}
    </div>
  );
}
