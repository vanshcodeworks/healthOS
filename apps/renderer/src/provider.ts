import type { FrameProvider, RenderComponent, RenderProject, RenderScene } from "@hc/render";
import { componentFor, esc } from "./components.js";
import { paletteFor, TYPE } from "./palette.js";

/**
 * Editorial layout grammar.
 *
 * A scene has a hierarchy — one primary focal point, secondary information,
 * annotation, background — and the layout decides where each sits. The focal
 * point is the animated component and it is sized to occupy attention; the
 * headline is serif and placed, not centred by default; the caption is small
 * and stays clear of the focal point.
 */
interface Placement {
  /** Normalised y of the headline block centre. */
  headlineTop: number;
  /** Base headline size, which the fitter may walk down. */
  headlineSize: number;
  /** Fraction of the frame width the headline may occupy. */
  headlineWidth: number;
  align: "middle" | "start" | "end";
  /** Where the focal component sits: centre, or split across a grid. */
  focal: "center" | "split" | "offset-left" | "offset-right";
}

function placementFor(scene: RenderScene): Placement {
  switch (scene.layout) {
    case "type_dominant":
      return { headlineTop: 0.22, headlineSize: 74, headlineWidth: 0.82, align: "start", focal: "center" };
    case "card":
      return { headlineTop: 0.16, headlineSize: 54, headlineWidth: 0.8, align: "middle", focal: "center" };
    case "lower_third":
      return { headlineTop: 0.66, headlineSize: 52, headlineWidth: 0.8, align: "start", focal: "offset-left" };
    case "upper_third":
      return { headlineTop: 0.12, headlineSize: 52, headlineWidth: 0.8, align: "start", focal: "center" };
    case "split":
    case "mosaic":
      return { headlineTop: 0.1, headlineSize: 46, headlineWidth: 0.86, align: "start", focal: "split" };
    case "left_stack":
      return { headlineTop: 0.3, headlineSize: 50, headlineWidth: 0.42, align: "start", focal: "offset-right" };
    case "right_stack":
      return { headlineTop: 0.3, headlineSize: 50, headlineWidth: 0.42, align: "end", focal: "offset-left" };
    case "full_bleed":
      return { headlineTop: 0.68, headlineSize: 56, headlineWidth: 0.84, align: "start", focal: "center" };
    default:
      return { headlineTop: 0.18, headlineSize: 56, headlineWidth: 0.82, align: "middle", focal: "center" };
  }
}

/**
 * The headline a scene shows when the storyboard gave it no on-screen text.
 *
 * Only approved content: the hook scene falls back to the title, which *is* the
 * hook, and a CTA scene to the CTA text. A disclaimer scene stays quiet because
 * its words already appear in the footer.
 */
function headlineFor(project: RenderProject, scene: RenderScene): string {
  if (scene.headline) {
    return scene.headline;
  }
  if (scene.intent === "hook") {
    return project.title;
  }
  if (scene.intent === "cta" && project.cta.text) {
    return project.cta.text;
  }
  return "";
}

