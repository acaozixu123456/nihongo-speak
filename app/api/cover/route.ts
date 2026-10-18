import { NextResponse } from "next/server";
import { drawCover, readFile } from "@/lib/earworm";
import { spend, tooMany } from "@/lib/quota";
import { OldRadioSchema } from "@/lib/radio";
import { storageReady } from "@/lib/store";
import { vertexConfigured } from "@/lib/vertex-tts";

export const maxDuration = 180;

const ID = /^[a-z0-9-]{1,40}$/i;

// Draws an episode's cover picture if it hasn't one yet (lib/earworm.ts drawCover). The phone
// brings the episode, which only it has; the picture is then at /api/earworm/<id>/cover.png.
export async function POST(request: Request) {
  const body = (await request.json()) as { id?: unknown; episode?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const ep = OldRadioSchema.safeParse(body.episode);
  if (!ID.test(id) || !ep.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (!storageReady() || !vertexConfigured()) return NextResponse.json({ error: "not set up" }, { status: 503 });
  try {
    if (!(await readFile(id, "cover.png")) && !(await spend("cover"))) return tooMany();
    const ok = await drawCover(id, ep.data);
    return ok ? NextResponse.json({ url: `/api/earworm/${id}/cover.png` }) : NextResponse.json({ error: "画不出来" }, { status: 502 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "画不出来" }, { status: 502 });
  }
}
