/**
 * Calibrate the text measure against the fonts that actually render.
 *
 * `art/measure.ts` fits type without a DOM, so its widths have to come from
 * somewhere real. A hand-written table of per-character factors is a guess, and
 * this repository already has the receipt for why a guess fails: a caption laid
 * out to a table that under-counted Inter painted 1019px of text into a 948px
 * column and ran off both sides of a published frame.
 *
 * So the table is measured, not guessed. This script loads the exact families and
 * weights `art/fonts.ts` asks for, in the exact engine that renders the video,
 * and records each character's real advance width in em. The result is committed
 * as `src/art/font-metrics.ts`, so a render never needs the network and a build
 * never needs this script. Re-run it when a family, a weight or a subset changes:
 *
 *     node scripts/calibrate-font-metrics.mjs
 *
 * The measurement is deliberately taken in a browser rather than by parsing the
 * font binary. Parsing would mean implementing the woff2 glyf transform and
 * Brotli, and it would still be a *prediction* of the engine's shaping; asking
 * the engine is the only measurement that cannot disagree with the render.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Must match `art/fonts.ts` exactly. A drift here is a silent layout change. */
const FAMILIES = [
  { key: "display", family: "Fraunces", weights: [500, 600, 700] },
  { key: "eyebrow", family: "Space Grotesk", weights: [500, 700] },
  { key: "text", family: "Inter", weights: [400, 500, 600, 700] },
  { key: "mono", family: "IBM Plex Mono", weights: [400, 500, 600] },
];

/**
 * The size the advances are measured at, in px. Advances are near-linear in
 * font size, so the em-relative width is size-independent except where a
 * variable font's optical-size axis changes glyph proportions — Fraunces has
 * one, so it is measured at the size it is actually set at for a headline.
 */
const MEASURE_AT = 100;

const OUT = resolve("apps/remotion-app/src/art/font-metrics.ts");

/** Printable ASCII plus the punctuation the corpus actually contains. */
const CHARSET = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("") + "—–’‘“” °±×→·%";

const browser = await chromium.launch();
const page = await browser.newPage();

