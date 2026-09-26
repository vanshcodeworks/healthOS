import type { RenderComponent } from "@hc/render";
import { type Palette, TYPE } from "./palette.js";

/**
 * A component is drawn as vector markup and animated as a GSAP timeline.
 *
 * Nothing here is a static PNG and nothing here is a generic icon with a label:
 * the anatomy family is drawn from bezier paths with editorial strokes, the
 * science family moves, and the chart family carries real numbers. Every
 * component returns its markup plus the JS that animates it, so the browser is
 * the only place that knows what frame one looks like.
 */
export interface ComponentVisual {
  svg: string;
  /**
   * JS statements, evaluated inside the page with `gsap`, a paused `tl`
   * timeline and a `sel` selector already in scope. Motion lives here rather
   * than inline in the markup so that a page never animates before GSAP loads.
   */
  motion?: string;
  /** Rough visual weight, used to pick a size when none was requested. */
  weight: number;
  /**
   * The drawing's real extents.
   *
   * The focal layer scales a component to fit its cell, and scaling against a
   * nominal box that is three times wider than the actual drawing made every
   * organ render at a third of its intended size, floating in whitespace.
   */
  extent: { w: number; h: number };
}

/**
 * The box a component is being asked to fill.
 *
 * A chart that is handed its box draws for it — bars sized to the width, type
 * sized to the height — instead of being drawn small and then scaled up, which
 * magnified 19px labels into 31px ones that ran into their neighbours. An
 * illustration has no such need, and ignores this.
 */
