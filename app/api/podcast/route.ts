import { NextResponse } from "next/server";
import { makePodcast, type Podcast } from "@/lib/claude";
import { synthesizeParts, type Part } from "@/lib/azure";

export const maxDuration = 60;

const VOICE = { zh: "zh-CN-XiaoxiaoNeural", ja: "ja-JP-NanamiNeural" };

const str = (s: unknown, n: number): s is string => typeof s === "string" && s.length <= n;

// kind "script": Haiku writes today's episode from the learner's profile.
// kind "audio": the script becomes one MP3, with a pause after each "repeat" line to say it back.
export async function POST(request: Request) {
  const body = (await request.json()) as
    | { kind: "script"; weak?: unknown; cards?: unknown; scenes?: unknown }
    | { kind: "audio"; segments?: Podcast["segments"] };
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
    if (body.kind === "audio") {
      const segs = Array.isArray(body.segments) ? body.segments.slice(0, 40) : [];
      if (!segs.length || !segs.every((s) => ["zh", "ja", "repeat"].includes(s.kind) && str(s.text, 300))) {
        return NextResponse.json({ error: "台本不对" }, { status: 400 });
      }
      const parts: Part[] = [];
      for (const s of segs) {
        if (s.kind === "zh") parts.push({ voice: VOICE.zh, text: s.text, pauseMs: 400 });
        else if (s.kind === "ja") parts.push({ voice: VOICE.ja, text: s.text, pauseMs: 700 });
        else {
          // Long enough to say it back: about a third of a second per character, plus a beat.
          const gap = Math.min(8000, 1200 + s.text.length * 330);
          parts.push({ voice: VOICE.ja, text: s.text, pauseMs: gap }, { voice: VOICE.ja, text: s.text, pauseMs: 900 });
        }
      }
      const audio = await synthesizeParts(parts);
      return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "生成失败" }, { status: 502 });
  }
}
