/**
 * Stagger.
 *
 * Staggering is the cheapest way to make a group of related things feel
 * choreographed rather than switched on. Two rules keep it from becoming a
 * template:
 *
 * - The step is proportional to the count, so three items and nine items both
 *   finish together. A fixed step makes big groups drag.
 * - The whole group is bounded. Past about 900ms of stagger the last item feels
 *   late rather than sequenced.
 */

import { profile } from "./ease.js";

export interface StaggerOptions {
  count: number;
  /** Total time the group takes, in frames. */
  groupDurationInFrames: number;
  /** Overlap between items, 0 = fully sequential, 1 = all at once. */
  overlap?: number;
  profile?: string;
}

export function staggerStep({ count, groupDurationInFrames, overlap = 0.55, profile: p }: StaggerOptions): number {
  if (count <= 1) return 0;
  const spec = profile(p);
  const total = groupDurationInFrames * spec.durationScale;
  const clamped = Math.max(0, Math.min(0.9, overlap));
  const span = total * (1 - clamped);
  // Never spread a group over more than 900ms, however many items it holds.
  const ceiling = Math.round(0.9 * 30);
  return Math.min(span / (count - 1), ceiling / Math.max(1, count - 1));
}

/** The frame at which item `i` begins. */
export function staggerStart(options: StaggerOptions, index: number): number {
  return index * staggerStep(options);
}

/**
 * Per-item duration once the group is divided up. Items overlap by construction,
 * so an individual item is shorter than the group.
 */
export function staggerItemDuration(options: StaggerOptions): number {
  const step = staggerStep(options);
  return Math.max(4, options.groupDurationInFrames - step * Math.max(0, options.count - 1));
}