// One stylesheet per family, so each family's own @font-face rules apply
// independently and `document.fonts.ready` then covers all of them. A single
// combined request cannot express per-family weight lists, and waiting on one
// stylesheet would leave the other families measured against a fallback face.
await page.setContent(
  `<!doctype html><html><head>${FAMILIES.map(
    (f) =>
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family)}:wght@${f.weights.join(
        ";",
      )}&display=block">`,
  ).join("")}<style>body{margin:0}</style></head><body></body></html>`,
);
await page.evaluate(() => document.fonts.ready);

const result = await page.evaluate(
  async ({ families, charset, measureAt }) => {
    const out = {};
    for (const spec of families) {
      // Every requested weight is loaded and awaited. Measuring at weight 400
      // and rendering at 700 is how a measure ends up lying by 6%.
      for (const weight of spec.weights) {
        await document.fonts.load(`${weight} ${measureAt}px "${spec.family}"`, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
      }
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      // Per-weight tables, because a weight is not a horizontal scale of another.
      const byWeight = {};
      for (const weight of spec.weights) {
        ctx.font = `${weight} ${measureAt}px "${spec.family}"`;
        const advances = {};
        for (const ch of charset) {
          // measureText on a lone glyph is the advance, kerning excluded, which is
          // what a per-character table can represent.
          advances[ch] = ctx.measureText(ch).width / measureAt;
        }
        byWeight[weight] = advances;
      }
      out[spec.key] = { family: spec.family, weights: byWeight };
    }
    return out;
  },
  { families: FAMILIES, charset: CHARSET, measureAt: MEASURE_AT },
);

await browser.close();

/** Rounded to 4dp: far finer than a 1px layout decision at any size used here. */
const round = (n) => Number(n.toFixed(4));

const lines = [];
lines.push("/**");
lines.push(" * Measured type metrics. Generated file — do not edit by hand.");
lines.push(" *");
lines.push(" * Regenerate with `node scripts/calibrate-font-metrics.mjs` after changing a");
lines.push(" * family, a weight or a subset in `art/fonts.ts`.");
lines.push(" *");
lines.push(" * Each number is the glyph's advance width in em, taken from the same browser");
lines.push(" * engine that renders the video, with that family at that weight loaded. This is");
lines.push(" * what `art/measure.ts` fits type against, so a line that fits here fits on the");
lines.push(" * frame. The widths are rounded to four decimals because a quarter of a percent");
lines.push(" * of a 118px headline is half a pixel and the fitter already rounds sizes to 1px.");
lines.push(" */");
lines.push("");
lines.push("export interface FontMetrics {");
lines.push("  /** The family these advances came from, for the record. */");
lines.push("  family: string;");
lines.push("  /** Advance widths in em, keyed by weight then by character. */");
lines.push("  weights: Record<string, Record<string, number>>;");
lines.push("}");
lines.push("");
lines.push("export type FontMetricKey = \"display\" | \"eyebrow\" | \"text\" | \"mono\";");
lines.push("");
lines.push("export const FONT_METRICS: Record<FontMetricKey, FontMetrics> = {");
for (const spec of FAMILIES) {
  const metrics = result[spec.key];
  lines.push(`  ${spec.key}: {`);
  lines.push(`    family: ${JSON.stringify(metrics.family)},`);
  lines.push("    weights: {");
  for (const weight of spec.weights) {
    const advances = metrics.weights[weight];
    const entries = Object.entries(advances)
      .map(([ch, w]) => `${JSON.stringify(ch)}: ${round(w)}`)
      .join(", ");
    lines.push(`      ${weight}: { ${entries} },`);
  }
  lines.push("    },");
  lines.push("  },");
}
lines.push("};");
lines.push("");
lines.push("/**");
lines.push(" * Advance width of `text` in em, at `weight`, in the family behind `key`.");
lines.push(" *");
lines.push(" * An unknown character falls back to `defaultAdvance` for its class rather than");
lines.push(" * to zero: a missing glyph is a real width in the render, and a table that");
lines.push(" * returns 0 for it is a table that will happily overflow a column.");
lines.push(" */");
lines.push("export function advanceEm(key: FontMetricKey, weight: number, text: string): number {");
lines.push("  const metrics = FONT_METRICS[key];");
lines.push("  const byWeight = metrics.weights[String(weight)] ?? metrics.weights[Object.keys(metrics.weights)[0]!]!;");
lines.push("  let total = 0;");
lines.push("  for (const ch of text) total += byWeight[ch] ?? byWeight[\"n\"] ?? 0.6;");
lines.push("  return total;");
lines.push("}");
lines.push("");
lines.push("/** The character measured when nothing else is. Used only as a last resort. */");
lines.push("export const DEFAULT_ADVANCE_EM = 0.6;");
lines.push("");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");

// A report the calibration itself can fail on. A family whose advances are all
// identical loaded a fallback face, and a fallback face is a silent layout change
// that only shows up as text running off a frame.
let suspicious = 0;
for (const spec of FAMILIES) {
  const metrics = result[spec.key];
  for (const weight of spec.weights) {
    const values = Object.values(metrics.weights[weight]);
    const spread = Math.max(...values) - Math.min(...values);
    if (spread < 0.05) {
      console.error(`  ${spec.family} ${weight}: advances barely vary (${spread.toFixed(3)} em) — the real face did not load`);
      suspicious++;
    }
  }
}
console.log(`wrote ${OUT}`);
// One line per family *per weight*. This printed the first weight's numbers beside
// a list of all of them, which reads as though those were the family's advances:
// Inter's line showed `space=0.28125` next to the weights `400,500,600,700`, and
// 0.28125 is Inter 400's space — Inter 500, the weight the caption band is set in,
// is 0.2666. Anyone reading that report and writing a test against it gets a
// number for the wrong weight, and the mistake is invisible because both numbers
// are real.
for (const spec of FAMILIES) {
  for (const weight of spec.weights) {
    const sample = result[spec.key].weights[weight];
    console.log(
      `  ${spec.family.padEnd(16)} ${String(weight).padEnd(5)} n=${sample["n"]} m=${sample["m"]} W=${sample["W"]} space=${sample[" "]}`,
    );
  }
}
if (suspicious > 0) process.exit(1);
