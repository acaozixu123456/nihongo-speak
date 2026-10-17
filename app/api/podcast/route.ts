import { NextResponse } from "next/server";
import { makePodcast } from "@/lib/claude";
import { makeRadio } from "@/lib/radio";

// Gemini can take most of a minute on a whole show, may be asked twice, and Claude then needs time of its own.
export const maxDuration = 300;

const str = (s: unknown, n: number): s is string => typeof s === "string" && s.length <= n;

// script: Haiku writes today's episode from the learner's profile. 摸鱼模式 turns it into audio (see lib/client/moyu.ts).
// radio: one 趣味电台 episode (lib/radio.ts), avoiding the titles the phone has already heard,
// on the learner's own topic when they asked for one (点播), with one of their recent mistakes as
// the listener's letter (お便り).
export async function POST(request: Request) {
  const body = (await request.json()) as { kind: "script" | "radio"; weak?: unknown; cards?: unknown; scenes?: unknown; avoid?: unknown; wish?: unknown; recent?: unknown; letter?: { said?: unknown; better?: unknown; where?: unknown } };
  try {
    if (body.kind === "script") {
      const weak = (Array.isArray(body.weak) ? body.weak : []).slice(0, 3).filter((w) => str(w?.tag, 80) && str(w?.zh, 200));
      const cards = (Array.isArray(body.cards) ? body.cards : []).slice(0, 8).filter((c) => str(c?.ja, 200) && str(c?.zh, 200));
      const scenes = (Array.isArray(body.scenes) ? body.scenes : []).slice(0, 6).filter((s) => str(s, 60));
      return NextResponse.json(
        await makePodcast({
          weak: weak.map((w) => ({
            tag: w.tag,
            zh: w.zh,
            examples: (Array.isArray(w.examples) ? w.examples : [])
              .slice(0, 2)
              .filter((e: { said?: unknown; better?: unknown }) => str(e?.said, 200) && str(e?.better, 200)),
          })),
          cards,
          scenes,
        }),
      );
    }
    if (body.kind === "radio") {
      const avoid = (Array.isArray(body.avoid) ? body.avoid : []).slice(-30).filter((t) => str(t, 60));
      const wish = str(body.wish, 100) && body.wish.trim() ? body.wish.trim() : undefined;
      const recent = (Array.isArray(body.recent) ? body.recent : []).slice(0, 24).filter((w): w is string => str(w, 20) && w.trim().length > 0);
      const l = body.letter;
      const letter =
        l && str(l.said, 200) && str(l.better, 200) && l.said && l.better
          ? { said: l.said, better: l.better, where: str(l.where, 60) && l.where ? l.where : undefined }
          : undefined;
      // Streamed as lines of JSON: how far the script has got, then the episode (or the error).
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(c) {
          const send = (o: object) => c.enqueue(enc.encode(JSON.stringify(o) + "\n"));
          try {
            send({ episode: await makeRadio(avoid, wish, letter, recent, (m) => send({ making: m })) });
          } catch (e) {
            console.error(e);
            send({ error: e instanceof Error ? e.message : "生成失败" });
          }
          c.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "生成失败" }, { status: 502 });
  }
}
