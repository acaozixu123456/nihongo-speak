"use client";

import { useEffect, useRef, useState } from "react";
import type { RadioEpisode } from "@/lib/progress-model";
import { setAudioSession } from "@/lib/client/recorder";

// 洗脑歌: the episode's words and grammar as a catchy song with a cartoon for every line
// (made on the server, lib/earworm.ts). The page keeps asking the server to do the next step
// while it is open; once the song is ready its files are fetched ahead so a tap plays at once.

type Line = { sing: string; kw: string; kana: string; zh: string; scene: number; at: number };
type Job = {
  step: "lyrics" | "song" | "draw" | "ready" | "failed";
  lines?: Line[];
  end?: number;
  scenes?: number;
  version?: number;
  error?: string;
};

const DOING: Record<string, string> = {
  lyrics: "正在把单词写成歌词",
  song: "正在作曲、演唱",
  draw: "正在给每句歌词画插图",
};

const CACHE = "nihongo-speak-earworm";
const file = (id: string, f: string) => `/api/earworm/${id}/${f}`;

// Fetched once and kept, so the song plays again without the network.
async function local(url: string) {
  let res: Response | undefined;
  try {
    const cache = await caches.open(CACHE);
    res = await cache.match(url);
    if (!res) {
      const fresh = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!fresh.ok) throw new Error(String(fresh.status));
      await cache.put(url, fresh.clone());
      res = fresh;
    }
  } catch {
    res = await fetch(url);
  }
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

type Media = { song: string; scenes: string[] };

