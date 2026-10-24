"use client";

import { useEffect, useState } from "react";
import type { Explain } from "@/lib/claude";
import { play, preload, ttsUrl, unlock } from "@/lib/client/player";
import { RADIO_VOICE, saveAsked } from "@/lib/client/progress";

// What the learner selected, with the line it sits in, for 问 AI.
// easy: the radio line it sits in, which can also be shown in easy Japanese (やさしく).
type Pick = { text: string; line: string; before?: string; topic: string; ep?: string; easy?: string };
type Ask = { pick: Pick; answer?: Explain; error?: string };

// Where selecting text is typing, not asking.
const SKIP = "input, textarea, [contenteditable], .sheet, .ask-bar";

// Answers already given, kept on the phone: asking about the same words in the same line again
// (another day, after a reload) shows the saved answer instead of asking the AI again.
const ASKED_KEY = "english-speak:explain";
const askedKey = (p: Pick) => `${p.text}\n${p.line}`;
function readAsked(): Record<string, Explain> {
  try {
    return JSON.parse(localStorage.getItem(ASKED_KEY) ?? "{}") as Record<string, Explain>;
  } catch {
    return {};
  }
}
function keepAsked(p: Pick, answer: Explain) {
  try {
    const all = { ...readAsked(), [askedKey(p)]: answer };
    const keys = Object.keys(all);
    localStorage.setItem(ASKED_KEY, JSON.stringify(Object.fromEntries(keys.slice(-200).map((k) => [k, all[k]]))));
  } catch {}
}

// Long-press any text on any page to select it, then one tap: the AI explains it in its context.
// On a radio line there is a second choice: the whole line in easy Japanese.
// A page can mark a line with data-line (and data-before) and its subject with data-ask-topic;
// otherwise the block around the selection and the page's heading stand in. On an episode page
// (data-ask-ep) what was asked is kept with the episode, so 练一练 can practise it.
export default function AskAi() {
  const [pick, setPick] = useState<Pick | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  useEffect(() => {
    // Tapping the button can clear the selection first, so the offer stays up a moment after it goes.
    let clear: ReturnType<typeof setTimeout> | undefined;
    const onSelect = () => {
      const sel = document.getSelection();
      const text = sel?.toString().trim() ?? "";
      const node = sel?.anchorNode;
      const at = node ? (node instanceof Element ? node : node.parentElement) : null;
      clearTimeout(clear);
      if (text && at && !at.closest(SKIP)) setPick(pickAt(at, text));
      else clear = setTimeout(() => setPick(null), 1500);
    };
    document.addEventListener("selectionchange", onSelect);
    return () => {
      document.removeEventListener("selectionchange", onSelect);
      clearTimeout(clear);
    };
  }, []);

  // The example in an AI answer, ready for when it's tapped.
  const example = ask?.answer?.example.ja;
  useEffect(() => {
    if (example) preload([ttsUrl(example, RADIO_VOICE.A)]);
  }, [example]);

  async function askAi(p: Pick) {
    setAsk({ pick: p });
    setPick(null);
    document.getSelection()?.removeAllRanges();
    const saved = readAsked()[askedKey(p)];
    if (saved) {
      setAsk({ pick: p, answer: saved });
      if (p.ep) saveAsked(p.ep, { text: p.text, meaning_zh: saved.meaning_zh });
      return;
    }
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pick: p.text, line: p.line, before: p.before, topic: p.topic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI 出错了");
      keepAsked(p, data as Explain);
      setAsk((a) => (a?.pick === p ? { pick: p, answer: data as Explain } : a));
      if (p.ep) saveAsked(p.ep, { text: p.text, meaning_zh: (data as Explain).meaning_zh });
    } catch (e) {
      setAsk((a) => (a?.pick === p ? { pick: p, error: e instanceof Error ? e.message : "AI 出错了" } : a));
    }
  }

  // The page shows the whole line in easy Japanese (Episode.tsx listens).
  function easier(line: string) {
    setPick(null);
    document.getSelection()?.removeAllRanges();
    window.dispatchEvent(new CustomEvent("ask-easy", { detail: line }));
  }

  function say(ja: string) {
    document.querySelectorAll("audio").forEach((a) => a.pause());
    unlock();
    play(ttsUrl(ja, RADIO_VOICE.A)).catch(() => {});
  }

  return (
    <>
      {pick && !ask && !pick.easy && (
        <button className="ask-bar" onClick={() => askAi(pick)}>
          <b>问 AI</b>
          <span>{pick.text}</span>
        </button>
      )}
      {pick?.easy && !ask && (
        <div className="ask-acts">
          <button className="ask-easy" onClick={() => easier(pick.easy!)}>
            简单说
          </button>
          <button className="ask-bar" onClick={() => askAi(pick)}>
            <b>问 AI</b>
            <span>{pick.text}</span>
          </button>
        </div>
      )}
      {ask && <AskSheet ask={ask} onClose={() => setAsk(null)} onSay={say} />}
    </>
  );
}

function pickAt(at: Element, selected: string): Pick {
  const text = selected.slice(0, 300);
  const marked = at.closest<HTMLElement>("[data-line]");
  const block = at.closest("p, li, h1, h2, h3, .ja, .zh, div") ?? at;
  const around = (marked?.dataset.line ?? block.textContent ?? "").replace(/\s+/g, " ").trim();
  const line = around.includes(text) && around.length <= 400 ? around : text;
  const page = at.closest<HTMLElement>("[data-ask-topic]");
  const heading = document.querySelector("main h1, main .title, h1")?.textContent?.trim();
  return {
    text,
    line,
    before: marked?.dataset.before || undefined,
    topic: (page?.dataset.askTopic || heading || document.title || "日语练习").slice(0, 80),
    ep: page?.dataset.askEp,
    easy: at.closest<HTMLElement>("[data-easy-line]")?.dataset.easyLine,
  };
}

function AskSheet({ ask, onClose, onSay }: { ask: Ask; onClose: () => void; onSay: (ja: string) => void }) {
  const a = ask.answer;
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="kicker">问 AI</div>
        <div className="sheet-pick">{ask.pick.text}</div>
        {a?.reading && a.reading !== ask.pick.text && <div className="kana">{a.reading}</div>}
        {!a && !ask.error && <p className="muted sheet-wait">AI 正在看这一句…</p>}
        {ask.error && <p className="error">{ask.error}</p>}
        {a && (
          <>
            <p className="sheet-meaning">{a.meaning_zh}</p>
            {a.points.map((pt) => (
              <div key={pt.ja} className="sheet-point">
                <b>{pt.ja}</b>
                <span>{pt.zh}</span>
              </div>
            ))}
            {a.nuance_zh && <p className="sheet-nuance">{a.nuance_zh}</p>}
            <div className="sheet-ex" onClick={() => onSay(a.example.ja)}>
              <div className="ja">{a.example.ja}</div>
              <div className="zh">{a.example.zh}</div>
            </div>
          </>
        )}
        <button className="cta" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  );
}
