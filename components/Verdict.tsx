"use client";

import { useEffect, useRef, useState } from "react";
import { transcribe } from "@/lib/client/recorder";
import { recordSpeech, wavSeconds } from "@/lib/client/progress";
import { closeness, readStreak, sfx, verdict, type Kind } from "@/lib/client/fx";
import { JudgeWhy, type Judge, type Verdict } from "./AiJudge";
import HoldButton from "./HoldButton";

export type { Kind };

export const kindOf = (v: Verdict): Kind => (v === "good" ? "right" : v === "ok" ? "close" : "wrong");

// When the AI judge can't be reached, how close the words came decides.
export const kindByText = (said: string, ja: string): Kind => {
  const c = closeness(said, ja);
  return c >= 0.85 ? "right" : c >= 0.6 ? "close" : "wrong";
};

const WORD: Record<Kind, string> = { right: "正解！", close: "惜しい！", wrong: "もう一回！" };
const MARK: Record<Kind, string> = { right: "◯", close: "△", wrong: "✕" };

// Today's run of right answers, shared by every practice page.
export function StreakPill() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const read = () => setN(readStreak().n);
    read();
    window.addEventListener("nihongo-streak", read);
    return () => window.removeEventListener("nihongo-streak", read);
  }, []);
  if (n < 2) return null;
  return (
    <span className="streak" key={n}>
      {n} 連
    </span>
  );
}

// The ◯△✕ stamp that lands on the card.
export function Stamp({ kind }: { kind: Kind | null }) {
  if (!kind) return null;
  return <div className={`vstamp ${kind}`}>{MARK[kind]}</div>;
}

// The 判定 bar that slides up from the bottom: one word, the right Japanese if it was missed, and one or two
// buttons. Sound, haptics and today's run are taken care of when the verdict arrives (once per answer).
export function VerdictSheet({
  kind,
  quiet,
  ja,
  voice,
  why,
  note,
  onNext,
  onHear,
}: {
  kind: Kind | null;
  quiet?: boolean; // nothing was said: no buzzer, but the run still ends
  ja: string;
  voice: string;
  why?: Judge | null;
  note?: string;
  onNext: () => void;
  onHear: () => void;
}) {
  const [milestone, setMilestone] = useState(0);
  const [whyOpen, setWhyOpen] = useState(false);
  const [along, setAlong] = useState<"ok" | "no" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fired = useRef(false);

  useEffect(() => {
    if (!kind || fired.current) return;
    fired.current = true;
    const r = verdict(kind, quiet);
    if (r.milestone) {
      setMilestone(r.streak);
      setTimeout(() => setMilestone(0), 1400);
    }
  }, [kind, quiet]);

  async function onAlong(wav: Blob) {
    setBusy(true);
    setError("");
    try {
      const { text } = await transcribe(wav);
      recordSpeech(wavSeconds(wav));
      if (!text) return setError("没听清，再说一次");
      const ok = closeness(text, ja) >= 0.7;
      sfx(ok ? "right" : "wrong");
      setAlong(ok ? "ok" : "no");
    } catch {
      setError("识别失败");
    } finally {
      setBusy(false);
    }
  }

  if (!kind) {
    return (
      <div className="vsheet wait">
        <div className="vsheet-inner">
          <div className="vword judge-wait">判定中…</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`vsheet ${kind}`}>
        <div className="vsheet-inner">
          <div className="vword">
            {quiet ? "答え" : WORD[kind]}
            {note && <span className="vnote">{note}</span>}
          </div>
          {kind !== "right" && (
            <button className="vans" onClick={onHear}>
              <span className="vplay">▶</span>
              <span>{ja}</span>
            </button>
          )}
          {along && <div className="valong">{along === "ok" ? "◯ 言えた！" : "✕ もう一回"}</div>}
          {error && <div className="valong">{error}</div>}
          <div className="vbtns">
            {kind !== "right" && why && (
              <button className="vwhy" onClick={() => setWhyOpen(true)}>なぜ？</button>
            )}
            {kind === "wrong" && along !== "ok" ? (
              <div style={{ flex: 1 }}>
                <HoldButton label={busy ? "…" : along ? "もう一回" : "一緒に言う"} disabled={busy} onRecorded={onAlong} onError={setError} />
              </div>
            ) : (
              <button className="vnext" onClick={onNext}>次へ</button>
            )}
          </div>
          {kind === "wrong" && along !== "ok" && (
            <button className="vskip" onClick={onNext}>次へ</button>
          )}
        </div>
      </div>
      {whyOpen && why && (
        <div className="vwhy-layer" onClick={() => setWhyOpen(false)}>
          <div className="vwhy-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <JudgeWhy data={why} voice={voice} />
          </div>
        </div>
      )}
      {milestone > 0 && (
        <div className="vmilestone" aria-hidden>
          <div>
            <b>{milestone}</b>
            <span>連続正解</span>
          </div>
        </div>
      )}
    </>
  );
}
