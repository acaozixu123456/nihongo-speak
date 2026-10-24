"use client";

import Link from "next/link";
import { useState } from "react";
import { addDays } from "@/lib/progress-model";
import { allTime, lastDays, weeks } from "@/lib/client/metrics";
import { play, ttsUrl, unlock } from "@/lib/client/player";
import { dayKey, dueSkillCount, lastNote, streak, teacherFix, teacherPlan, todaysCards, useProgress, weakList, type PracticeNote, type Progress } from "@/lib/client/progress";
import { useHydrated } from "@/lib/client/hydrated";
import { FixBlock, GoodBlock } from "./TeacherMemo";
import { SenseiFace, SenseiSays, speak } from "./Sensei";

const VOICE = "en-US-Emma:DragonHDLatestNeural|en-US-EmmaNeural";
const hear = (ja: string) => {
  unlock();
  play(ttsUrl(ja, VOICE), 1).catch(() => {});
};
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

function Good({ text }: { text: string }) {
  return (
    <div className="a-good">
      <i>✓</i>
      <span>{text}</span>
    </div>
  );
}

function Fix({ said, better, zh, head = "下次这样说" }: { said?: string; better: string; zh?: string; head?: string }) {
  return (
    <div className="a-fix">
      <div className="h">
        <i>!</i>
        {head}
      </div>
      {said && (
        <div className="w">
          <s>{said}</s>
        </div>
      )}
      <div className="r">
        <span>{better}</span>
        <button className="bag-play" aria-label="听" onClick={() => hear(better)}>
          ▶
        </button>
      </div>
      {zh && <div className="z">{zh}</div>}
    </div>
  );
}

function Area({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="area" id={id}>
      <div className="area-hd">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </div>
      {children}
    </section>
  );
}

// A practice's own note: what went well, the line to say better, and (三回話す) all the natural versions.
function NoteArea({ id, title, n, extra }: { id: string; title: string; n: PracticeNote; extra?: React.ReactNode }) {
  const [all, setAll] = useState(false);
  const more = (n.lines ?? []).filter((x) => x.you && x.you !== x.ja && x.ja !== n.fix?.better);
  return (
    <Area id={id} title={title} sub={`${md(n.day)} · ${n.title}`}>
      {n.good && <Good text={n.good} />}
      {n.fix && <Fix said={n.fix.said} better={n.fix.better} zh={n.fix.zh} />}
      {!n.fix && n.lines?.[0] && <Fix head="记住这句" better={n.lines[0].ja} zh={n.lines[0].zh} />}
      {more.length > 0 &&
        (all ? (
          more.map((x) => <Fix key={x.ja} head="更自然的说法" said={x.you} better={x.ja} zh={x.zh} />)
        ) : (
          <button className="a-more" onClick={() => setAll(true)}>
            还有 {more.length} 处更自然的说法 ›
          </button>
        ))}
      {extra}
    </Area>
  );
}

function Areas({ p }: { p: Progress }) {
  const retell = lastNote(p, "retell");
  const call = lastNote(p, "call");
  const scene = lastNote(p, "scene");
  const r = (p.retells ?? []).at(-1);
  const [prev, now] = weeks(p, 2);
  // Not the one already on top as today's fix.
  const weak = weakList(p).find((w) => w.tag !== teacherFix(p)?.tag);
  const sec = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);
  const fast = sec(now.quickMs);
  const before = sec(prev.quickMs);
  return (
    <>
      {retell && (
        <NoteArea
          id="retell"
          title="复述（讲三遍）"
          n={retell}
          extra={
            r && (
              <div className="a-num">
                <span>
                  第一遍 <b>{r.cpm[0]}</b>字/分
                </span>
                {r.pauses?.[0] !== undefined && (
                  <span>
                    停顿 <b>{r.pauses[0]}</b>次
                  </span>
                )}
              </div>
            )
          }
        />
      )}
      {call && <NoteArea id="call" title="打电话" n={call} />}
      {scene && <NoteArea id="scene" title="场景对话" n={scene} />}
      {(fast !== null || weak) && (
        <Area id="drill" title="马上说・复习">
          {fast !== null && <Good text={`这周平均 ${fast} 秒开口${before !== null && before > fast ? `（上周 ${before} 秒）` : ""}`} />}
          {weak?.examples[0] ? (
            <Fix head={`还常错：${weak.tag}`} said={weak.examples[0].said} better={weak.examples[0].better} zh={`错了 ${weak.miss} 次 · ${weak.zh}`} />
          ) : (
            weak && <div className="a-num">还常错：{weak.tag}</div>
          )}
        </Area>
      )}
    </>
  );
}

