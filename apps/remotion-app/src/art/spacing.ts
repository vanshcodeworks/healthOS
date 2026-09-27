/**
 * Layout geometry for 1080x1920.
 *
 * A vertical video is not a poster. Platform chrome eats the top and the bottom
 * of the frame, and the phone is held at arm's length, so the composition is
 * built around a safe area and the interesting space is spent in the middle
 * third where nothing covers it.
 *
 * The bands are not symmetric on purpose. The bottom band is deep because a
 * caption, a platform handle and a progress bar all land there; the top band is
 * shallow because only a status bar and a channel name do.
 */

/**
 * 30fps is a choice, not a default: it divides evenly into 24 and into 60, so a
 * retimed or re-encoded copy never lands on a half-frame, and it is what the
 * timing package measures and reports against.
 */
export const FRAME = { width: 1080, height: 1920, fps: 30 } as const;

export const SAFE = {
  /** 6% in from each side: a thumb does not occlude the edge, but neither is text lost. */
  side: 66,
  /** Shallow: status bar, channel. */
  top: 150,
  /** Deep: caption band, platform handle, progress bar. */
  bottom: 420,
} as const;

export const CONTENT = {
  left: SAFE.side,
  right: FRAME.width - SAFE.side,
  width: FRAME.width - SAFE.side * 2,
  top: SAFE.top,
  bottom: FRAME.height - SAFE.bottom,
  height: FRAME.height - SAFE.top - SAFE.bottom,
  get centreX() {
    return FRAME.width / 2;
  },
} as const;

/** A 12-column grid, because editorial layouts want a column to sit on. */
export const GRID = {
  columns: 12,
  gutter: 24,
  get columnWidth() {
    return (CONTENT.width - GRID.gutter * (GRID.columns - 1)) / GRID.columns;
  },
  /** Left edge of column `i`, 0-indexed. */
  x(i: number): number {
    return CONTENT.left + i * (GRID.columnWidth + GRID.gutter);
  },
  /** Width of `n` columns including their gutters. */
  span(n: number): number {
    return n * GRID.columnWidth + (n - 1) * GRID.gutter;
  },
} as const;

/** Rhythm. Every vertical gap in the system is one of these. */
export const SPACE = {
  xs: 8,
  sm: 16,
  md: 28,
  lg: 48,
  xl: 84,
  xxl: 140,
  huge: 220,
} as const;

export const HAIRLINE = 1.6;

/**
 * Where the caption band sits.
 *
 * `y` in the storyboard is a normalised centre. It is clamped into the safe area
 * so a storyboard cannot place a caption where the platform's own UI will cover
 * it, which would otherwise be a QA finding discovered after the render.
 *
 * `blockH` is the height of the whole caption block, and it is not optional in
 * spirit: a caption is a block of lines, not a line, and a centre clamped without
 * regard to the block puts the bottom of a tall block past the frame edge. Pass it
 * and the clamp is on the block. Omit it only when you want the bare centre, which
 * is what QA uses to locate the band.
 *
 * Three requirements pull against each other, and the order matters:
 *
 * 1. **The block is on the frame.** Absolute. A caption whose last line is cut off
 *    by the bottom of the video is a defect in the deliverable, not a style choice.
 * 2. **The block is clear of the platform's own furniture** — the handle and the
 *    progress bar at the bottom. The last 220px are treated as not ours.
 * 3. **The storyboard's position is honoured.** Where it can be, exactly.
 *
 * Earlier this function also refused to let the block start above `CONTENT.bottom`,
 * on the grounds that a caption overlapping a scene's subtext is two sentences on
 * top of each other. That rule is not in the list above because it cannot coexist
 * with the first: the band from `CONTENT.bottom` (1500) to the furniture line
 * (1700) is 200px tall, and a two-line caption at 44px is 118px of text in a block
 * whose *centre* the storyboard placed at 1497.6 — a centimetre inside the content
 * area. Forcing the block down to satisfy the overlap rule moved the caption 61px
 * away from where it was asked to be, and for a block taller than the band it
 * pushed the centre past the frame entirely, which is the bug that made an
 * eight-line block report a bottom edge at 2057 on a 1920 frame.
 *
 * So the overlap rule is dropped and the priority is stated instead. A caption may
 * sit a few pixels into the content area when the storyboard asks it to; it may
 * never leave the frame. The caller's real defence against a tall block is the
 * line budget, which the caption band enforces at the type level.
 */
export function captionCentreY(normalised: number, blockH = 0): number {
  const requested = Math.min(
    FRAME.height - 250,
    Math.max(CONTENT.bottom - 150, normalised * FRAME.height),
  );
  if (blockH <= 0) return requested;
  // The lowest centre whose block still clears the furniture, and the highest
  // whose block still has a top edge on the frame.
  const lowest = FRAME.height - 220 - blockH / 2;
  const highest = blockH / 2;
  return Math.max(highest, Math.min(lowest, requested));
}
