/**
 * Fonts, loaded from Google Fonts.
 *
 * Four families, four jobs, and no fifth:
 *
 * - `display` is Fraunces, a display serif with an optical-size axis and real
 *   character at headline size. It carries the claim.
 * - `eyebrow` is Space Grotesk, a technical grotesque that holds a wide-tracking
 *   uppercase kicker without looking like a form label.
 * - `text` is Inter, the neutral sans that stays readable at caption size, where
 *   readability is the one thing the type has to win.
 * - `mono` is IBM Plex Mono, tabular for figures, so digits do not reflow while
 *   counting.
 *
 * Google Fonts rather than system faces, and that is a deliberate change of the
 * earlier constraint rather than a shortcut: `@remotion/google-fonts` fetches the
 * file, holds the render until it is ready, and serves the same file on every
 * machine, which is what actually guarantees that the same frame renders
 * identically in the Player, on a CI box, and on a machine that has never seen
 * the project. System faces differ between a Windows box and a Mac, so "web-safe"
 * was never the guarantee the pipeline needed — a fixed, blocking, hashed font is.
 *
 * Only the weights and subsets that are used are loaded, so the bundle carries
 * the font and not the type foundry.
 */

import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadPlexMono } from "@remotion/google-fonts/IBMPlexMono";

const { fontFamily: display } = loadFraunces("normal", {
  weights: ["500", "600", "700"],
  subsets: ["latin"],
});

const { fontFamily: eyebrow } = loadSpaceGrotesk("normal", {
  weights: ["500", "700"],
  subsets: ["latin"],
});

const { fontFamily: text } = loadInter("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const { fontFamily: mono } = loadPlexMono("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
});

export const FONTS = { display, eyebrow, text, mono } as const;
