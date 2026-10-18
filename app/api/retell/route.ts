import { NextResponse } from "next/server";
import { retellEnd, retellFix, retellKana, retellUptake } from "@/lib/claude";
import { hearRuns } from "@/lib/gemini-hear";

export const maxDuration = 60;

type Body =
  | { kind: "hear"; clips: string[]; listener: string; topic: string }
  | { kind: "fix"; topic: string; said: string; known?: string[]; carry?: { focus_zh: string; better: string }; stall?: { before: string; after: string; secs: number } }
  | { kind: "uptake"; natural: string[]; said: string }
  | { kind: "end"; topic: string; first: string; last: string; focus?: string }
  | { kind: "kana"; texts: string[] };

const text = (s: unknown, n: number): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= n;

// 三回話す: each telling written down word for word (with the listener's reaction), the one point
// to fix after the first telling, the wrap-up after the third, the next day's check of what stuck,
// and (when the recording could only go to Azure) the readings that speed is counted from.
export async function POST(request: Request) {
  const b = (await request.json()) as Body;
  if (b.kind === "hear") {
    const clips = Array.isArray(b.clips) ? b.clips.filter((c) => typeof c === "string") : [];
    if (!clips.length || clips.length > 60 || clips.reduce((n, c) => n + c.length, 0) > 3_500_000) {
      return NextResponse.json({ error: "录音不对" }, { status: 400 });
    }
    try {
      return NextResponse.json(await hearRuns({ clips, listener: String(b.listener ?? ""), topic: String(b.topic ?? "").slice(0, 200) }));
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: "Gemini 没听清" }, { status: 502 });
    }
  }
  if (b.kind === "uptake") {
    const natural = Array.isArray(b.natural) ? b.natural.filter((t) => text(t, 300)).slice(0, 6) : [];
    if (!natural.length || !text(b.said, 3000)) return NextResponse.json({ used: [] });
    try {
      return NextResponse.json({ used: await retellUptake({ natural, said: b.said }) });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ used: [] });
    }
  }
  if (b.kind === "kana") {
    const texts = Array.isArray(b.texts) ? b.texts.filter((t) => text(t, 3000)).slice(0, 4) : [];
    if (!texts.length) return NextResponse.json({ error: "没有内容" }, { status: 400 });
    try {
      return NextResponse.json({ kana: await retellKana(texts) });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
    }
  }
  // An episode topic is its title plus the start of its main corner (up to ~620 characters, see Retell.tsx epTopic).
  if (!text(b.topic, 1000)) return NextResponse.json({ error: "缺少话题" }, { status: 400 });
  try {
    if (b.kind === "fix") {
      if (!text(b.said, 3000)) return NextResponse.json({ error: "没有听到内容" }, { status: 400 });
      const known = Array.isArray(b.known) ? b.known.filter((t) => typeof t === "string").slice(0, 40) : [];
      const carry = b.carry && text(b.carry.focus_zh, 300) && typeof b.carry.better === "string" ? { focus_zh: b.carry.focus_zh, better: b.carry.better.slice(0, 300) } : undefined;
      const st = b.stall;
      const stall =
        st && typeof st.before === "string" && typeof st.after === "string" && typeof st.secs === "number"
          ? { before: st.before.slice(-80), after: st.after.slice(0, 80), secs: Math.round(st.secs * 10) / 10 }
          : undefined;
      return NextResponse.json(await retellFix({ topic: b.topic, said: b.said, known, carry, stall }));
    }
    if (b.kind === "end") {
      if (!text(b.first, 3000) || !text(b.last, 3000)) return NextResponse.json({ error: "没有听到内容" }, { status: 400 });
      return NextResponse.json(await retellEnd({ topic: b.topic, first: b.first, last: b.last, focus: typeof b.focus === "string" ? b.focus.slice(0, 300) : "" }));
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
