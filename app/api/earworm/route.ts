import { NextResponse } from "next/server";
import { readJob, step, view } from "@/lib/earworm";
import { RadioSchema } from "@/lib/radio";
import { storageReady } from "@/lib/store";
import { vertexConfigured } from "@/lib/vertex-tts";

export const maxDuration = 120;

const ID = /^[a-z0-9-]{1,40}$/i;

// 洗脑歌 for one 趣味电台 episode (lib/earworm.ts). GET: how far it has got. POST: do the next step;
// the first call brings the episode itself, which only the phone has.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!ID.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!storageReady()) return NextResponse.json({ error: "storage not set up" }, { status: 503 });
  return NextResponse.json({ job: view(await readJob(id)) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { id?: unknown; episode?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  if (!ID.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!storageReady() || !vertexConfigured()) return NextResponse.json({ error: "not set up" }, { status: 503 });
  const ep = body.episode ? RadioSchema.safeParse(body.episode) : null;
  try {
    return NextResponse.json({ job: view(await step(id, ep?.success ? ep.data : null)) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "生成失败" }, { status: 502 });
  }
}