export interface ComponentTarget {
  w: number;
  h: number;
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

// Named entities are built by concatenation because a literal "&" in tool
// input gets decoded before it reaches the file.
const AMP = "&" + "amp;";
const LT = "&" + "lt;";
const GT = "&" + "gt;";
const QUOT = "&" + "quot;";

export function esc(value: string): string {
  return value
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/"/g, QUOT)
    .replace(/'/g, "&#39;");
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Turns a storyboard param into display text without ever printing [object Object]. */
export function str(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/** Strokes are editorial: thin, round-capped, never the 6px of a diagram tool. */
function strokeAttrs(color: string, width = 2.5): string {
  return `fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
}

/**
 * Motion that draws a stroke on, the way a pen would.
 *
 * `getTotalLength` only exists on path-like shapes, and the counter, timeline
 * and callout rules are `<line>` elements. Calling it blindly threw inside the
 * component's script, which aborted the rest of that component's motion, so the
 * length falls back to the geometry's own numbers.
 */
function draw(delay = 0.1, duration = 1.1, ease = "power2.inOut"): string {
  return `(() => {
  const shapes = gsap.utils.toArray(sel + ' [data-hf="draw"]');
  const lengthOf = (el) => {
    if (typeof el.getTotalLength === 'function') return el.getTotalLength();
    const attr = (name) => Number(el.getAttribute(name) || 0);
    const line = Math.hypot(attr('x2') - attr('x1'), attr('y2') - attr('y1'));
    if (line) return line;
    const radius = attr('r');
    if (radius) return radius * 6.2832;
    const box = attr('width') + attr('height');
    return box || 100;
  };
  shapes.forEach((shape, i) => {
    const len = lengthOf(shape);
    shape.style.strokeDasharray = len;
    shape.style.strokeDashoffset = len;
    tl.fromTo(shape, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: ${duration}, ease: "${ease}" }, ${delay} + i * 0.18);
  });
})();`;
}

function rise(delay = 0.3, stagger = 0.08, duration = 0.7): string {
  return `tl.from(sel + ' [data-hf="rise"]', { scaleY: 0, transformOrigin: '50% 100%', duration: ${duration}, stagger: ${stagger}, ease: 'power3.out' }, ${delay});`;
}

function pop(delay = 0.4, stagger = 0.06): string {
  return `tl.from(sel + ' [data-hf="pop"]', { scale: 0, opacity: 0, transformOrigin: '50% 50%', duration: 0.45, stagger: ${stagger}, ease: 'back.out(2)' }, ${delay});`;
}

function fadeUp(delay = 0.2, stagger = 0.08): string {
  return `tl.from(sel + ' [data-hf="fadeup"]', { y: 14, opacity: 0, duration: 0.5, stagger: ${stagger}, ease: 'power2.out' }, ${delay});`;
}

/**
 * Numbers count upward with tabular figures, so digits do not jitter.
 *
 * Values are read from the DOM rather than baked into the script, which keeps
 * one count-up implementation for every chart that has a number. The figure is
 * written to the element before the tween starts, so a frame captured at t=0
 * shows the real number rather than a placeholder zero that reads as a
 * fabricated data point.
 */
function countUp(delay = 0.8, duration = 0.5): string {
  return `(() => {
  document.querySelectorAll(sel + ' [data-hf="count"]').forEach((el, i) => {
    const target = Number(el.dataset.count || 0);
    const suffix = el.dataset.suffix || '';
    const decimals = el.dataset.decimals ? Number(el.dataset.decimals) : 0;
    const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
    el.textContent = fmt(target);
    const state = { v: target * 0.9 };
    tl.to(state, {
      v: target, duration: ${duration}, ease: 'power1.out', immediateRender: false,
      onUpdate: () => { el.textContent = fmt(state.v); },
    }, ${delay} + i * 0.05);
  });
})();`;
}

/** A display string split into the number that counts and the unit beside it. */
function splitValue(display: string, fallback: number): { n: number; decimals: number; suffix: string } {
  const match = display.match(/-?[\d][\d,]*(\.\d+)?/);
  if (!match) {
    return { n: fallback, decimals: 0, suffix: display ? ` ${display}` : "" };
  }
  const raw = match[0] ?? "";
  const n = Number(raw.replace(/,/g, ""));
  const decimals = raw.includes(".") ? (raw.split(".")[1] ?? "").length : 0;
  const unit = display.replace(raw, "").replace(/^[\s:,]+/, "");
  return { n: Number.isFinite(n) ? n : fallback, decimals, suffix: unit ? ` ${unit}` : "" };
}

/**
 * A restrained highlight: the key figure warms to the accent and settles.
 *
 * Fill rather than stroke, because the key marks are type and filled shapes —
 * a stroke animation on a filled bar is an animation nobody can see.
 */
function highlight(target: string, color: string, delay = 1.1): string {
  return `tl.to(${target}, { fill: '${color}', duration: 0.4, ease: 'power2.out' }, ${delay})
    .to(${target}, { fill: '${color}', scale: 1.04, transformOrigin: '50% 50%', duration: 0.3, yoyo: true, repeat: 1, ease: 'sine.inOut' }, ${delay + 0.12});`;
}

/**
 * Deterministic drift for particles.
 *
 * Seeded rather than random: the same seed must draw the same particles, or a
 * re-render of the same project would not reproduce the same video.
 */
function seededDrift(count: number, seed: number, distance: number, delay = 0.4, duration = 2.2): string {
  return `(() => {
  let s = ${seed} >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const dots = gsap.utils.toArray(sel + ' [data-hf="drift"]');
  dots.forEach((dot, i) => {
    if (i >= ${count}) return;
    const dx = (rand() - 0.5) * ${distance};
    const dy = (rand() - 0.5) * ${distance};
    tl.fromTo(dot,
      { x: 0, y: 0, opacity: 0 },
      { x: dx, y: dy, opacity: 1, duration: ${duration * 0.4}, ease: 'power1.in', delay: (i % 6) * 0.12 },
      ${delay});
    tl.to(dot, { x: dx * 1.6, y: dy * 1.6, opacity: 0.9, duration: ${duration * 0.6}, ease: 'none' }, ${delay} + ${duration * 0.4});
  });
})();`;
}

/**
 * A repeating scale pulse.
 *
 * The selector argument is interpolated as an expression, not as a quoted
 * string, because callers pass `sel + ' [data-hf=beat]'` where `sel` is a local
 * variable. Wrapping that in quotes emitted `tl.to('sel + ' [data-hf=beat]''`,
 * which is a syntax error: the whole scene's motion script failed to parse, the
 * timeline was never created, and the renderer captured one identical frame per
 * frame while every duration and probe check still passed.
 */
function pulse(target: string, delay = 0.6, period = 1.1): string {
  return `tl.to(${target}, { scale: 1.06, transformOrigin: '50% 50%', duration: ${period * 0.35}, ease: 'sine.inOut', yoyo: true, repeat: 3 }, ${delay});`;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function barChart(component: RenderComponent, p: Palette, target?: ComponentTarget): ComponentVisual {
  const series = Array.isArray(component.params.series)
    ? (component.params.series as { label?: string; value?: number; unit?: string }[])
    : [];
  const rows = series.slice(0, 5);
  const max = Math.max(1, ...rows.map((r) => Math.abs(num(r.value, 0))));
  const highlightIndex = Math.max(
    0,
    rows.findIndex((r) => num(r.value, 0) === max),
  );
  // Drawn for the box it was given, so the fit scale is 1 and the type keeps the
  // size it was designed at.
  const chartH = target?.h ?? 300;
  const gap = rows.length <= 2 ? 96 : 40;
  const barW = clamp(52, 150, ((target?.w ?? 560) - (rows.length - 1) * gap) / Math.max(1, rows.length));
  const chartW = rows.length * barW + (rows.length - 1) * gap;
  const labelSize = Math.round(clamp(19, 27, barW * 0.34));
  const valueSize = Math.round(clamp(24, 38, barW * 0.5));
  const baselineY = chartH - labelSize - 22;
  const maxH = Math.max(60, baselineY - valueSize - 18);

  const bars = rows
    .map((row, i) => {
      const h = Math.max(8, (Math.abs(num(row.value, 0)) / max) * maxH);
      const x = i * (barW + gap);
      const isKey = i === highlightIndex;
      const value = num(row.value, 0);
      const decimals = Number.isInteger(value) ? 0 : 1;
      const shown = value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      // The measure rides with its number: "95" over "240 ml cup" invites the
      // reader to guess the unit, "95 mg" does not.
      const unit = str(row.unit).trim();
      const suffix = unit ? ` ${unit}` : "";
      return [
        `<rect data-hf="rise" x="${x.toFixed(1)}" y="${(baselineY - h).toFixed(1)}" width="${barW.toFixed(
          1,
        )}" height="${h.toFixed(1)}" rx="3" fill="${isKey ? p.accent : p.ink}" opacity="${isKey ? 1 : 0.82}"/>`,
        `<text data-hf="count"${isKey ? ` data-hf-key="1"` : ""} data-count="${value}" data-decimals="${decimals}" data-suffix="${esc(
          suffix,
        )}" x="${(x + barW / 2).toFixed(1)}" y="${(baselineY - h - 12).toFixed(1)}" text-anchor="middle" font-size="${valueSize}" font-weight="700" fill="${
          isKey ? p.accent : p.ink
        }" font-family="${TYPE.text}">${shown}${esc(suffix)}</text>`,
        `<text data-hf="fadeup" x="${(x + barW / 2).toFixed(1)}" y="${(baselineY + labelSize + 4).toFixed(
          1,
        )}" text-anchor="middle" font-size="${labelSize}" fill="${
          p.inkMuted
        }" font-family="${TYPE.text}">${esc(str(row.label))}</text>`,
      ].join("");
    })
    .join("");

  const gridLines = [0.25, 0.5, 0.75, 1]
    .map(
      (f) =>
        `<line data-hf="grid" x1="0" y1="${(baselineY - maxH * f).toFixed(1)}" x2="${chartW}" y2="${(
          baselineY -
          maxH * f
        ).toFixed(1)}" stroke="${p.line}" stroke-width="1.5"/>`,
    )
    .join("");

  return {
    weight: 4,
    // The extent is the drawing that was actually produced, so the fit scale is
    // 1 and nothing is magnified after the fact.
    extent: { w: Math.max(240, chartW), h: chartH },
    svg: `<g>
      ${gridLines}
      <line data-hf="baseline" x1="0" y1="${baselineY.toFixed(1)}" x2="${chartW.toFixed(1)}" y2="${baselineY.toFixed(
        1,
      )}" ${strokeAttrs(p.ink, 2)}/>
      ${bars}
    </g>`,
    motion: `tl.from(sel + ' [data-hf="grid"]', { opacity: 0, duration: 0.3, stagger: 0.03, ease: 'none' }, 0.0);
  tl.from(sel + ' [data-hf="baseline"]', { scaleX: 0, transformOrigin: '0 50%', duration: 0.35, ease: 'power2.out' }, 0.1);
  ${rise(0.35, 0.09, 0.7)}
  ${countUp(0.75, 0.45)}
  ${fadeUp(0.5, 0.07)}
  ${highlight(`sel + ' [data-hf-key]'`, p.accent, 1.0)}`,
  };
}