// kicker: the small line over the title before the singing starts. onEnd: the song was heard to the
// end or closed, or this episode can't have one (used by 今日's route to move on).
export default function Earworm({ ep, kicker = "趣味电台 · 洗脑歌", onEnd }: { ep: RadioEpisode; kicker?: string; onEnd?: () => void }) {
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [media, setMedia] = useState<Media | null>(null);
  const [open, setOpen] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const latest = useRef(ep);
  latest.current = ep;

  // Ask how far it has got, and keep it going while this page is open. A request the phone
  // dropped (screen locked, app in the background) gives up after a while rather than leaving
  // the spinner up forever, and coming back to the page asks again straight away.
  const [wake, setWake] = useState(0);
  useEffect(() => {
    const back = () => document.visibilityState === "visible" && setWake((n) => n + 1);
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []);
  useEffect(() => {
    let stop = false;
    (async () => {
      for (let round = 0; !stop && round < 120; round++) {
        const t0 = Date.now();
        try {
          // Each call does the next step (or nothing, once it is done).
          const res = await fetch("/api/earworm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: latest.current.id, episode: latest.current }),
            signal: AbortSignal.timeout(130000),
          });
          const data = (await res.json()) as { job?: Job | null; error?: string };
          if (!res.ok) throw new Error(data.error ?? "出错了");
          if (stop) return;
          const j = data.job ?? null;
          // A finished song stays the same object, so its files aren't fetched (and the playing ones dropped) again.
          setJob((prev) => (prev?.step === "ready" && j?.step === "ready" ? prev : j));
          setError("");
          if (j && (j.step === "ready" || j.step === "failed")) return;
          if (!j) return; // this episode can't have one (an old episode without words)
          // Another tab is doing this step: come back after a pause.
          if (Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 8000));
        } catch (e) {
          if (stop) return;
          setError(e instanceof Error ? e.message : "出错了");
          await new Promise((r) => setTimeout(r, 10000));
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [ep.id, wake]);

  // Once it is ready, fetch the song and every scene in the background.
  const ready = job?.step === "ready" ? job : null;
  useEffect(() => {
    if (!ready?.scenes) return;
    let gone = false;
    const urls: string[] = [];
    (async () => {
      try {
        // A song sung again keeps its file name, so the version keeps an old copy from being used.
        const song = await local(`${file(ep.id, "song.mp3")}?v=${ready.version ?? 1}`);
        urls.push(song);
        // Only the scenes the lines use: one the painter never managed to draw isn't there.
        const used = [...new Set(ready.lines!.map((l) => l.scene))];
        const scenes: string[] = [];
        await Promise.all(
          used.map(async (i) => {
            const src = await local(file(ep.id, `i${i}.png`));
            urls.push(src);
            scenes[i] = src;
          }),
        );
        if (!gone) setMedia({ song, scenes });
      } catch (e) {
        if (!gone) setError(e instanceof Error ? e.message : "下载失败");
      }
    })();
    return () => {
      gone = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [ready, ep.id]);

  const gone = job === null || job?.step === "failed";
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    if (gone) end.current?.();
  }, [gone]);

  if (job === undefined || job === null) return null;

  if (job.step === "failed") {
    return (
      <div className="ew-card">
        <div className="ew-text">
          <div className="ew-title">洗脑歌</div>
          <div className="muted">没做成：{job.error}</div>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="ew-card making">
        <span className="ew-spin" />
        <div className="ew-text">
          <div className="ew-title">洗脑歌制作中</div>
          <div className="muted">{DOING[job.step]}，大约 2 分钟。留在这页就会一直做下去，离开了下次打开接着做。</div>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );
  }

  // iPhone only plays sound started from the tap itself.
  function start() {
    const a = audio.current;
    if (!a || !media) return;
    document.querySelectorAll("audio").forEach((o) => o !== a && o.pause());
    setAudioSession("playback");
    a.src = media.song;
    a.currentTime = 0;
    a.play().catch(() => {});
    setOpen(true);
  }

  return (
    <>
      <audio ref={audio} playsInline />
      <button className="ew-card ew-ready" onClick={start} disabled={!media}>
        <span className="ew-poster" style={{ backgroundImage: `url(${media?.scenes[ready.lines![0].scene] ?? file(ep.id, `i${ready.lines![0].scene}.png`)})` }}>
          {media ? "▶" : <span className="ew-spin" />}
        </span>
        <span className="ew-text">
          <span className="ew-title">洗脑歌</span>
          <span className="muted">
            {[...new Set(ready.lines!.map((l) => l.kw))].slice(0, 5).join("・")} 唱给你听
          </span>
        </span>
      </button>
      {error && <p className="error">{error}</p>}
      {open && media && audio.current && (
        <Stage
          audio={audio.current}
          lines={ready.lines!}
          end={ready.end ?? 70}
          media={media}
          title={ep.title_zh}
          kicker={kicker}
          onEnded={() => {
            // On the route the next stop is announced, so the stage steps aside for it.
            if (!onEnd) return;
            setOpen(false);
            onEnd();
          }}
          onClose={() => {
            audio.current?.pause();
            setOpen(false);
            onEnd?.();
          }}
        />
      )}
    </>
  );
}

type StageProps = { audio: HTMLAudioElement; lines: Line[]; end: number; media: Media; title: string; kicker: string; onEnded: () => void; onClose: () => void };

function Stage({ audio: a, lines, end, media, title, kicker, onEnded, onClose }: StageProps) {
  const ended = useRef(onEnded);
  ended.current = onEnded;
  const [at, setAt] = useState(-1);
  const [pos, setPos] = useState(0);
  const [paused, setPaused] = useState(false);
  const scene = lines[Math.max(0, at)]?.scene ?? 0;

  useEffect(() => {
    if (a.paused) setPaused(true);
    const done = () => {
      setPaused(true);
      ended.current();
    };
    a.addEventListener("ended", done);
    let raf = 0;
    const tick = () => {
      let i = -1;
      while (i + 1 < lines.length && lines[i + 1].at <= a.currentTime + 0.05) i++;
      setAt(i);
      setPos(Math.min(1, a.currentTime / end));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      a.removeEventListener("ended", done);
    };
  }, [a, lines, end]);

  // One beat, from how fast the lines go (each line is two bars of four).
  const gaps = lines.slice(1).map((l, i) => l.at - lines[i].at).filter((g) => g > 1);
  const beat = gaps.length ? Math.min(...gaps) / 8 : 0.46;

  function toggle() {
    if (a.paused) {
      a.play().catch(() => {});
      setPaused(false);
    } else {
      a.pause();
      setPaused(true);
    }
  }

  const line = at >= 0 ? lines[at] : null;
  return (
    <div className="ew-stage" onClick={toggle}>
      <div className="ew-frame">
        {/* The picture moves a different way on every line and bounces on the beat. */}
        <div className={`ew-pic m${Math.max(0, at) % 4}`} key={at} style={{ ["--beat" as string]: `${beat}s` }}>
          <img src={media.scenes[scene]} alt="" />
        </div>
        <div className="ew-top" key={line?.kw ?? "title"}>
          {line ? (
            <>
              <div className="ew-kana">{line.kana}</div>
              <div className={`ew-kw ${line.kw.length > 6 ? "long" : ""}`}>{line.kw}</div>
              <div className="ew-zh">{line.zh}</div>
            </>
          ) : (
            <>
              <div className="ew-kana">{kicker}</div>
              <div className="ew-name">{title}</div>
            </>
          )}
        </div>
        {line && (
          <div className="ew-line" key={at}>
            <span>♪</span>
            {line.sing}
          </div>
        )}
        {paused && <div className="ew-paused">▶</div>}
        <div className="ew-track">
          <div style={{ width: `${pos * 100}%` }} />
        </div>
      </div>
      <button
        className="ew-close"
        aria-label="关闭"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ✕
      </button>
    </div>
  );
}