function wrapWords(text: string, maxChars: number, _maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Fits a headline into the frame.
 *
 * Characters per line derive from the font size: a 74px serif headline on a
 * 1080px frame holds about 25 characters, and a fixed budget put a whole
 * sentence on one line and ran it off the edge. The size walks down until the
 * wrapped lines fit the frame's height.
 */
function fitHeadline(
  text: string,
  width: number,
  baseSize: number,
  widthFraction: number,
): { lines: string[]; size: number } {
  let size = baseSize;
  for (;;) {
    const charsPerLine = Math.max(10, Math.floor((width * widthFraction) / (size * 0.5)));
    const lines = wrapWords(text, charsPerLine, 4);
    const fitsHeight = lines.length * size * 1.14 <= 760;
    if ((lines.length <= 3 && fitsHeight) || size <= 34) {
      return { lines: lines.slice(0, 4), size };
    }
    size -= 4;
  }
}

function captionFor(project: RenderProject, scene: RenderScene): string {
  const cue = project.captions.find(
    (c) => c.start_s < scene.end_s - 1e-6 && c.end_s > scene.start_s + 1e-6,
  );
  return cue?.text ?? "";
}

/**
 * True when the caption would repeat the headline word for word.
 *
 * On the hook scene the narration, the title and the caption are the same
 * sentence, and showing it twice in one frame reads as a mistake rather than
 * emphasis. The headline carries it and the caption stands down.
 */
function captionDuplicatesHeadline(caption: string, headline: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const c = norm(caption);
  const h = norm(headline);
  return c.length > 0 && (c === h || (h.length > 0 && (c.startsWith(h) || h.startsWith(c))));
}

/**
 * Wraps a caption across as many lines as the words need.
 *
 * The spec's line budget is a readability target, not a licence to drop spoken
 * words: a caption that quotes narration and loses its tail is content loss.
 * The font scales down to fit instead, and the validator flags an over-budget
 * caption upstream so the writer can shorten the line.
 */
function wrapCaption(text: string, maxWords: number, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars && current.split(" ").length < maxWords) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

/** Font size that fits the wrapped lines in the space above the platform UI. */
function captionFontSize(lineCount: number, height: number, baseSize: number): number {
  const usable = height * 0.14;
  const needed = lineCount * baseSize * 1.3 + 24;
  return needed > usable ? Math.max(20, Math.floor((usable - 24) / (lineCount * 1.3))) : baseSize;
}

/**
 * Builds the focal layer.
 *
 * One component is the primary focal point and is given the whole focal band;
 * several are laid out on a grid, which is what `split` and `mosaic` request.
 * A single focal point is not shrunk to a fraction of the band: a chart drawn
 * small enough to be a footnote is a chart nobody reads. Labels sit with their
 * component as annotation, never equal in weight to the headline.
 *
 * The grid is sized to the component count, so three components read as a
 * sequence of three stations rather than a two-by-two block with a hole in it.
 */
/**
 * The most an illustration is ever magnified by.
 *
 * A component authored at 200x220 into a 900x600 cell would otherwise be scaled
 * 2.7x, which fattens its strokes, blurs its type and breaks the "editorial,
 * drawn, not scaled-up pixel art" look. Charts are unaffected: they are drawn
 * for the cell they are given, so their fit scale is 1.
 */
const MAX_ILLUSTRATION_SCALE = 1.6;

interface FocalCell {
  component: RenderComponent;
  index: number;
  cx: number;
  cy: number;
  cellW: number;
  cellH: number;
}

/**
 * The cell each focal component is drawn into.
 *
 * Both the markup and the motion script have to agree on this: a chart drawn
 * for a 302px cell is a different drawing from the same chart drawn for 907px,
 * so the geometry is computed once here rather than twice, in two places, with
 * a hope they match.
 */
function focalCells(
  scene: RenderScene,
  width: number,
  height: number,
  placement: Placement,
): FocalCell[] {
  const slots = scene.components.slice(0, 4);
  if (slots.length === 0) return [];
  const cols = slots.length <= 2 ? slots.length : slots.length === 3 ? 3 : 2;
  const rows = Math.ceil(slots.length / cols);
  const cellW = (width * 0.84) / cols;
  const bandTop = height * 0.34;
  const bandH = height * 0.32;
  const cellH = bandH / rows;
  return slots.map((component, index) => {
    let cx: number;
    let cy: number;
    if (cols === 1) {
      // The focal point sits in the upper-middle of the frame, above the
      // caption and clear of platform UI.
      cx = width / 2;
      cy = height * 0.44;
      if (placement.focal === "offset-left") {
        cx = width * 0.32;
        cy = height * 0.4;
      } else if (placement.focal === "offset-right") {
        cx = width * 0.68;
        cy = height * 0.4;
      }
    } else {
      const col = index % cols;
      const row = Math.floor(index / cols);
      cx = width * 0.08 + cellW * (col + 0.5);
      cy = bandTop + cellH * (row + 0.5);
    }
    return { component, index, cx, cy, cellW, cellH };
  });
}

function focalLayer(project: RenderProject, scene: RenderScene, width: number, height: number, placement: Placement): string {
  const p = paletteFor(project.palette_id);
  return focalCells(scene, width, height, placement)
    .map((cell) => {
      const { component, index, cx, cy, cellW, cellH } = cell;
      const visual = componentFor(component, p, { w: cellW, h: cellH });
      // Scaling against the drawing's real extents, and translating by half of
      // those extents, not a nominal box: a box three times wider than the
      // organ made every focal point float small and off to one side. A chart
      // drawn for this cell comes back at scale 1, and an illustration is never
      // magnified past 1.6x, which would turn a 2.5px stroke into a 4px one.
      const fit = Math.min(cellW / visual.extent.w, cellH / visual.extent.h);
      const requested = component.position.scale || 1;
      const scale = Math.min(fit, MAX_ILLUSTRATION_SCALE) * requested;
      const rotate = component.position.rotate || 0;
      const labelY = visual.extent.h / 2 + 46;
      const label = component.label
        ? `<text x="0" y="${labelY.toFixed(0)}" text-anchor="middle" font-size="22" font-weight="600" fill="${p.inkMuted}" font-family="${TYPE.text}" letter-spacing="0.06em">${esc(
            component.label,
          )}</text>`
        : "";
      return `<g data-hf="comp-${index}" transform="translate(${cx.toFixed(1)},${cy.toFixed(
        1,
      )}) rotate(${rotate}) scale(${scale.toFixed(3)}) translate(${(-visual.extent.w / 2).toFixed(
        1,
      )},${(-visual.extent.h / 2).toFixed(1)})">${visual.svg}${label}</g>`;
    })
    .join("");
}

/**
 * The footer carries the full legal wording on the closing shot.
 *
 * It is set small in muted ink and never abbreviated to fit: truncating a
 * disclaimer is the same as omitting it. It sits outside the camera-push layer
 * and clear of the platform UI, because legal text that a transition can push
 * off the bottom of the frame is legal text that can be lost.
 */
function footer(project: RenderProject, scene: RenderScene): string {
  const isLast = scene.index === project.scenes.length - 1;
  if (!isLast || !project.disclaimer) {
    return "";
  }
  return `<div class="footer">${esc(project.disclaimer)}</div>`;
}

export class HtmlFrameProvider implements FrameProvider {
  readonly id = "editorial_html";
  readonly version = "2.0.0";

  html(project: RenderProject, scene: RenderScene): string {
    const p = paletteFor(project.palette_id);
    const { width, height } = project.video;
    const placement = placementFor(scene);
    const caption = captionFor(project, scene);
    const captionLines = wrapCaption(
      caption,
      project.caption_style.max_words_per_line,
      project.caption_style.max_chars_per_line,
    );
    const captionTop = project.caption_style.y * height;
    const captionSize = captionFontSize(captionLines.length, height, Math.round(height / 56));

    // Without a component the headline is the focal point, so it is given the
    // extra weight rather than leaving the frame with nothing to look at.
    const focalBoost = scene.components.length === 0 ? 1.28 : 1;
    const fitted = fitHeadline(
      headlineFor(project, scene),
      width,
      placement.headlineSize * focalBoost,
      placement.headlineWidth,
    );
    // The anchor depends on the alignment: a centred headline is centred on the
    // frame, which is not the left margin. Anchoring "middle" at the left
    // margin put half the headline off-screen.
    const headlineX =
      placement.align === "end" ? width * 0.92 : placement.align === "start" ? width * 0.08 : width / 2;
    const headline = fitted.lines.length
      ? `<text x="${headlineX.toFixed(0)}" y="${(placement.headlineTop * height).toFixed(
          0,
        )}" text-anchor="${placement.align}" font-size="${fitted.size}" fill="${p.ink}" font-family="${TYPE.display}" data-hf="headline">${fitted.lines
          .map((line, i) => {
            const dy = i === 0 ? 0 : fitted.size * 1.14;
            return `<tspan x="${headlineX.toFixed(0)}" dy="${dy.toFixed(0)}">${esc(line)}</tspan>`;
          })
          .join("")}</text>`
      : "";

    // A hairline rule under the headline is the editorial device that separates
    // the secondary information from the focal point. It sits below the last
    // line's baseline, not at the block's centre, which struck through the
    // final line whenever the headline wrapped.
    const lastBaseline = placement.headlineTop * height + (fitted.lines.length - 1) * fitted.size * 1.14;
    const ruleY = lastBaseline + fitted.size * 0.5 + 18;
    const rule =
      fitted.lines.length && scene.layout !== "full_bleed"
        ? `<line data-hf="rule" x1="${headlineX.toFixed(0)}" y1="${ruleY.toFixed(0)}" x2="${(
            headlineX +
            width * placement.headlineWidth * (placement.align === "middle" ? 0.5 : 1)
          ).toFixed(0)}" y2="${ruleY.toFixed(0)}" stroke="${p.accent}" stroke-width="2"/>`
        : "";

    const subtextLines = scene.subtext
      ? wrapWords(scene.subtext, Math.floor(width * 0.8 / 22), 2)
      : [];
    const subtext = subtextLines.length
      ? `<text x="${(width / 2).toFixed(0)}" y="${(ruleY + 52).toFixed(0)}" text-anchor="middle" font-size="26" fill="${p.inkMuted}" font-family="${TYPE.text}" data-hf="subtext">${subtextLines
          .map((line, i) => {
            const dy = i === 0 ? 0 : 32;
            return `<tspan x="${(width / 2).toFixed(0)}" dy="${dy.toFixed(0)}">${esc(line)}</tspan>`;
          })
          .join("")}</text>`
      : "";

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(project.title)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${width}px;height:${height}px;overflow:hidden}
  body{background:
    radial-gradient(140% 100% at 50% 0%, ${p.paper} 0%, ${p.paper} 55%, ${p.paperDeep} 100%);
    font-family:${TYPE.text};color:${p.ink};-webkit-font-smoothing:antialiased}
  .stage{position:absolute;inset:0;transform-origin:50% 42%}
  .caption{position:absolute;left:8%;width:84%;text-align:center;top:${captionTop.toFixed(0)}px;
    transform:translateY(-50%)}
  .caption span{display:inline-block;font-size:${captionSize}px;line-height:1.3;font-weight:500;
    color:${p.ink};letter-spacing:0.01em}
  .footer{position:absolute;left:10%;width:80%;text-align:center;bottom:104px;
    font-size:19px;line-height:1.55;color:${p.inkMuted};font-weight:400}
</style></head>
<body>
  <div class="stage">
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${headline}
      ${rule}
      ${subtext}
      ${focalLayer(project, scene, width, height, placement)}
    </svg>
    ${
      captionLines.length > 0 && !captionDuplicatesHeadline(caption, fitted.lines.join(" "))
        ? `<div class="caption"><span data-hf="caption">${captionLines
            .map((line) => esc(line))
            .join("<br/>")}</span></div>`
        : ""
    }
  </div>
  ${footer(project, scene)}
</body></html>`;
  }

  /**
   * The scene's motion, evaluated after GSAP is loaded.
   *
   * Entrance, hold and exit are all here rather than in the markup, so a page
   * never animates before the timeline exists and a frame can be sought
   * deterministically instead of hoping a clock agrees.
   */
  bootScript(project: RenderProject, scene: RenderScene): string {
    const duration = Math.max(0.5, scene.duration_s);
    const p = paletteFor(project.palette_id);
    const componentMotion = focalCells(
      scene,
      project.video.width,
      project.video.height,
      placementFor(scene),
    )
      .map((cell) => {
        // The same target the markup was built with, so the motion animates the
        // drawing that is actually on screen.
        const visual = componentFor(cell.component, p, { w: cell.cellW, h: cell.cellH });
        if (!visual.motion) return "";
        return `(function () {
  const sel = '[data-hf="comp-${cell.index}"]';
  ${visual.motion}
})();`;
      })
      .filter(Boolean)
      .join("\n");

    // A scene with no components has no focal point, so the headline is
    // promoted to one: kinetic typography, word by word, rather than a whole
    // sentence fading in as a block.
    //
    // Type holds from the first frame. A `from` tween renders its start state
    // eagerly, so an opaque fade left the opening frame of every shot as blank
    // paper; `immediateRender: false` lets the type sit there while the
    // illustration builds around it, which is how the shot is meant to open.
    const hasComponents = scene.components.length > 0;
    const headlineMotion = hasComponents
      ? `tl.from('[data-hf="headline"]', { y: 22, opacity: 0, duration: 0.7, ease: 'power2.out', immediateRender: false }, 0.05);`
      : `(() => {
  const words = gsap.utils.toArray('[data-hf="headline"] tspan');
  words.forEach((word, i) => {
    tl.from(word, { y: 30, opacity: 0, duration: 0.6, ease: 'power3.out', immediateRender: false }, 0.1 + i * 0.14);
  });
})();`;

    return `
window.__hfTimeline = gsap.timeline({ paused: true });
(function () {
  const tl = window.__hfTimeline;
  const d = ${duration.toFixed(3)};

  // Camera push: slow, continuous, the one cinematic move every shot gets.
  tl.fromTo('.stage', { scale: 1 }, { scale: 1.045, duration: d, ease: 'none' }, 0);

  // Secondary information enters before the focal point settles.
  ${headlineMotion}
  tl.from('[data-hf="rule"]', { scaleX: 0, transformOrigin: '0 50%', duration: 0.5, ease: 'power2.out' }, 0.3);
  tl.from('[data-hf="subtext"]', { y: 12, opacity: 0, duration: 0.5, ease: 'power2.out', immediateRender: false }, 0.45);

  ${componentMotion}

  // The caption arrives once the shot has established, and leaves with it.
  tl.from('[data-hf="caption"]', { y: 16, opacity: 0, duration: 0.45, ease: 'power2.out', immediateRender: false }, 0.55);

  window.__hfDuration = d;
})();`;
  }
}