// ---------------------------------------------------------------------------
// Line chart
// ---------------------------------------------------------------------------

function lineChart(component: RenderComponent, p: Palette, target?: ComponentTarget): ComponentVisual {
  const points = Array.isArray(component.params.points)
    ? (component.params.points as { x?: number; y?: number }[])
    : [];
  const w = target?.w ?? 560;
  const labelSize = Math.round(clamp(18, 26, (target?.h ?? 230) * 0.12));
  const h = Math.max(80, (target?.h ?? 300) - labelSize - 26);
  // Values that arrive as absolute figures (95, 63, 40) are normalised to the
  // series' own span; clamping them to 0..1 instead would draw three identical
  // full-height points and call it a trend.
  const values = points.map((pt) => num(pt.y, 0));
  const vmin = Math.min(...values);
  const vmax = Math.max(...values);
  const alreadyFractional = values.every((v) => v >= 0 && v <= 1);
  const span = vmax - vmin;
  const norm = (v: number): number => {
    if (alreadyFractional) return Math.max(0, Math.min(1, v));
    if (span <= 0) return 0.5;
    return Math.max(0, Math.min(1, (v - vmin) / span));
  };
  const toXY = (i: number, v: number): [number, number] => {
    const step = points.length > 1 ? w / (points.length - 1) : w;
    return [i * step, h - norm(v) * h];
  };
  const path = points
    .slice(0, 24)
    .map((pt, i) => {
      const [x, y] = toXY(i, num(pt.y, 0.5));
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const dots = points
    .slice(0, 24)
    .map((pt, i) => {
      const [x, y] = toXY(i, num(pt.y, 0.5));
      return `<circle data-hf="pop" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${p.accent}"/>`;
    })
    .join("");
  const labels = points
    .slice(0, 24)
    .map((pt, i) => {
      const [x] = toXY(i, num(pt.y, 0.5));
      const label = str((pt as { label?: string }).label);
      if (!label) return "";
      return `<text data-hf="fadeup" x="${x.toFixed(1)}" y="${(h + labelSize + 8).toFixed(1)}" text-anchor="middle" font-size="${labelSize}" fill="${p.inkMuted}" font-family="${TYPE.text}">${esc(label)}</text>`;
    })
    .join("");
  return {
    weight: 4,
    extent: { w, h: h + labelSize + 12 },
    svg: `<g>
      <line x1="0" y1="${h.toFixed(1)}" x2="${w.toFixed(1)}" y2="${h.toFixed(1)}" ${strokeAttrs(p.line, 1.5)}/>
      ${path ? `<path data-hf="draw" d="${path}" ${strokeAttrs(p.accent, 3)}/>` : ""}
      ${dots}${labels}
    </g>`,
    motion: `${draw(0.2, 1.2)}
  ${pop(0.5, 0.05)}
  ${fadeUp(0.6, 0.05)}`,
  };
}

// ---------------------------------------------------------------------------
// Ring, counter, timeline, before/after, callout
// ---------------------------------------------------------------------------

function ring(component: RenderComponent, p: Palette): ComponentVisual {
  const pct = Math.max(0, Math.min(1, num(component.params.value, 0.6)));
  const r = 92;
  const circumference = 2 * Math.PI * r;
  const dash = (circumference * pct).toFixed(1);
  const label = str(component.params.label, `${Math.round(pct * 100)}%`);
  const decimals = label.includes("%") ? 0 : 1;
  const numeric = label.match(/[\d.]+/)?.[0] ?? `${Math.round(pct * 100)}`;
  return {
    weight: 3, extent: { w: 240, h: 240 },
    svg: `<g>
      <circle cx="120" cy="120" r="${r}" fill="none" stroke="${p.line}" stroke-width="14"/>
      <circle data-hf="ring" cx="120" cy="120" r="${r}" fill="none" stroke="${p.accent}" stroke-width="14"
        stroke-linecap="round" stroke-dasharray="${dash} ${circumference.toFixed(1)}" transform="rotate(-90 120 120)"/>
      <text data-hf="count" data-count="${numeric}" data-decimals="${decimals}" data-suffix="${esc(label.replace(/[\d.]+/, ""))}"
        x="120" y="132" text-anchor="middle" font-size="44" font-weight="700" fill="${p.ink}" font-family="${TYPE.text}">0</text>
    </g>`,
    motion: `tl.from(sel + ' [data-hf="ring"]', { strokeDasharray: '0 ' + ${circumference.toFixed(1)}, duration: 1.0, ease: 'power2.inOut' }, 0.2);
  ${countUp(0.5, 0.7)}`,
  };
}
/**
 * A figure, set large.
 *
 * The glyphs are the widest thing this component draws, so the type size is fitted
 * to the extent rather than fixed at 190px. A fixed size overflowed on long values
 * such as "2.5 litres/day", and because the extent is scaled up to 1.6x for a focal
 * cell, an overflow of a few dozen pixels in here became content running off both
 * edges of the frame in every single frame of the shot.
 */
function counter(component: RenderComponent, p: Palette): ComponentVisual {
  const label = str(component.params.label, str(component.label, "0"));
  const { n, decimals, suffix } = splitValue(label, 0);
  const shown = n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const w = 600;
  const h = 250;
  const text = `${shown}${suffix}`;
  // Digits in a heavy sans face run a little over half their point size, so this is
  // an estimate rather than a measurement; the 0.86 factor leaves the margin that
  // keeps the estimate on the safe side.
  const fontSize = Math.max(64, Math.min(190, Math.floor((w * 0.86) / (text.length * 0.56))));
  return {
    weight: 4,
    extent: { w, h: 250 },
    svg: `<g>
      <text data-hf="count" data-count="${n}" data-decimals="${decimals}" data-suffix="${esc(suffix)}"
        x="${w / 2}" y="${Math.round(h * 0.78)}" text-anchor="middle" font-size="${fontSize}" font-weight="700" fill="${p.ink}" font-family="${TYPE.text}">${esc(
          text,
        )}</text>
      <line data-hf="draw" x1="${Math.round(w * 0.28)}" y1="${h - 12}" x2="${Math.round(w * 0.72)}" y2="${h - 12}" ${strokeAttrs(
          p.accent,
          3,
        )}/>
    </g>`,
    motion: `${countUp(0.2, 0.9)}
  ${draw(0.8, 0.5, "power2.out")}`,
  };
}

/**
 * Discrete figures with no shared axis.
 *
 * A stat tile is the honest answer to "three numbers that do not share a
 * scale": no baseline, no axis, no implied ranking — just approved figures,
 * each on its own baseline rule. Chart specs route here rather than into bars
 * when the figures have nothing in common but being true.
 */
function statTile(component: RenderComponent, p: Palette, target?: ComponentTarget): ComponentVisual {
  const fromTiles = Array.isArray(component.params.tiles)
    ? (component.params.tiles as { value?: unknown; label?: unknown; note?: unknown }[])
    : [];
  const fromSeries = Array.isArray(component.params.series)
    ? (component.params.series as { value?: unknown; label?: unknown }[])
    : [];
  const rows = (fromTiles.length > 0 ? fromTiles : fromSeries).slice(0, 4);
  // A tile grid is laid out for the box it was given rather than for a fixed
  // 264x150 cell that the focal layer then had to scale.
  const cols = rows.length <= 2 ? Math.max(1, rows.length) : 2;
  const rowCount = Math.ceil(rows.length / cols);
  const gapX = 40;
  const gapY = 56;
  const totalW = target?.w ?? 0;
  const totalH = target?.h ?? 0;
  const cellW =
    target && totalW > 0 ? (totalW - (cols - 1) * gapX) / cols : 264;
  const cellH =
    target && totalH > 0
      ? (totalH - (rowCount - 1) * gapY) / rowCount
      : 150;
  const valueSize = Math.round(clamp(38, 68, cellH * 0.42));
  const labelSize = Math.round(clamp(17, 24, cellH * 0.15));
  const noteSize = Math.round(clamp(15, 20, cellH * 0.12));

  const tiles = rows
    .map((row, i) => {
      const col = i % cols;
      const r = Math.floor(i / cols);
      const x = col * (cellW + gapX);
      const y = r * (cellH + gapY);
      const value = str((row as { value?: unknown }).value, "");
      const label = str((row as { label?: unknown }).label, "");
      const note = str((row as { note?: unknown }).note, "");
      const { n, decimals, suffix } = splitValue(value, 0);
      const shown = n.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      const size = shown.length > 6 ? valueSize * 0.8 : valueSize;
      return `<g data-hf="tile-${i}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
        <line data-hf="draw" x1="0" y1="0" x2="${cellW.toFixed(1)}" y2="0" ${strokeAttrs(p.line, 1.5)}/>
        <text data-hf="count" data-count="${n}" data-decimals="${decimals}" data-suffix="${esc(suffix)}"
          x="0" y="${(cellH * 0.62).toFixed(1)}" font-size="${size.toFixed(0)}" font-weight="700" fill="${p.ink}" font-family="${TYPE.text}">${shown}${esc(
            suffix,
          )}</text>
        <text data-hf="fadeup" x="0" y="${(cellH * 0.62 + labelSize + 12).toFixed(
          1,
        )}" font-size="${labelSize}" fill="${p.inkMuted}" font-family="${TYPE.text}">${esc(label)}</text>
        ${note ? `<text data-hf="fadeup" x="0" y="${(cellH * 0.62 + labelSize + 12 + noteSize + 6).toFixed(1)}" font-size="${noteSize}" fill="${p.inkMuted}" font-family="${TYPE.text}">${esc(note)}</text>` : ""}
      </g>`;
    })
    .join("");

  return {
    weight: 3,
    extent: {
      w: target && totalW > 0 ? totalW : cols * cellW + (cols - 1) * gapX,
      h: target && totalH > 0 ? totalH : rowCount * cellH + (rowCount - 1) * gapY,
    },
    svg: `<g>${tiles}</g>`,
    motion: `${draw(0.1, 0.7, "power2.out")}
  ${countUp(0.35, 0.6)}
  ${fadeUp(0.5, 0.09)}`,
  };
}

function timelineTrack(component: RenderComponent, p: Palette): ComponentVisual {
  const events = Array.isArray(component.params.events)
    ? (component.params.events as { label?: string }[])
    : [];
  const items = events.slice(0, 4);
  const y = 120;
  const span = 520;
  return {
    weight: 3, extent: { w: 560, h: 180 },
    svg: `<g>
      <line data-hf="draw" x1="16" y1="${y}" x2="${16 + span}" y2="${y}" ${strokeAttrs(p.ink, 2)}/>
      ${items
        .map((ev, i) => {
          const x = 40 + (i * (span - 48)) / Math.max(1, items.length - 1 || 1);
          return [
            `<circle data-hf="pop" cx="${x.toFixed(1)}" cy="${y}" r="11" fill="${p.accent}"/>`,
            `<text data-hf="fadeup" x="${x.toFixed(1)}" y="${y + 48}" text-anchor="middle" font-size="19" fill="${p.inkMuted}" font-family="${TYPE.text}">${esc(str(ev.label))}</text>`,
          ].join("");
        })
        .join("")}
    </g>`,
    motion: `${draw(0.1, 0.9, "power2.out")}
  ${pop(0.6, 0.1)}
  ${fadeUp(0.75, 0.08)}`,
  };
}

function beforeAfter(component: RenderComponent, p: Palette): ComponentVisual {
  const left = str(component.params.before_label, "before");
  const right = str(component.params.after_label, "after");
  return {
    weight: 3, extent: { w: 610, h: 260 },
    svg: `<g>
      <rect data-hf="rise" x="10" y="80" width="290" height="170" rx="4" fill="${p.surface}" stroke="${p.line}" stroke-width="1.5"/>
      <rect data-hf="rise" x="330" y="80" width="290" height="170" rx="4" fill="${p.accentTint}" stroke="${p.accent}" stroke-width="1.5"/>
      <text data-hf="fadeup" x="155" y="150" text-anchor="middle" font-size="30" fill="${p.inkMuted}" font-family="${TYPE.display}">${esc(left)}</text>
      <text data-hf="fadeup" x="475" y="150" text-anchor="middle" font-size="30" fill="${p.ink}" font-family="${TYPE.display}">${esc(right)}</text>
    </g>`,
    motion: `${rise(0.2, 0.14, 0.6)}
  ${fadeUp(0.6, 0.1)}`,
  };
}

function callout(component: RenderComponent, p: Palette): ComponentVisual {
  const text = str(component.params.text, component.label);
  return {
    weight: 2, extent: { w: 600, h: 190 },
    svg: `<g>
      <rect data-hf="rise" x="20" y="70" width="580" height="110" rx="4" fill="${p.surface}" stroke="${p.line}" stroke-width="1.5"/>
      <line data-hf="draw" x1="20" y1="70" x2="20" y2="180" ${strokeAttrs(p.accent, 3)}/>
      <text data-hf="fadeup" x="48" y="132" font-size="28" fill="${p.ink}" font-family="${TYPE.display}">${esc(text)}</text>
    </g>`,
    motion: `${rise(0.1, 0, 0.5)}
  ${draw(0.3, 0.4, "power2.out")}
  ${fadeUp(0.4, 0)}`,
  };
}

// ---------------------------------------------------------------------------
// Anatomy — bezier paths with editorial strokes
// ---------------------------------------------------------------------------

function brain(p: Palette): ComponentVisual {
  return {
    weight: 4, extent: { w: 200, h: 220 },
    svg: `<g>
      <path data-hf="draw" d="M60,44 C22,44 4,82 4,118 C4,112 10,146 34,176 C44,206 78,212 100,192 C122,212 156,206 166,178 C192,148 198,146 198,118 C198,82 178,44 140,44 C120,32 80,44 60,44 Z" ${strokeAttrs(p.ink, 3)}/>
      <path data-hf="draw" d="M100,58 C96,90 104,120 100,150 C98,150 100,180 100,186" ${strokeAttrs(p.inkMuted, 2)}/>
      <path data-hf="draw" d="M36,110 C68,92 132,92 164,110" ${strokeAttrs(p.inkMuted, 2)}/>
      <path data-hf="draw" d="M44,150 C76,136 128,136 156,152" ${strokeAttrs(p.inkMuted, 2)}/>
      <g data-hf="receptors">
        <circle data-hf="pop" cx="72" cy="118" r="9" fill="${p.accent}"/>
        <circle data-hf="pop" cx="128" cy="118" r="9" fill="${p.accent}"/>
        <circle data-hf="pop" cx="100" cy="94" r="7" fill="${p.accent}" opacity="0.7"/>
      </g>
    </g>`,
    motion: `${draw(0.15, 1.4)}
  ${pop(1.0, 0.12)}`,
  };
}

function heart(p: Palette): ComponentVisual {
  return {
    weight: 3, extent: { w: 200, h: 200 },
    svg: `<g>
      <path data-hf="draw" d="M100,186 C24,124 4,86 4,50 C4,20 28,4 52,4 C76,4 92,22 100,44 C108,22 124,4 148,4 C172,4 196,20 196,50 C196,86 176,124 100,186 Z" ${strokeAttrs(p.ink, 3)}/>
      <path data-hf="draw" d="M100,60 L100,150" ${strokeAttrs(p.inkMuted, 2)}/>
      <path data-hf="draw" d="M52,50 C70,74 130,74 148,50" ${strokeAttrs(p.inkMuted, 2)}/>
      <g data-hf="beat"><circle cx="100" cy="100" r="16" fill="${p.accent}" opacity="0.35"/></g>
    </g>`,
    motion: `${draw(0.15, 1.2)}
  ${pulse("sel + ' [data-hf=beat]'", 1.0, 1.0)}`,
  };
}

function lungs(p: Palette): ComponentVisual {
  return {
    weight: 3, extent: { w: 200, h: 210 },
    svg: `<g>
      <path data-hf="draw" d="M100,16 L100,84" ${strokeAttrs(p.ink, 3)}/>
      <path data-hf="draw" d="M100,84 C64,86 32,112 30,158 C28,190 50,202 70,192 C90,182 96,142 100,112 Z" ${strokeAttrs(p.ink, 3)}/>
      <path data-hf="draw" d="M100,84 C136,86 168,112 170,158 C172,190 150,202 130,192 C110,182 104,142 100,112 Z" ${strokeAttrs(p.ink, 3)}/>
      <path data-hf="draw" d="M70,120 C60,130 56,146 56,160" ${strokeAttrs(p.inkMuted, 1.8)}/>
      <path data-hf="draw" d="M130,120 C140,130 144,146 144,160" ${strokeAttrs(p.inkMuted, 1.8)}/>
    </g>`,
    motion: draw(0.15, 1.2),
  };
}

function organ(p: Palette): ComponentVisual {
  return {
    weight: 3, extent: { w: 170, h: 200 },
    svg: `<g>
      <path data-hf="draw" d="M44,30 C112,8 158,50 148,100 C140,148 158,178 100,190 C52,198 22,170 32,130 C42,96 12,90 44,30 Z" ${strokeAttrs(p.ink, 3)}/>
      <path data-hf="draw" d="M60,70 C90,60 120,70 128,96" ${strokeAttrs(p.inkMuted, 2)}/>
    </g>`,
    motion: draw(0.15, 1.1),
  };
}

// ---------------------------------------------------------------------------
// Science — cells, molecules, particles
// ---------------------------------------------------------------------------

function cellBody(p: Palette): ComponentVisual {
  return {
    weight: 3, extent: { w: 200, h: 220 },
    svg: `<g>
      <circle data-hf="draw" cx="100" cy="110" r="96" ${strokeAttrs(p.ink, 3)}/>
      <circle data-hf="draw" cx="100" cy="110" r="54" ${strokeAttrs(p.accent, 2.5)}/>
      <circle data-hf="pop" cx="100" cy="110" r="16" fill="${p.accent}"/>
      <g data-hf="drift">
        ${[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return `<circle data-hf="drift" cx="${(100 + Math.cos(a) * 74).toFixed(1)}" cy="${(110 + Math.sin(a) * 74).toFixed(1)}" r="5" fill="${p.accent}" opacity="0"/>`;
        }).join("")}
      </g>
    </g>`,
    motion: `${draw(0.15, 1.2)}
  ${pop(0.9, 0)}
  ${seededDrift(5, 7, 26, 1.0, 2.0)}`,
  };
}

function neuron(p: Palette): ComponentVisual {
  return {
    weight: 4, extent: { w: 220, h: 220 },
    svg: `<g>
      <circle data-hf="pop" cx="100" cy="110" r="28" fill="${p.accent}" opacity="0.9"/>
      ${Array.from({ length: 6 }, (_, i) => {
        const angle = (i / 6) * Math.PI * 2;
        const x2 = 100 + Math.cos(angle) * 104;
        const y2 = 110 + Math.sin(angle) * 104;
        return `<line data-hf="draw" x1="${(100 + Math.cos(angle) * 28).toFixed(1)}" y1="${(110 + Math.sin(angle) * 28).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ${strokeAttrs(p.ink, 2)}/><circle data-hf="pop" cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="8" fill="${p.ink}"/>`;
      }).join("")}
    </g>`,
    motion: `${pop(0.1, 0)}
  ${draw(0.4, 0.9, "power2.out")}
  ${pop(1.0, 0.08)}`,
  };
}

function molecule(p: Palette): ComponentVisual {
  const bonds = 6;
  return {
    weight: 3, extent: { w: 200, h: 220 },
    svg: `<g>
      <circle data-hf="pop" cx="100" cy="110" r="32" fill="${p.accent}" opacity="0.9"/>
      ${Array.from({ length: bonds }, (_, i) => {
        const angle = (i / bonds) * Math.PI * 2;
        return `<line data-hf="draw" x1="${(100 + Math.cos(angle) * 32).toFixed(1)}" y1="${(110 + Math.sin(angle) * 32).toFixed(1)}" x2="${(100 + Math.cos(angle) * 92).toFixed(1)}" y2="${(110 + Math.sin(angle) * 92).toFixed(1)}" ${strokeAttrs(p.ink, 2)}/>`;
      }).join("")}
      ${Array.from({ length: bonds }, (_, i) => {
        const angle = (i / bonds) * Math.PI * 2;
        return `<circle data-hf="pop" cx="${(100 + Math.cos(angle) * 96).toFixed(1)}" cy="${(110 + Math.sin(angle) * 96).toFixed(1)}" r="20" fill="${p.surface}" stroke="${p.ink}" stroke-width="2"/>`;
      }).join("")}
    </g>`,
    motion: `${pop(0.1, 0)}
  ${draw(0.3, 0.8, "power2.out")}`,
  };
}

function particleFlow(p: Palette): ComponentVisual {
  // A bloodstream: a vessel path with particles travelling along it.
  return {
    weight: 3, extent: { w: 560, h: 120 },
    svg: `<g>
      <path data-hf="draw" d="M20,110 C120,60 220,160 300,110 C380,60 480,160 560,110" ${strokeAttrs(p.ink, 3)}/>
      <g data-hf="drift">
        ${[0, 1, 2, 3, 4, 5].map((i) => `<circle data-hf="drift" cx="${(60 + i * 90).toFixed(1)}" cy="${(110 + (i % 2 ? -18 : 18)).toFixed(1)}" r="7" fill="${p.accent}" opacity="0"/>`).join("")}
      </g>
    </g>`,
    motion: `${draw(0.1, 1.0)}
  ${seededDrift(6, 13, 40, 0.6, 2.4)}`,
  };
}

function dnaHelix(p: Palette): ComponentVisual {
  return {
    weight: 4, extent: { w: 200, h: 200 },
    svg: `<g>
      <path data-hf="draw" d="M30,4 C130,44 130,84 30,124 C-30,154 -30,164 30,194" ${strokeAttrs(p.accent, 3)}/>
      <path data-hf="draw" d="M110,4 C10,44 10,84 110,124 C170,154 170,164 110,194" ${strokeAttrs(p.ink, 3)}/>
      ${[30, 70, 110, 150, 190].map((y) => `<line data-hf="draw" x1="22" y1="${y}" x2="118" y2="${y}" ${strokeAttrs(p.inkMuted, 2)}/>`).join("")}
    </g>`,
    motion: `${draw(0.15, 1.4)}
  ${draw(0.6, 1.0)}`,
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const ANATOMY: Record<string, (p: Palette) => ComponentVisual> = {
  Brain: brain,
  Heart: heart,
  Lungs: lungs,
  Stomach: organ,
  Liver: organ,
  Kidney: organ,
  Pancreas: organ,
  Intestine: organ,
  Muscle: organ,
  Cell: cellBody,
  BloodCell: cellBody,
  Receptor: cellBody,
  Membrane: cellBody,
  Neuron: neuron,
};

const SCIENCE: Record<string, (p: Palette) => ComponentVisual> = {
  Molecule: molecule,
  DNAHelix: dnaHelix,
  Particle: cellBody,
  Signal: particleFlow,
  Pathway: particleFlow,
  BloodVessel: particleFlow,
  Hormone: molecule,
  Neurotransmitter: molecule,
  Nutrient: particleFlow,
  ATP: molecule,
  Enzyme: molecule,
  Glucose: molecule,
  Oxygen: particleFlow,
  Caffeine: molecule,
};

const CHARTS: Record<
  string,
  (c: RenderComponent, p: Palette, target?: ComponentTarget) => ComponentVisual
> = {
  BarChart: barChart,
  RankingBars: barChart,
  ComparisonBars: barChart,
  LineChart: lineChart,
  PercentageRing: ring,
  Counter: counter,
  // A synonym the storyboard uses for a large single figure.
  BigNumber: counter,
  StatTile: statTile,
  KeyValueList: statTile,
  TimelineTrack: timelineTrack,
  BeforeAfter: beforeAfter,
  Callout: callout,
};

/**
 * Every component name the renderer can draw.
 *
 * Exported so that tests can build a scene for each one. Motion scripts are
 * generated as source text, and a generated script with a syntax error takes the
 * whole scene's timeline down with it, so each name has to be exercised rather
 * than assumed correct.
 */
export const COMPONENT_NAMES: readonly string[] = [
  ...Object.keys(CHARTS),
  ...Object.keys(ANATOMY),
  ...Object.keys(SCIENCE),
].sort();

/**
 * Draws a component.
 *
 * Anything unrecognised still gets a real mark rather than a blank hole: a
 * drawn ring with a particle inside, which reads as an annotation rather than
 * a missing asset.
 */
export function componentFor(
  component: RenderComponent,
  p: Palette,
  target?: ComponentTarget,
): ComponentVisual {
  const chart = CHARTS[component.component];
  if (chart) return chart(component, p, target);
  const anatomy = ANATOMY[component.component];
  if (anatomy) return anatomy(p);
  const science = SCIENCE[component.component];
  if (science) return science(p);
  return {
    weight: 2,
    extent: { w: 200, h: 220 },
    svg: `<g>
      <circle data-hf="draw" cx="100" cy="110" r="86" ${strokeAttrs(p.ink, 2.5)}/>
      <circle data-hf="pop" cx="100" cy="110" r="26" fill="${p.accent}" opacity="0.85"/>
    </g>`,
    motion: `${draw(0.15, 1.0)}
  ${pop(0.8, 0)}`,
  };
}
