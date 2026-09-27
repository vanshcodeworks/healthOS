/**
 * Data visualisation.
 *
 * Two rules.
 *
 * 1. Geometry first, labels second. A bar reaches its height, then its value
 *    counts up, then the label arrives. Doing it the other way round asks the
 *    viewer to read a number off a bar that has not been drawn yet.
 * 2. No invented numbers. Every figure here comes from a `ChartRef`, which the
 *    storyboard gate only populates from an approved claim. A scene with no
 *    approved value renders type or a qualitative diagram instead, and the
 *    composition layer makes that choice rather than a chart defaulting to zero.
 */

import { FONTS, TYPE } from "../art/typography.js";
import { countUp } from "../motion/reveal.js";
import { ease } from "../motion/ease.js";
import { handPath } from "../art/hand.js";
import { pathLength } from "../motion/draw.js";
import type { Palette } from "../art/palette.js";
import type { ChartRef } from "../props.js";

export interface DataVizProps {
  chart: ChartRef;
  palette: Palette;
  frame: number;
  fps: number;
  width: number;
  height: number;
  seed?: number;
  delayFrames?: number;
  decimals?: number;
}

export function DataViz(props: DataVizProps) {
  switch (props.chart.kind) {
    case "bar":
      return <BarChart {...props} />;
    case "line":
      return <LineChart {...props} />;
    case "percentage":
      return <RingChart {...props} />;
    case "comparison":
      return <Comparison {...props} />;
    case "counter":
      return <CounterFigure {...props} />;
    case "stat_tile":
      return <StatTiles {...props} />;
    default:
      return null;
  }
}

