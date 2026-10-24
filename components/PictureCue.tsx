"use client";

import { useEffect, useRef, useState } from "react";
import { NEWS_VOICES, VOICE_LABEL } from "@/lib/news-model";
import { verdict, type Kind } from "@/lib/client/fx";
import { play, stop, ttsUrl, unlock } from "@/lib/client/player";
import { transcribe } from "@/lib/client/recorder";
import { recordSpeech, wavSeconds, type Card } from "@/lib/client/progress";
import HoldButton from "./HoldButton";
import { kindByText } from "./Verdict";
import KanjiHint from "./KanjiHint";

// A word card with a picture (lib/pictures.ts), in 復習. It is asked two ways, by turns: 絵→日本語 (picture_cue:
// the picture and its Chinese, say the word before the time runs out, then hear it in all six voices and say it
// after the last), and 日本語→意味 (the word, then its picture and Chinese to check).

const SAY_MS = 8000;
const best = (a: Kind, b: Kind): Kind => (a === "right" || b === "right" ? "right" : a === "close" || b === "close" ? "close" : "wrong");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const cueWay = (c: Card) => (c.step % 2 === 0 ? "picture" : "meaning");

export default function PictureCue({ card, onDone }: { card: Card & { img: string }; onDone: (remembered: boolean) => void }) {
  const way = cueWay(card);
  const [kind, setKind] = useState<Kind | null>(null);
  const [said, setSaid] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(SAY_MS);
  const [voice, setVoice] = useState(-1);
  const [echo, setEcho] = useState(false);
  const recording = useRef(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
      stop();
    },
    [],
  );

  // The time to say it: when it runs out before anything was said, the answer is shown (a miss).
  useEffect(() => {
    if (way !== "picture" || shown) return;
    const t0 = Date.now();
    const t = setInterval(() => {
      const l = SAY_MS - (Date.now() - t0);
      setLeft(Math.max(0, l));
      if (l <= 0 && !recording.current) {
        clearInterval(t);
        reveal("wrong", "");
      }
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [way, shown]);

  // Shown: the word in all six voices, then a beep and time to say it after them (跟读停顿).
  async function sixVoices() {
    unlock();
    for (let k = 0; k < NEWS_VOICES.length && live.current; k++) {
      setVoice(k);
      await play(ttsUrl(card.ja, NEWS_VOICES[k])).catch(() => {});
      await sleep(350);
    }
    if (!live.current) return;
    setVoice(-1);
    await play("/beep2.mp3").catch(() => {});
    setEcho(true);
    await sleep(Math.max(2500, card.ja.length * 400));
    if (live.current) setEcho(false);
  }

  function reveal(k: Kind, text: string) {
    setKind(k);
    setSaid(text);
    setShown(true);
    verdict(k, !text);
    sixVoices();
  }

  async function onRecorded(wav: Blob) {
    recording.current = false;
    setBusy(true);
    setError("");
    try {
      const r = await transcribe(wav, card.ja);
      if (!r.text) return setError("没听清，再说一次");
      recordSpeech(wavSeconds(wav), r.scores?.pron);
      const t = r.text.replace(/[。、！？!?.\s]/g, "");
      reveal(best(kindByText(t, card.ja), card.reading ? kindByText(t, card.reading) : "wrong"), r.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "出错了");
    } finally {
      setBusy(false);
    }
  }

  const word = (
    <div className="pc-word">
      <ruby>
        {card.ja}
        <rt>{card.reading && card.reading !== card.ja ? card.reading : ""}</rt>
      </ruby>
    </div>
  );
  // eslint-disable-next-line @next/next/no-img-element
  const pic = <img className="pc-img" src={card.img} alt="" />;

  if (way === "meaning")
    return (
      <div className="pc">
        <div className="pc-kicker">日本語 → 意味</div>
        <button className="pc-say" onClick={() => (unlock(), play(ttsUrl(card.ja, card.voice)).catch(() => {}))}>
          {word}
          <i>🔈</i>
        </button>
        {shown ? (
          <>
            {pic}
            <div className="pc-zh">{card.zh}</div>
            <KanjiHint word={card.ja} />
            <div className="pc-row">
              <button onClick={() => onDone(false)}>分からなかった</button>
              <button className="primary" onClick={() => onDone(true)}>分かった ✓</button>
            </div>
          </>
        ) : (
          <button className="primary pc-go" onClick={() => setShown(true)}>意味を見る</button>
        )}
      </div>
    );

  return (
    <div className={`pc${kind ? ` v-${kind}` : ""}`}>
      <div className="pc-kicker">絵 → 日本語</div>
      {pic}
      <div className="pc-zh">{card.zh}</div>
      {!shown && (
        <div className="pc-time">
          <i style={{ width: `${(left / SAY_MS) * 100}%` }} />
        </div>
      )}
      {shown ? (
        <>
          <div className={`pc-mark ${kind}`}>{kind === "right" ? "✓ 正解" : kind === "close" ? "△ 惜しい" : said ? "✕ もう一回" : "答え"}</div>
          {word}
          {said && kind !== "right" && <div className="pc-said">言った：{said}</div>}
          <KanjiHint word={card.ja} />
          <div className="nw-six pc-six">
            {VOICE_LABEL.map((l, k) => (
              <i key={l} className={k === voice ? "on" : voice < 0 || k < voice ? "past" : undefined}>{l}</i>
            ))}
          </div>
          <div className="pc-echo">{echo ? "一緒に言ってみよう" : " "}</div>
          <div className="pc-row">
            <button onClick={sixVoices}>もう一度聞く</button>
            <button className="primary" onClick={() => (stop(), (live.current = false), onDone(kind !== "wrong"))}>次へ</button>
          </div>
        </>
      ) : (
        <div className="row" style={{ flexWrap: "nowrap", marginTop: 12 }}>
          <button onClick={() => reveal("wrong", "")} disabled={busy}>答え</button>
          <div style={{ flex: 1 }}>
            <HoldButton label={busy ? "聞き取り中…" : "🎙 日本語で"} disabled={busy} onStart={() => (recording.current = true)} onRecorded={onRecorded} onError={(e) => ((recording.current = false), setError(e))} />
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
