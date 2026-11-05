import { NextResponse } from "next/server";
import { hitokoto } from "@/lib/claude";
import { aboutNow } from "@/lib/kokoro";
import { getJson, setJson } from "@/lib/kv";
import { jstDay } from "@/lib/push";
import { hitoKey, type HitoDraft } from "@/lib/hitokoto-model";
import { storageReady } from "@/lib/store";

export const maxDuration = 120;

// 私の一言: a sentence from the learner's day, taken apart (parts, who to say it to, its 型, the
// situation to recall it from). Kept 90 days, so adding it again costs nothing.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 80) : "";
  if (!hitoKey(text)) return NextResponse.json({ error: "输入一句话" }, { status: 400 });
  const key = `hitokoto/${hitoKey(text)}`;
  try {
    const saved = storageReady() ? await getJson<HitoDraft>(key).catch(() => null) : null;
    if (saved) return NextResponse.json(saved);
    const memo = await aboutNow(jstDay()).catch(() => "（メモなし）");
    const draft = await hitokoto(text, memo);
    // The parts are the sentence cut up: if they don't join back into it, they are shown as one.
    const joined = draft.parts.map((p) => p.ja).join("");
    const out: HitoDraft = { ...draft, parts: joined === draft.ja ? draft.parts : [{ ja: draft.ja, zh: draft.zh, note_zh: draft.parts.map((p) => `${p.ja}：${p.note_zh}`).join("\n") }] };
    if (storageReady()) await setJson(key, out, 90).catch(() => {});
    return NextResponse.json(out);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 出错了" }, { status: 502 });
  }
}
