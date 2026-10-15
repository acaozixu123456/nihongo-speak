import { NextResponse } from "next/server";
import { recognize } from "@/lib/azure";

export async function POST(request: Request) {
  const ref = new URL(request.url).searchParams.get("ref") ?? undefined;
  const wav = await request.arrayBuffer();
  if (wav.byteLength < 1000) return NextResponse.json({ text: "" });
  if (wav.byteLength > 4_000_000) {
    return NextResponse.json({ error: "录音太长了，请控制在一分钟以内" }, { status: 413 });
  }
  try {
    return NextResponse.json(await recognize(wav, ref));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "语音识别失败，请再试一次" }, { status: 502 });
  }
}