// 先生: the only place 森先生 appears, and where every practice's review is kept. One thing up front (today's
// fix, else the review due), and her letter, what went well, the practice lists, reviews and record under 更多.
export default function Me() {
  const p = useProgress();
  const hydrated = useHydrated();
  const [zh, setZh] = useState(false);
  const t = hydrated ? teacherPlan() : null;
  const good = t?.good;
  const fix = hydrated ? teacherFix(p) : null;
  const n = (x: number) => (hydrated && x > 0 ? <em>{x}</em> : null);
  const day = t?.day ? `${Number(t.day.slice(5, 7))}月${Number(t.day.slice(8))}日` : "";
  const today = dayKey();
  const days21 = lastDays(21);
  const top = Math.max(1, ...days21.map((d) => p.days[d] ?? 0));

  const due = hydrated ? todaysCards(p).length : 0;
  const [more, setMore] = useState(false);

  return (
    <main className="page">
      <header className="sp-head">
        <SenseiFace size={64} nod={!!good} />
        <div>
          <h1>Moore 老师</h1>
        </div>
      </header>

      {/* One thing up front: today's fix, else the review that's due, else what she does. */}
      {fix ? (
        <section className="sp-blk">
          <FixBlock f={fix} />
          <Link href={`/quick?drill=${encodeURIComponent(fix.tag)}`} className="pil-go on">
            练习
          </Link>
          {due > 0 && (
            <Link href="/review" className="sp-due">
              复习 {due} 句 ›
            </Link>
          )}
        </section>
      ) : due > 0 ? (
        <section className="sp-blk">
          <SenseiSays ja={`Let's review ${due} sentences today.`} zh={`今天复习 ${due} 句`} />
          <Link href="/review" className="pil-go on">
            复习
          </Link>
        </section>
      ) : (
        hydrated && (
          <SenseiSays ja="Every night I read what you said, and plan tomorrow's practice." zh="每天晚上我会看你说过的话，安排第二天的练习。" />
        )
      )}

      <button className={`lt-more${more ? " open" : ""}`} onClick={() => setMore(!more)}>
        更多<span>›</span>
      </button>
      {more && (
        <>
          {t?.letter_ja && (
            <section className="sp-letter">
              <div className="sp-letter-ja">
                <span>{t.letter_ja}</span>
                <button className="bag-play" aria-label="听" onClick={() => speak(t.letter_ja!)}>
                  ▶
                </button>
              </div>
              {t.note_zh &&
                (zh ? (
                  <p className="sp-letter-zh">{t.note_zh}</p>
                ) : (
                  <button className="sp-zh" onClick={() => setZh(true)}>
                    中文 ›
                  </button>
                ))}
              <div className="sig">{day && `${day} · `}Ms. Moore</div>
            </section>
          )}
          {good && (
            <section className="sp-blk">
              <GoodBlock g={good} />
            </section>
          )}

          <div className="pl-grid">
            <Link href="/review" className="pl">
              <b>复习</b>
              {n(due)}
            </Link>
            <Link href="/practice" className="pl">
              <b>练一练</b>
              {n(hydrated ? dueSkillCount(p) : 0)}
            </Link>
            <Link href="/weak" className="pl">
              <b>常错的地方</b>
              {n(hydrated ? weakList(p).length : 0)}
            </Link>
            <Link href="/bag" className="pl">
              <b>收藏的句子</b>
            </Link>
          </div>

          {hydrated && <Areas p={p} />}

          <Link href="/stats" className="me-card sp-rec">
            <div className="me-nums">
              <span>
                <b className="accent">{hydrated ? streak(p) : "–"}</b>
                <small>连续天数</small>
              </span>
              <span>
                <b>{hydrated ? allTime(p).said : "–"}</b>
                <small>说过的句子</small>
              </span>
              <span className="chev">›</span>
            </div>
            <div className="me-days" aria-hidden>
              {days21.map((d) => {
                const xp = hydrated ? (p.days[d] ?? 0) : 0;
                return (
                  <i
                    key={d}
                    className={d === today ? "now" : undefined}
                    style={
                      xp
                        ? {
                            opacity: 0.35 + 0.65 * Math.min(1, xp / top),
                            background: "var(--accent)",
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </Link>
        </>
      )}
    </main>
  );
}
