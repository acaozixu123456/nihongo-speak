"use client";

import { useState } from "react";

// Small single-series charts. Tap a mark to read its value.

const W = 320;
const PAD = { top: 18, right: 8, bottom: 20, left: 28 };

function niceMax(v: number) {
  if (v <= 0) return 10;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}

export function Bars({
  data,
  goal,
  unit,
  height = 140,
  format = (v: number) => String(v),
}: {
  data: { label: string; tick?: string; value: number }[];
  goal?: number;
  unit: string;
  height?: number;
  format?: (v: number) => string;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const max = niceMax(Math.max(goal ?? 0, ...data.map((d) => d.value)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const slot = innerW / data.length;
  const bw = Math.min(24, slot - 2);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const shown = sel ?? data.length - 1;

  return (
    <div>
      <div className="tip">
        {data[shown]?.label}：<strong>{format(data[shown]?.value ?? 0)}</strong> {unit}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${unit}柱状图`}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="axis" x={PAD.left - 4} y={y(v) + 3} textAnchor="end">
              {format(v)}
            </text>
          </g>
        ))}
        {goal !== undefined && <line className="goal" x1={PAD.left} x2={W - PAD.right} y1={y(goal)} y2={y(goal)} />}
        {data.map((d, i) => {
          const x = PAD.left + slot * i + (slot - bw) / 2;
          const h = Math.max(0, y(0) - y(d.value));
          const r = Math.min(4, h / 2, bw / 2);
          // Rounded top, square at the baseline.
          const path =
            h > 0
              ? `M${x},${y(0)} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + bw - r} Q${x + bw},${y(d.value)} ${x + bw},${y(d.value) + r} V${y(0)} Z`
              : "";
          return (
            <g key={i} onClick={() => setSel(i)}>
              <rect className="hit" x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} />
              {path && <path className={`bar ${goal !== undefined && d.value < goal ? "dim" : ""}`} d={path} />}
              {sel === i && <rect x={x - 1} y={PAD.top} width={bw + 2} height={innerH} fill="none" stroke="var(--muted)" strokeWidth="1" rx="3" />}
              {d.tick && (
                <text className="axis" x={x + bw / 2} y={height - 6} textAnchor="middle">
                  {d.tick}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Line({
  data,
  unit,
  height = 140,
  min: floor,
}: {
  data: { label: string; tick?: string; value: number | null }[];
  unit: string;
  height?: number;
  min?: number;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  if (values.length === 0) return <p className="muted">还没有数据，练几次就有了。</p>;
  const hi = niceMax(Math.max(...values));
  const lo = floor ?? 0;
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const slot = innerW / data.length;
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const pts = data.map((d, i) => (d.value === null ? null : ([x(i), y(d.value)] as const)));
  const drawn = pts.filter((p): p is readonly [number, number] => p !== null);
  const path = drawn.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ");
  const area = drawn.length > 1 ? `${path} L${drawn.at(-1)![0]},${y(lo)} L${drawn[0][0]},${y(lo)} Z` : "";
  const lastIdx = data.map((d) => d.value).lastIndexOf(values.at(-1)!);
  const shown = sel ?? lastIdx;

  return (
    <div>
      <div className="tip">
        {data[shown]?.label}：<strong>{data[shown]?.value ?? "没有练"}</strong> {data[shown]?.value !== null ? unit : ""}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${unit}折线图`}>
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <g key={v}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="axis" x={PAD.left - 4} y={y(v) + 3} textAnchor="end">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {area && <path className="area" d={area} />}
        <path className="ln" d={path} />
        {data.map((d, i) => (
          <g key={i} onClick={() => setSel(i)}>
            <rect className="hit" x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} />
            {d.value !== null && <circle className="dot" cx={x(i)} cy={y(d.value)} r={i === shown ? 5 : 3.5} />}
            {d.tick && (
              <text className="axis" x={x(i)} y={height - 6} textAnchor="middle">
                {d.tick}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