function BarChart({ chart, palette, frame, fps, width, height, delayFrames = 0, decimals = 0 }: DataVizProps) {
  const data = chart.data ?? [];
  if (data.length === 0) return null;
  const gap = width * 0.035;
  const barW = (width - gap * (data.length - 1)) / data.length;
  const max = Math.max(...data.map((d) => d.value), 0.0001);
  const plotH = height * 0.78;
  const baseY = height;
  const axisFrames = Math.round(0.5 * fps);
  const stagger = Math.round(0.11 * fps);
  const labelSize = Math.min(24, barW * 0.22);

  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <line
        x1={0}
        y1={baseY}
        x2={width}
        y2={baseY}
        stroke={palette.lineStrong}
        strokeWidth={1.6}
        strokeDasharray={`${Math.max(0, width * Math.min(1, (frame - delayFrames) / axisFrames))} ${width}`}
      />
      {data.map((d, i) => {
        const start = delayFrames + i * stagger;
        const f = frame - start;
        const t = Math.max(0, Math.min(1, f / Math.round(0.72 * fps)));
        const e = ease("expo_out", t);
        const h = Math.max(2, (d.value / max) * plotH * e);
        const x = i * (barW + gap);
        const color = d.highlight ? palette.accent : palette.ink;
        const count = countUp({ frame: Math.max(0, f - Math.round(0.2 * fps)), fps, durationInFrames: Math.round(0.6 * fps), to: d.value, decimals });
        return (
          <g key={d.label}>
            <rect
              x={x}
              y={baseY - h}
              width={barW}
              height={h}
              // Filled with its own saturated hue: a bar the colour of the paper
              // is not a chart, and a tint of the page reads as a placeholder.
              // The highlighted bar carries the accent; the others carry the
              // chart's secondary, so the series is told apart by hue.
              fill={d.highlight ? palette.accent : palette.secondary}
              stroke={d.highlight ? palette.accent : palette.secondary}
              strokeWidth={2}
              rx={6}
            />
            {t > 0.9 && (
              <text
                x={x + barW / 2}
                y={baseY - h - 16}
                textAnchor="middle"
                fontFamily={FONTS.mono}
                fontSize={labelSize + 6}
                fontWeight={600}
                fill={color}
                opacity={Math.min(1, (t - 0.9) / 0.1)}
              >
                {d.display ?? count.shown}
              </text>
            )}
            {t > 0.55 && (
              <text
                x={x + barW / 2}
                y={baseY + labelSize + 10}
                textAnchor="middle"
                fontFamily={FONTS.text}
                fontSize={labelSize}
                fill={palette.inkMuted}
                opacity={Math.min(1, (t - 0.55) / 0.45)}
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
      {chart.unit && (
        <text
          x={0}
          y={-14}
          fontFamily={FONTS.text}
          fontSize={22}
          letterSpacing={1.4}
          fill={palette.inkMuted}
        >
          {chart.unit.toUpperCase()}
        </text>
      )}
    </svg>
  );
}

function LineChart({ chart, palette, frame, fps, width, height, delayFrames = 0 }: DataVizProps) {
  const series = chart.series ?? [];
  const labels = chart.xLabels ?? [];
  if (series.length === 0 || labels.length < 2) return null;
  const pad = { left: 8, right: 8, top: 40, bottom: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(...all, 0.0001);
  const min = Math.min(...all, 0);
  const span = max - min || 1;
  const xAt = (i: number) => pad.left + (i / (labels.length - 1)) * plotW;
  const yAt = (v: number) => pad.top + plotH - ((v - min) / span) * plotH;
  const drawFrames = Math.round(1.15 * fps);
  const markerFrames = Math.round(0.5 * fps);

  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      {series.map((s, si) => {
        const d =
          s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ") +
          ` L ${xAt(s.values.length - 1).toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`;
        const line = d.replace(/ Z$/, "");
        const len = pathLength(line);
        const f = Math.max(0, frame - delayFrames - si * Math.round(0.18 * fps));
        const t = Math.max(0, Math.min(1, f / drawFrames));
        const e = ease("sine_in_out", t);
        return (
          <g key={s.name}>
            {series.length > 1 && (
              <path d={d} fill={si === 0 ? palette.accentTint : palette.surface} opacity={0.55 * e} />
            )}
            <path
              d={line}
              fill="none"
              // The first series is the accent, the second is the chart's
              // colourblind-safe complement: two series told apart by hue, not
              // by a strong line against a faint one.
              stroke={si === 0 ? palette.accent : palette.secondary}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={len}
              strokeDashoffset={len * (1 - e)}
            />
            {(chart.markers ?? []).map((m) => {
              const mi = m.at;
              if (mi < 0 || mi >= s.values.length) return null;
              const mt = Math.max(0, Math.min(1, (f - drawFrames * 0.7) / markerFrames));
              if (mt <= 0) return null;
              return (
                <g key={m.at} opacity={ease("cubic_out", mt)}>
                  <circle cx={xAt(mi)} cy={yAt(s.values[mi]!)} r={5.5} fill={palette.accent} />
                  <line
                    x1={xAt(mi)}
                    y1={yAt(s.values[mi]!)}
                    x2={xAt(mi)}
                    y2={pad.top + plotH}
                    stroke={palette.lineStrong}
                    strokeWidth={1.2}
                    strokeDasharray="4 5"
                  />
                  <text
                    x={xAt(mi)}
                    y={yAt(s.values[mi]!) - 16}
                    textAnchor="middle"
                    fontFamily={FONTS.text}
                    fontSize={21}
                    fontWeight={600}
                    fill={palette.ink}
                  >
                    {m.label}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      <line x1={pad.left} y1={pad.top + plotH} x2={pad.left + plotW} y2={pad.top + plotH} stroke={palette.lineStrong} strokeWidth={1.6} />
      {labels.map((label, i) => (
        <text
          key={label + i}
          x={xAt(i)}
          y={pad.top + plotH + 30}
          textAnchor="middle"
          fontFamily={FONTS.text}
          fontSize={21}
          fill={palette.inkMuted}
        >
          {label}
        </text>
      ))}
      {chart.unit && (
        <text x={pad.left} y={pad.top - 16} fontFamily={FONTS.text} fontSize={21} letterSpacing={1.4} fill={palette.inkMuted}>
          {chart.unit.toUpperCase()}
        </text>
      )}
    </svg>
  );
}

function RingChart({ chart, palette, frame, fps, width, height, delayFrames = 0 }: DataVizProps) {
  const value = chart.value ?? 0;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 22;
  const circumference = 2 * Math.PI * r;
  const f = frame - delayFrames;
  const t = Math.max(0, Math.min(1, f / Math.round(1.1 * fps)));
  const e = ease("cubic_out", t);
  const count = countUp({ frame: Math.max(0, f - Math.round(0.25 * fps)), fps, durationInFrames: Math.round(0.8 * fps), to: value });
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={palette.line} strokeWidth={14} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={palette.accent}
        strokeWidth={14}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - (value / 100) * e)}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text
        x={cx}
        y={cy + 18}
        textAnchor="middle"
        fontFamily={TYPE.statSmall.fontFamily}
        fontSize={Math.round(r * 0.52)}
        fill={palette.ink}
      >
        {count.shown}
        <tspan fontSize={Math.round(r * 0.24)} fill={palette.inkMuted} dx={6}>
          %
        </tspan>
      </text>
      {chart.label && (
        <text x={cx} y={cy + r + 46} textAnchor="middle" fontFamily={FONTS.text} fontSize={26} fontWeight={600} fill={palette.ink}>
          {chart.label}
        </text>
      )}
      {chart.sublabel && (
        <text x={cx} y={cy + r + 78} textAnchor="middle" fontFamily={FONTS.text} fontSize={23} fill={palette.inkMuted}>
          {chart.sublabel}
        </text>
      )}
    </svg>
  );
}

function Comparison({ chart, palette, frame, fps, width, height, delayFrames = 0 }: DataVizProps) {
  const left = chart.left;
  const right = chart.right;
  if (!left || !right) return null;
  const max = Math.max(left.value, right.value, 0.0001);
  const colW = width * 0.38;
  const gap = width * 0.1;
  const plotH = height * 0.68;
  const baseY = height * 0.78;
  const rows = [
    { side: left, x: (width - colW * 2 - gap) / 2, color: palette.secondary },
    { side: right, x: (width - colW * 2 - gap) / 2 + colW + gap, color: palette.accent },
  ];
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      {rows.map((row, i) => {
        const f = frame - delayFrames - i * Math.round(0.2 * fps);
        const t = Math.max(0, Math.min(1, f / Math.round(0.8 * fps)));
        const e = ease("expo_out", t);
        const h = Math.max(2, (row.side.value / max) * plotH * e);
        const count = countUp({ frame: Math.max(0, f - Math.round(0.2 * fps)), fps, durationInFrames: Math.round(0.7 * fps), to: row.side.value });
        return (
          <g key={row.side.label}>
            {/* The bar is filled with its own saturated hue, not a tint of the
                page: two bars in two tints of one hue read as a bar and its
                shadow, and a bar the colour of the paper is not a chart. The
                value text stays in the ink so it wins over the fill. */}
            <rect x={row.x} y={baseY - h} width={colW} height={h} fill={row.color} stroke={row.color} strokeWidth={2} rx={6} />
            {t > 0.85 && (
              <text
                x={row.x + colW / 2}
                y={baseY - h - 18}
                textAnchor="middle"
                fontFamily={FONTS.mono}
                fontSize={34}
                fontWeight={600}
                fill={row.color}
                opacity={Math.min(1, (t - 0.85) / 0.15)}
              >
                {row.side.display ?? count.shown}
              </text>
            )}
            <text x={row.x + colW / 2} y={baseY + 40} textAnchor="middle" fontFamily={FONTS.text} fontSize={25} fontWeight={600} fill={palette.ink}>
              {row.side.label}
            </text>
          </g>
        );
      })}
      {chart.verdict && (
        <text
          x={width / 2}
          y={baseY + 92}
          textAnchor="middle"
          fontFamily={FONTS.display}
          fontSize={30}
          fill={palette.ink}
          opacity={ease("cubic_out", Math.max(0, Math.min(1, (frame - delayFrames - Math.round(0.7 * fps)) / Math.round(0.4 * fps))))}
        >
          {chart.verdict}
        </text>
      )}
    </svg>
  );
}

function CounterFigure({ chart, palette, frame, fps, width, height, delayFrames = 0, decimals = 0 }: DataVizProps) {
  const f = frame - delayFrames;
  const t = Math.max(0, Math.min(1, f / Math.round(1.2 * fps)));
  const count = countUp({ frame: f, fps, durationInFrames: Math.round(1.2 * fps), to: chart.value ?? 0, decimals });
  const size = Math.min(height * 0.52, width * 0.3);
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <text
        x={width / 2}
        y={height / 2 + size * 0.32}
        textAnchor="middle"
        fontFamily={TYPE.stat.fontFamily}
        fontSize={size}
        letterSpacing={-3}
        fill={palette.ink}
        opacity={Math.min(1, t * 2.4)}
      >
        {chart.prefix ?? ""}
        {count.shown}
        <tspan fontSize={size * 0.34} fill={palette.inkMuted} dx={8}>
          {chart.suffix ?? chart.display ?? ""}
        </tspan>
      </text>
      {chart.label && (
        <text x={width / 2} y={height / 2 + size * 0.62} textAnchor="middle" fontFamily={FONTS.text} fontSize={27} fontWeight={600} fill={palette.ink} opacity={Math.max(0, Math.min(1, (t - 0.5) / 0.5))}>
          {chart.label}
        </text>
      )}
    </svg>
  );
}

function StatTiles({ chart, palette, frame, fps, width, height, delayFrames = 0 }: DataVizProps) {
  const tiles = chart.tiles ?? [];
  if (tiles.length === 0) return null;
  const gap = 18;
  const tw = (width - gap * (tiles.length - 1)) / tiles.length;
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      {tiles.map((tile, i) => {
        const f = frame - delayFrames - i * Math.round(0.12 * fps);
        const t = Math.max(0, Math.min(1, f / Math.round(0.6 * fps)));
        const e = ease("expo_out", t);
        const x = i * (tw + gap);
        return (
          <g key={tile.label} opacity={e}>
            <line x1={x} y1={0} x2={x + tw} y2={0} stroke={i === 0 ? palette.accent : palette.lineStrong} strokeWidth={i === 0 ? 3 : 1.6} strokeDasharray={`${tw * e} ${tw}`} />
            <text
              x={x}
              y={64}
              fontFamily={TYPE.statSmall.fontFamily}
              fontSize={Math.min(72, tw * 0.3)}
              fill={palette.ink}
              transform={`translateY(${(1 - e) * 18}px)`}
            >
              {tile.value}
            </text>
            <text x={x} y={104} fontFamily={FONTS.text} fontSize={24} fontWeight={600} fill={palette.ink}>
              {tile.label}
            </text>
            {tile.note && (
              <text x={x} y={136} fontFamily={FONTS.text} fontSize={22} fill={palette.inkMuted}>
                {tile.note}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A small inline sparkline for an annotation. */
export function SparkLine({
  values,
  palette,
  width,
  height,
  progress = 1,
  color,
  seed = 37,
}: {
  values: number[];
  palette: Palette;
  width: number;
  height: number;
  progress?: number;
  color?: string;
  seed?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${((i / (values.length - 1)) * width).toFixed(1)} ${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");
  const len = pathLength(d);
  return (
    <path
      d={handPath(d, { seed, roughness: 0.8, samples: 30 })}
      fill="none"
      stroke={color ?? palette.accent}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeDasharray={len}
      strokeDashoffset={len * (1 - progress)}
    />
  );
}
