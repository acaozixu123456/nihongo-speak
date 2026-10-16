"use client";

import Link from "next/link";
import {
  mastered,
  stepsDone,
  allScenarios,
  useProgress,
  useSyncState,
} from "@/lib/client/progress";
import { allTime, diaryMetrics, formatDuration, lastDays, weeks } from "@/lib/client/metrics";
import { Bars, Line } from "./Charts";
import Nav from "./Nav";
import Reminders from "./Reminders";

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

export default function Stats() {
  const p = useProgress();
  const sync = useSyncState();
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
      <Link href="/me" className="back">← 我</Link>
      <header className="page-mast">
        <div>
          <h1>成长记录</h1>
          <p className="muted">开口时长、反应速度、发音的变化</p>
        </div>
      </header>
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

      <h2>每天开口（近 30 天，分钟）</h2>
      <div className="card">
        <Bars
          unit="分钟"
          format={(v) => String(Math.round(v * 10) / 10)}
          data={days30.map((d, i) => ({ label: md(d), tick: i % 7 === 2 || i === 29 ? md(d) : undefined, value: (p.stats[d]?.speakSec ?? 0) / 60 }))}
        />
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

      <h2>瞬间说：平均几秒开口（每周）</h2>
      <div className="card">
        <Line
          unit="秒"
          data={ws.map((w, i) => ({
            label: `${md(w.from)}–${md(w.to)}`,
            tick: i % 2 === 1 ? md(w.to) : undefined,
            value: w.quickMs === null ? null : Math.round(w.quickMs / 100) / 10,
          }))}
        />
        <div className="small-text">看到中文到开始说日语用了几秒。往下走，说明开口越来越快了。</div>
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
        <div style={{ fontWeight: 600, marginBottom: 4 }}>练习提醒</div>
        <Reminders />
        <p className="small-text" style={{ marginBottom: 0 }}>当天已经练过就不会提醒。</p>
      </div>
      <div className="card">
        <div className="row spread">
          <span>云端备份</span>
          <span className="small-text">
            {sync === "ok" ? "已同步" : sync === "syncing" ? "同步中…" : sync === "error" ? "同步失败，稍后自动重试" : "未开启"}
          </span>
        </div>
        <p className="small-text" style={{ marginBottom: 0 }}>进度会自动备份到云端，清除浏览器数据后也能恢复。</p>
      </div>
      <Nav on="me" />
    </main>
  );
}
