"use client";

// 声なし: practise where speaking aloud isn't possible. The sentence is made whole in the head (or
// mouthed without voice), the answer is heard, and the learner marks it right or not themselves.
const KEY = "nihongo-speak:silent";

export function readSilent() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSilent(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
}
