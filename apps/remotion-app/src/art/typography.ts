/**
 * Typography.
 *
 * Three families, three jobs, and no fourth:
 *
 * - `display` is a display serif at editorial sizes. It carries the claim.
 * - `text` is a neutral sans at small sizes for labels, captions, units.
 * - `mono` is tabular for figures, so digits do not reflow while counting.
 *
 * All three are loaded from Google Fonts by `art/fonts`, which is imported here
 * and so is imported by everything that renders: the loader holds the render
 * until the font is ready, and serves the same file on every machine, so a frame
 * is the same in the Player, on a CI box, and on a machine that has never seen
 * the project. The eyebrow uses the grotesque rather than the text sans, because
 * a wide-tracking kicker wants a technical face and not a form label.
 *
 * Sizes are expressed in px at 1080x1920. The composition scales the whole stage
 * for other resolutions, so a size never needs to be recomputed.
 */

import { FONTS } from "./fonts.js";
import type { FontMetricKey } from "./font-metrics.js";

export { FONTS };

/**
 * Editorial type scale at 1080x1920, 30fps.
 *
 * Every `fontWeight` here is a weight `art/fonts.ts` actually loads. That is not
 * tidiness: CSS matches an unavailable weight to the nearest available one, so a
 * scale that asked for Fraunces 400 against a family shipping 500/600/700
 * rendered at 500 while the fitter measured whichever weight it had assumed, and
 * the two drifted apart by however wide the glyphs actually are. The weights below
 * are the loadable set, and `art/measure.ts` is given the same one.
 *
 * Leading is a separate decision from size. `headline` was set at 1.06 and then
 * pulled together again by a negative margin in `components/EditorialText`, for an
 * effective advance of about 0.76em: tight enough that consecutive lines in a
 * display serif collide, and the first thing a reader sees is that the type is
 * badly set. Display leading here is 1.14, with the reveal mask overlapping by
 * less than the half-leading, which is the most the mask needs to hide its own
 * seam.
 */
export const TYPE = {
  /** Eyebrow: small caps grotesque, wide tracking, sits above a headline. */
  eyebrow: { fontFamily: FONTS.eyebrow, fontSize: 26, fontWeight: 700, letterSpacing: 4.2 },
  /** The claim. Serif, tight leading, optically centred on the text block. */
  headline: { fontFamily: FONTS.display, fontSize: 96, fontWeight: 500, lineHeight: 1.14, letterSpacing: -1.4 },
  headlineSmall: { fontFamily: FONTS.display, fontSize: 66, fontWeight: 500, lineHeight: 1.16, letterSpacing: -0.8 },
  /** A sentence under a headline, when it earns the room. */
  deck: { fontFamily: FONTS.text, fontSize: 38, fontWeight: 400, lineHeight: 1.42, letterSpacing: 0.2 },
  /** Scientific label: bracketed callout attached to a diagram. */
  label: { fontFamily: FONTS.text, fontSize: 27, fontWeight: 600, letterSpacing: 1.1 },
  /** Annotation: the smallest type in the system, and it is still legible. */
  annotation: { fontFamily: FONTS.text, fontSize: 24, fontWeight: 400, letterSpacing: 0.3 },
  /** Units, axis ticks, denominators. */
  unit: { fontFamily: FONTS.text, fontSize: 24, fontWeight: 500, letterSpacing: 1.6 },
  /** A statistic. Serif, because it is a claim. */
  stat: { fontFamily: FONTS.display, fontSize: 240, fontWeight: 500, letterSpacing: -6 },
  statSmall: { fontFamily: FONTS.display, fontSize: 132, fontWeight: 500, letterSpacing: -2 },
  /** Tabular figures for counters and axes. */
  figure: { fontFamily: FONTS.mono, fontSize: 30, fontWeight: 500, letterSpacing: -0.4 },
  /** Captions. */
  caption: { fontFamily: FONTS.text, fontSize: 44, fontWeight: 500, letterSpacing: 0.4 },
  /** Legal text on the end card. */
  disclaimer: { fontFamily: FONTS.text, fontSize: 25, fontWeight: 400, lineHeight: 1.5, letterSpacing: 0.2 },
  /** Source line. */
  source: { fontFamily: FONTS.mono, fontSize: 20, fontWeight: 400, letterSpacing: 0.6 },
  /** A spoken word set large. Only for a single deliberate word. */
  spoken: { fontFamily: FONTS.display, fontSize: 128, fontWeight: 500, letterSpacing: -1 },
} as const;

/**
 * The measured family and weight behind each role, for `art/measure.ts`.
 *
 * Kept next to the scale rather than repeated at every call site, because a
 * fitter that measures one family while the renderer paints another is the defect
 * this table exists to make impossible.
 *
 * Derived from `TYPE` rather than written out, for the same reason. These were
 * literals once, and a literal is a second copy of the answer: changing
 * `TYPE.headline.fontWeight` left `display.weight` at 500 and the two drifted
 * apart silently, which is the identical failure with an extra step. Reading the
 * scale means the measure and the paint cannot disagree about a weight, because
 * there is only one weight to disagree with.
 */
export const TYPE_MEASURE = {
  display: { font: "display", weight: TYPE.headline.fontWeight, letterSpacing: TYPE.headline.letterSpacing },
  displayTight: { font: "display", weight: TYPE.headlineSmall.fontWeight, letterSpacing: TYPE.headlineSmall.letterSpacing },
  eyebrow: { font: "eyebrow", weight: TYPE.eyebrow.fontWeight, letterSpacing: TYPE.eyebrow.letterSpacing },
  text: { font: "text", weight: TYPE.deck.fontWeight, letterSpacing: TYPE.deck.letterSpacing },
  textStrong: { font: "text", weight: TYPE.caption.fontWeight, letterSpacing: TYPE.caption.letterSpacing },
  mono: { font: "mono", weight: TYPE.figure.fontWeight, letterSpacing: TYPE.figure.letterSpacing },
} as const satisfies Record<string, { font: FontMetricKey; weight: number; letterSpacing: number }>;


export type TypeRole = keyof typeof TYPE;
