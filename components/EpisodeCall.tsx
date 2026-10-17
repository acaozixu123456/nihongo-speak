"use client";

import Link from "next/link";
import type { Call as CallDef } from "@/content/calls";
import { findEpisode, RADIO_VOICE, useProgress, type RadioEpisode } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import Call from "./Call";
import Nav from "./Nav";

// After an episode, the learner phones ケン: he asks for their answer to the closing question, then
// chats about the topic using the episode's words. Same phone call as /call (Gemini Live), with the
// episode as the scene.
export function episodeCall(ep: RadioEpisode): CallDef {
  const script = ep.lines.map((l) => `${l.who === "A" ? "ハル" : "ケン"}：${l.ja}`).join("\n").slice(0, 1100);
  const notes = [...ep.phrases.map((x) => x.ja), ...(ep.words ?? []).map((w) => w.ja)].join("、").slice(0, 250);
  return {
    id: `radio-${ep.id}`,
    titleZh: ep.title_zh,
    who: "ケン · 趣味电台",
    incoming: true,
    talk: {
      aiRole: "ラジオ番組「趣味電台」のパーソナリティ、ケン（男性、物知りで少しおとぼけ、明るくて親しみやすい。です・ます中心でときどきくだけた言い方）",
      aiVoice: RADIO_VOICE.B,
      userRole: "番組を聞いたリスナー",
      goalZh: `用日语回答「${ep.quiz_zh.replace(/[？?。]$/, "")}」，再聊聊你的看法。`,
      setup: `番組を聞き終わったリスナーに、ケンが電話をかけた。顔は見えない。1回の発話は短く（1〜2文）。
最初の質問は番組の最後のクイズ「${ep.quiz_zh}」（中国語で出題済み）。リスナーの答えが合っていれば大げさにほめ、違っていればヒントを出してもう一度聞く。わからなければ答えをやさしく教える。
そのあと、リスナー自身の経験や意見を聞く質問を1つずつして、話を広げる。今日の言葉（${notes}）を自然に使う。
5〜6往復くらいで「また聞いてくださいね」のように明るく締めくくる。
リスナーが聞き返したり黙ったりしたら、ゆっくり、もっとやさしい言葉で言い直す。
今日の放送（抜粋）：
${script}`.slice(0, 1990),
      opening: { ja: "もしもし、ケンです！今日の放送、最後まで聞いてくれましたか？最後の問題、答えわかりました？", zh: "喂，我是健！今天的节目听完了吗？最后那道题，知道答案了吗？" },
    },
  };
}

export default function EpisodeCall({ id }: { id: string }) {
  const p = useProgress();
  const hydrated = useHydrated();
  const ep = hydrated ? findEpisode(p, id) : undefined;
  if (!hydrated) return <main className="page" />;
  if (!ep) {
    return (
      <main className="page">
        <Link href="/" className="back">← 听</Link>
        <p className="muted">找不到这一期了（只保留最近 50 期）。</p>
        <Nav on="listen" />
      </main>
    );
  }
  return <Call call={episodeCall(ep)} back={{ href: `/ep/${ep.id}`, label: "← 这一期" }} />;
}
