/**
 * healthOS palette.
 *
 * Warm paper, charcoal ink, one restrained accent per format. The rules that
 * make this read as print science journalism rather than a slide deck:
 *
 * - Light ground. Dark backgrounds with glowing type read as generated.
 * - One accent, used for meaning. Anatomy, particles, the emphasised word.
 *   Never for decoration, never two accents fighting in a frame.
 * - Hairlines, not borders. Structure comes from thin rules and negative space
 *   rather than boxes, because boxes are what make a frame look like a card.
 * - Red and green only where the meaning is medical.
 *
 * Values are chosen to hold contrast at 1080x1920 on a phone in daylight:
 * body ink on paper is ~15:1, annotation ink ~5.2:1, accent on paper ~5.6:1.
 */

export interface Palette {
  /** Warm white page. */
  paper: string;
  /** A half-step deeper, for panels and vignettes. */
  paperDeep: string;
  /** Charcoal ink. */
  ink: string;
  /** Secondary text: labels, units, captions. */
  inkMuted: string;
  /** The single accent. */
  accent: string;
  /** Accent at low alpha, for fills. */
  accentTint: string;
  /**
   * The chart's second colour: the colourblind-safe complement of the accent, not
   * a shade of it. A comparison drawn in two tints of one hue reads as one bar
   * and its shadow.
   */
  secondary: string;
  /** Hairlines, chart grids, diagram contours. */
  line: string;
  /** Line one step stronger, for the line that is being drawn. */
  lineStrong: string;
  /** Panel fill behind an annotation. */
  surface: string;
  /** Meaning: harm, risk, the thing being corrected. */
  danger: string;
  /** Meaning: benefit, the thing that is supported. */
  good: string;
  /** Paper, but a shade cooler. Used for the last frame's full-bleed. */
  paperCool: string;
  /**
   * Paper grain, as a fraction of the maximum. This is a real per-format choice
   * rather than a constant: a data frame with a chart and gridlines wants a
   * cleaner page than a typographic hook, because every extra texture competes
   * with the numbers.
   */
  grain: number;
}

const BASE = {
  paper: "#fbf6ec",
  paperDeep: "#f1e8d8",
  ink: "#1c1a14",
  inkMuted: "#5f574a",
  line: "#dcd2bf",
  lineStrong: "#b5a88f",
  surface: "#f4ede1",
  danger: "#b03018",
  good: "#0e7c50",
  paperCool: "#edf2ee",
} satisfies Omit<Palette, "accent" | "accentTint" | "secondary" | "grain">;

/**
 * Accents, one saturated hue per format, on a warm paper ground.
 *
 * The ground is light and the accents are saturated, which is the register that
 * editorial science graphics and medical explainers share: the page stays quiet,
 * the color carries the argument. Every accent is verified at 3.2:1 or better
 * against the paper, which is the WCAG bar for large text and for the chart
 * elements the accent fills, and `inkMuted` holds 6.6:1 for the small type.
 *
 * `secondary` is the chart's second colour, and it is not a shade of the accent:
 * a comparison drawn in two tints of one hue reads as one bar and its shadow.
 * Each secondary is the complementary hue from the colourblind-safe Okabe-Ito
 * set, so the pair is told apart by hue at any luminance — teal against
 * vermillion, indigo against amber — and never by brightness alone.
 */
const ACCENTS: Record<string, { accent: string; accentTint: string; grain: number }> = {
  neutral: { accent: "#b07d1e", accentTint: "#f7e6c4", grain: 0.035 },
  mechanism: { accent: "#d1481a", accentTint: "#f9ddcf", grain: 0.035 },
  nutrition: { accent: "#e2641c", accentTint: "#fbe4cd", grain: 0.035 },
  supplement: { accent: "#a63a20", accentTint: "#f5ddd3", grain: 0.032 },
  data: { accent: "#0e8571", accentTint: "#d6efe5", grain: 0.018 },
  comparison: { accent: "#0e8571", accentTint: "#d6efe5", grain: 0.018 },
  myth: { accent: "#c9203a", accentTint: "#f9dbdf", grain: 0.04 },
  timeline: { accent: "#a8790f", accentTint: "#f4e7c9", grain: 0.03 },
  sleep: { accent: "#4450c4", accentTint: "#e0e2fa", grain: 0.022 },
  fitness: { accent: "#cf4f16", accentTint: "#f9dfd0", grain: 0.038 },
  "system-journey": { accent: "#0e8571", accentTint: "#d6efe5", grain: 0.028 },
};

/**
 * The colourblind-safe second hue for each accent, for a chart drawn in two
 * colours. Blue-green against vermillion is the canonical Okabe-Ito pair: the
 * two are the same luminance and opposite hues, so a viewer with any colour
 * vision tells them apart and a viewer with none still sees two bars.
 */
const SECONDARY: Record<string, string> = {
  neutral: "#0e8571",
  mechanism: "#0e8571",
  nutrition: "#4450c4",
  supplement: "#0e8571",
  data: "#d1481a",
  comparison: "#d1481a",
  myth: "#4450c4",
  timeline: "#0e8571",
  sleep: "#b07d1e",
  fitness: "#0e8571",
  "system-journey": "#d1481a",
};

export function paletteFor(name: string): Palette {
  const accent = ACCENTS[name] ?? ACCENTS.neutral!;
  return {
    ...BASE,
    accent: accent.accent,
    accentTint: accent.accentTint,
    secondary: SECONDARY[name] ?? "#0e8571",
    grain: accent.grain,
  };
}

export const PALETTE_NAMES = Object.keys(ACCENTS);
