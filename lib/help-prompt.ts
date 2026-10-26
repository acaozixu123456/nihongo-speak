// 森先生 stepping in while the learner is telling a story and gets stuck (三回話す). Like a real teacher:
// first she says back what the learner was saying, in their own words made right, and stops (say); then she
// guesses what they wanted to say. From their words, not from the article: the topic is only background.
// When she can tell, one sentence (said if they stay stuck); when she can't, two or three different
// meanings for the learner to pick from ("是这个意思吗？"), and only the one they pick is said.
// Kept at the learner's level (N4-N3). The same rules for Gemini (listening to the clip itself) and Haiku
// (reading what Azure wrote down).

export type HelpCtx = { topic: string; keys: string[]; before?: string };
export type HelpOpt = { ja: string; zh: string; added: string };

// lines: the same, written as plain lines in order (SAY first), so her first line can be voiced while the
// rest is still being written.
export function helpRules(c: HelpCtx, heard: "audio" | "text" | "lines") {
  return `日本語学習者（日本在住、JLPT N4〜N3）が、テーマ「${c.topic.slice(0, 300)}」について自分の言葉で話している途中で、言葉に詰まって黙りました。あなたは横で聞いている優しい年配の先生です。学習者が「何を言いたかったのか」を、学習者の言葉から汲み取ってあげてください。
${heard === "audio" ? "録音は、詰まる直前までの学習者の発話（最後の十数秒）です。" : "文字起こしは、詰まる直前までの学習者の発話（最後の十数秒）です。"}${c.before ? `\nこれより前に話した内容：${c.before.slice(-300)}` : ""}
${c.keys.length ? `この話のキーワード：${c.keys.join("、")}\n` : ""}
${heard === "lines" ? "" : `- said：${heard === "audio" ? "録音で学習者が言ったことを、聞こえたとおり一字一句（間違い・言いかけ・「えっと」もそのまま）。何も話していなければ空文字。" : "文字起こしをそのまま。"}
`}- say：学習者が言いかけていた文を、学習者自身の言葉を活かして自然に言い直したもの。直すのは一番大事な間違い一つだけ。先生の推測や新しい内容は足さず、学習者が言ったところまでで「…」で止める。30字以内。何も話していなければ、この話の最初の一言を2〜3語だけ言って「…」で止める。
- sure：学習者の言いたいことがはっきり分かるか（yes / no）。言いかけが短い・あいまい・いくつかの意味に取れるなら no。
- options：学習者が言いたかったと思われる一文。say の「…」の前までをそのまま頭に置き、その文を最後まで言い切る。学習者の言葉・言い方・それまでの話から推測し、記事やテーマの内容に合わせて話を先に進めたり、別の話題に飛んだりしない（テーマは背景として使うだけ）。sure が yes なら1つ、no なら意味がはっきり違う2〜3つを、ありそうな順に。学習者のレベル（N4〜N3の語彙と文法、学習者の使った言葉や文体）で、各40字以内。それぞれに自然な中国語訳（簡体字）を付ける。
新しい内容や難しい言葉を足さない。${
    heard === "lines"
      ? "\n\n次の形だけを、この順に、ほかに何も書かずに出力する（OPT は1〜3行）：\nSAY: …\nSURE: yes\nOPT: 日本語の一文 | 中国語訳\nOPT: 日本語の一文 | 中国語訳"
      : ""
  }`;
}

// Each option with the words she added (what follows the learner's part), for the mark and for telling
// later whether the learner said that part by themselves.
export function withAdded(say: string, opts: { ja: string; zh: string }[]): HelpOpt[] {
  const head = say.replace(/[…。？?、\s]+$/, "");
  return opts
    .map((o) => ({ ja: o.ja.trim(), zh: o.zh.trim() }))
    .filter((o, i, all) => o.ja && all.findIndex((x) => x.ja === o.ja) === i)
    .slice(0, 3)
    .map((o) => {
      let n = 0;
      while (n < head.length && n < o.ja.length && head[n] === o.ja[n]) n++;
      return { ...o, added: n >= Math.min(4, head.length) ? o.ja.slice(n).replace(/[。？?！!]+$/, "") : "" };
    });
}
