import { after, NextResponse } from "next/server";
import { patternById } from "@/content/kokoro-patterns";
import { makeDrill, readDrill, warmDrill } from "@/lib/drill";
import { jstDay } from "@/lib/push";
import { spend, tooMany } from "@/lib/quota";
import { storageReady } from "@/lib/store";

export const maxDuration = 300;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// GET ?form=<型 id>: the day's 型ドリル for one 型: the saved one, or written now (about 20-40 s).
export async function GET(request: Request) {
  if (!storageReady()) return NextResponse.json({ error: "没有存储" }, { status: 503 });
  const q = new URL(request.url).searchParams;
  const day = q.get("day") ?? jstDay();
  const form = q.get("form") ?? "";
  if (!DAY.test(day) || !patternById(form)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    const saved = await readDrill(day, form);
    if (saved) return NextResponse.json(saved);
    if (!(await spend("drill"))) return tooMany();
    const drill = await makeDrill(day, form);
    after(() => warmDrill(drill));
    return NextResponse.json(drill);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "出题失败" }, { status: 502 });
  }
}
