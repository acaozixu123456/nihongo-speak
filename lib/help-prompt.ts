// 森先生 stepping in while the learner is telling a story and gets stuck (三回話す). Like a real teacher:
// first she says back what the learner was trying to say, in their own words made right, adds the next two
// or three words and stops, so the learner carries on (say); if they still can't, the whole next sentence
// to repeat (next). Kept at the learner's level (N4-N3) and built on their words, never a textbook sentence.
// The same rules for Gemini (listening to the clip itself) and Haiku (reading what Azure wrote down).

export type HelpCtx = { topic: string; keys: string[]; before?: string };

// lines: the same, written as plain lines in order (SAY first), so her first line can be voiced while the
// rest is still being written.
export function helpRules(c: HelpCtx, heard: "audio" | "text" | "lines") {
  return `日本語学習者（日本在住、JLPT N4〜N3）が、テーマ「${c.topic.slice(0, 300)}」の話を人にしている途中で、言葉に詰まって黙りました。あなたは横で聞いている優しい年配の先生です。
${heard === "audio" ? "録音は、詰まる直前までの学習者の発話（最後の十数秒）です。" : "文字起こしは、詰まる直前までの学習者の発話（最後の十数秒）です。"}${c.before ? `\nこれより前に話した内容：${c.before.slice(-300)}` : ""}
${c.keys.length ? `この話のキーワード：${c.keys.join("、")}\n` : ""}
${heard === "lines" ? "" : `- said：${heard === "audio" ? "録音で学習者が言ったことを、聞こえたとおり一字一句（間違い・言いかけ・「えっと」もそのまま）。何も話していなければ空文字。" : "文字起こしをそのまま。"}
`}- say：学習者が言いかけていた文を、学習者自身の言葉を活かして自然に言い直し、その続きを2〜3語だけ足して「…」で止める（学習者が続きを自分で言えるように）。学習者が使った語はできるだけ残し、直すのは一番大事な間違い一つだけ。20字前後、長くても30字。何も話していなければ、この話の最初の一言を2〜3語だけ言って「…」で止める。
- added：say のうち、学習者が言っていない、先生が足した部分（say の中の文字列をそのまま。「…」は含めない）。
- next：say の「…」の前までをそのまま頭に置き、その文を最後まで言い切った一文（次の話題に飛ばない）。学習者のレベル（N4〜N3の語彙と文法、学習者の使った言葉や文体）で、40字以内。
- zh：next の自然な中国語訳（簡体字）。
話は学習者の話。新しい内容や難しい言葉を足さない。${
    heard === "lines" ? "\n\n次の4行だけを、この順に、ほかに何も書かずに出力する：\nSAY: …\nADDED: …\nNEXT: …\nZH: …" : ""
  }`;
}
