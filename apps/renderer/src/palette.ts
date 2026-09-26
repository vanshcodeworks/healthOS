/**
 * Art direction: premium editorial science documentary.
 *
 * Warm paper, charcoal ink, soft gray, and one restrained accent per format.
 * The palette is light on purpose — dark backgrounds with glowing text read as
 * "AI generated", while paper and ink read as print journalism. Medical red and
 * green exist only where they carry meaning, never as decoration.
 */
export interface Palette {
  /** Warm white page. */
  paper: string;
  /** Slightly deeper paper for depth and vignette. */
  paperDeep: string;
  /** Charcoal ink. */
  ink: string;
  /** Soft gray for secondary text. */
  inkMuted: string;
  /** The single restrained accent for the video. */
  accent: string;
  /** Accent at low opacity, for fills and tints. */
  accentTint: string;
  /** Hairline rules and chart grids. */
  line: string;
  /** Surface fill for annotations. */
  surface: string;
  /** Only where meaning is medical: harm. */
  danger: string;
  /** Only where meaning is medical: benefit. */
  good: string;
}

const BASE: Omit<Palette, "accent" | "accentTint"> = {
  paper: "#faf7f2",
  paperDeep: "#efe9df",
  ink: "#1c1a17",
  inkMuted: "#6f675e",
  line: "#ddd5c9",
  surface: "#f3eee6",
  danger: "#b42318",
  good: "#1a7f5a",
};

function withAccent(accent: string, tint: string): Palette {
  return { ...BASE, accent, accentTint: tint };
}

/**
 * One accent per format, chosen here so a brand change is one edit.
 *
 * Accents are restrained on purpose: burnt orange, deep teal, and oxblood are
 * print-news colours. Saturated blue and purple read as SaaS and are absent.
 */
export const PALETTES: Record<string, Palette> = {
  neutral: withAccent("#2f2a24", "#e7e0d8"),
  mechanism: withAccent("#c2410c", "#f6dfd0"),
  nutrition: withAccent("#c2410c", "#f6dfd0"),
  supplement: withAccent("#9a3412", "#f4ddd0"),
  data: withAccent("#0f766e", "#d3e6e2"),
  comparison: withAccent("#0f766e", "#d3e6e2"),
  myth: withAccent("#8f1d1d", "#f2dbdb"),
  timeline: withAccent("#7c5c10", "#efe4c8"),
  sleep: withAccent("#3f4a7a", "#dfe2ef"),
  fitness: withAccent("#9a3412", "#f4ddd0"),
  "system-journey": withAccent("#0f766e", "#d3e6e2"),
};

export function paletteFor(name: string): Palette {
  return PALETTES[name] ?? PALETTES.neutral!;
}

/** Editorial typography: serif display, sans for captions and annotation. */
export const TYPE = {
  /** Web-safe serif, deterministic across machines. */
  display: "Georgia, 'Times New Roman', 'Iowan Old Style', serif",
  /** Web-safe sans. */
  text: "'Segoe UI', 'Helvetica Neue', system-ui, sans-serif",
  /** Tabular figures for counts, so digits do not jitter as they tick. */
  mono: "'Cascadia Mono', 'Consolas', 'Menlo', monospace",
};
