"use client";

import {
  GOALS,
  level,
  mastered,
  setGoal,
  stepsDone,
  allScenarios,
  totalXp,
  useProgress,
  useSyncState,
} from "@/lib/client/progress";
import { allTime, diaryMetrics, formatDuration, lastDays, weeks } from "@/lib/client/metrics";
import { Bars, Line } from "./Charts";
import Nav from "./Nav";
import Reminders from "./Reminders";

const TITLES = ["入门", "起步", "能听懂一点", "敢开口", "能应付日常", "职场能用", "说得自然", "流利", "达人"];

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

export default function Stats() {
  const p = useProgress();
  const sync = useSyncState();
  const xp = totalXp(p);
  const lv = level(xp);
  const all = allTime(p);
  const ws = weeks(p, 8);
  const thisWeek = ws[7];
  const lastWeek = ws[6];
  const days30 = lastDays(30);
  const finished = allScenarios(p).filter((s) => Object.values(stepsDone(p, s)).every(Boolean)).length;
  const diaries = [...p.diary].reverse().slice(-12);

  const compare = (a: number | null, b: number | null, unit = "") =>
    a === null || b === null || a === b ? null : (
      <span className={`delta ${a > b ? "up" : "down"}`}>
        {a > b ? "↑" : "↓"}
        {Math.abs(Math.round(a - b))}
        {unit}
      </span>
    );

  return (
    <main>
      <section className="lv lv-poster">
        <h1>成長</h1>
        <div className="lv-num">
          <span>Lv</span>
          <strong>{lv.n}</strong>
        </div>
        <div className="lv-side">
          <div className="hero-title">{TITLES[Math.min(lv.n - 1, TITLES.length - 1)]}</div>
          <div className="small-text">累计 {xp} XP · 离 Lv {lv.n + 1} 还差 {lv.to - xp} XP</div>
        </div>
        <div className="brush">
          <div style={{ width: `${((xp - lv.from) / (lv.to - lv.from)) * 100}%` }} />
        </div>
      </section>

      <h2>一共练了多少</h2>
      <div className="grid2 ledger2">
        <div className="kpi">
          <b>{formatDuration(all.speakSec)}</b>
          <span>开口说日语</span>
        </div>
        <div className="kpi">
          <b>{all.said} 句</b>
          <span>说过的句子</span>
        </div>
        <div className="kpi">
          <b>{all.listenLines} 句</b>
          <span>整段听过的句子</span>
        </div>
        <div className="kpi">
          <b>{mastered(p)} / {p.cards.length}</b>
          <span>掌握的表达 / 收藏</span>
        </div>
        <div className="kpi">
          <b>{finished}</b>
          <span>三步全部完成的场景</span>
        </div>
        <div className="kpi">
          <b>{p.diary.length} 篇</b>
          <span>口语日记</span>
        </div>
      </div>

      <h2>这周和上周比</h2>
      <div className="card">
        <div className="kpis">
          <div className="kpi">
            <b>{Math.round(thisWeek.speakSec / 60)} 分</b>
            <span>开口 {compare(thisWeek.speakSec / 60, lastWeek.speakSec / 60)}</span>
          </div>
          <div className="kpi">
            <b>{thisWeek.pron ?? "–"}</b>
            <span>发音均分 {compare(thisWeek.pron, lastWeek.pron)}</span>
          </div>
          <div className="kpi">
            <b>{thisWeek.days} / 7</b>
            <span>练习天数 {compare(thisWeek.days, lastWeek.days)}</span>
          </div>
        </div>
      </div>

      <h2>每天的 XP（近 30 天）</h2>
      <div className="card">
        <Bars
          unit="XP"
          goal={p.goal}
          data={days30.map((d, i) => ({ label: md(d), tick: i % 7 === 2 || i === 29 ? md(d) : undefined, value: p.days[d] ?? 0 }))}
        />
        <div className="small-text">虚线是每日目标。浅色的天没达到目标。</div>
      </div>

      <h2>发音分数（每周平均）</h2>
      <div className="card">
        <Line
          unit="分"
          min={40}
          data={ws.map((w, i) => ({ label: `${md(w.from)}–${md(w.to)}`, tick: i % 2 === 1 ? md(w.to) : undefined, value: w.pron }))}
        />
        <div className="small-text">跟读和复习时 Azure 给的发音分。往上走说明发音在进步。</div>
      </div>

      <h2>开口时长（每周分钟）</h2>
      <div className="card">
        <Bars
          unit="分钟"
          format={(v) => String(Math.round(v * 10) / 10)}
          data={ws.map((w, i) => ({ label: `${md(w.from)}–${md(w.to)}`, tick: i % 2 === 1 ? md(w.to) : undefined, value: w.speakSec / 60 }))}
        />
      </div>

      <h2>口语日记：每分钟能说多少字</h2>
      <div className="card">
        <Line
          unit="字/分"
          data={diaries.map((d) => ({ label: md(d.date), tick: md(d.date), value: diaryMetrics(d).perMin }))}
        />
        <div className="small-text">不看稿、自己组织语言时的语速。越说越快、需要改的地方越来越少，就是真的进步了。</div>
      </div>

      <h2>设置</h2>
      <div className="card">
        <div className="row spread">
          <span>每日目标</span>
          <div className="row">
            {GOALS.map((g) => (
              <button key={g} className={`small ${p.goal === g ? "on" : ""}`} onClick={() => setGoal(g)}>
                {g === 30 ? "轻松" : g === 50 ? "标准" : "认真"} {g}
              </button>
            ))}
          </div>
        </div>
        <p className="small-text" style={{ marginBottom: 0 }}>
          整段听 +10，跟读一句 +2（首次 80 分 +5），对话一轮 +3，点评 +10，日记 +15，复习一句 +2，三项任务全做完 +10。
        </p>
      </div>
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>练习提醒</div>
        <Reminders />
        <p className="small-text" style={{ marginBottom: 0 }}>当天目标已经完成就不会提醒。</p>
      </div>
      <div className="card">
        <div className="row spread">
          <span>云端备份</span>
          <span className="small-text">
            {sync === "ok" ? "✓ 已同步" : sync === "syncing" ? "同步中…" : sync === "error" ? "同步失败，稍后自动重试" : "未开启"}
          </span>
        </div>
        <p className="small-text" style={{ marginBottom: 0 }}>进度会自动备份。换手机或清除 Safari 数据后，登录就能恢复。</p>
      </div>
      <Nav on="stats" />
    </main>
  );
}
