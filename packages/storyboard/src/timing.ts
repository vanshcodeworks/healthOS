/**
 * Scene timing.
 *
 * Narration duration is not negotiable — the voice track decides how long a beat
 * lasts, and the visuals must stretch or compress to fit it. Trying to make the
 * script fit a fixed grid instead produces the classic failure where a caption
 * finishes two seconds before the narrator does and the viewer is left staring
 * at a finished thought.
 */

/** A scene shorter than this is unreadable; longer and attention drops. */
export const MIN_SCENE_S = 0.6;
export const MAX_SCENE_S = 14;

/** Hold time after the narration ends, so a beat can be read before it cuts. */
export const TAIL_HOLD_S = 0.35;
/** Extra lead-in before a beat's narration begins. */
export const HEAD_LEAD_S = 0.12;

export interface TimeUnit {
  id: string;
  /** Spoken duration in seconds, measured or estimated. */
  speech_s: number;
  /** Set for beats that are not spoken, such as a pure visual stinger. */
  silent?: boolean;
  min_s?: number;
  max_s?: number;
}

/**
 * Turn spoken beats into contiguous scene windows.
 *
 * The result always sums to `total_s`, is monotonically increasing, and respects
 * the readability floor and pacing ceiling. When the content cannot fit the
 * ceiling (a very long narration in a 14s-per-scene format) the overflow is
 * reported rather than silently dropped, because a video that overruns its
 * target is a scheduling problem the caller has to see.
 */
export function allocateScenes(
  units: TimeUnit[],
  options: { total_s: number; min_s?: number; max_s?: number },
): { id: string; start: number; end: number; duration_s: number; overflow_s: number }[] {
  const min = options.min_s ?? MIN_SCENE_S;
  const max = options.max_s ?? MAX_SCENE_S;
  const total = options.total_s;
  if (units.length === 0) return [];

  // Each unit needs at least its own speech time plus the breathing room that
  // makes a cut feel intentional rather than clipped.
  const floors = units.map((u) =>
    Math.max(u.min_s ?? min, u.silent ? min : u.speech_s + TAIL_HOLD_S + HEAD_LEAD_S),
  );
  const floorTotal = floors.reduce((a, b) => a + b, 0);

  // Overflow is the content that genuinely will not fit the runtime. It is not
  // the same thing as a long video: a 60s script in 8 scenes never exceeds the
  // 14s per-scene ceiling, so reporting the ceiling as overflow would warn on
  // every healthy video. Overflow is the narration that must be cut.
  const overflow = Math.max(0, floorTotal - total);

  // Shortening first: the padding above each floor is the only slack available,
  // and it belongs to the scenes that can least afford to be cut.
  const slack = Math.max(0, total - floorTotal);

  // Distribute the available time in proportion to how much each scene already
  // needs, so a long narration keeps its length and a short one gains less.
  const weightSum = floors.reduce((a, b) => a + b, 0) || 1;
  const durations = units.map((u, i) => {
    const floor = floors[i] ?? min;
    const share = weightSum === 0 ? 0 : (floor / weightSum) * slack;
    return round2(Math.min(u.max_s ?? max, floor + share));
  });

  // Rounding must not create drift, so the residual lands on the last scene,
  // which is the natural place for a final beat to run a fraction long.
  const sum = durations.reduce((a, b) => a + b, 0);
  const residual = round2(total - sum);
  if (Math.abs(residual) > 0.001 && durations.length > 0) {
    const last = durations.length - 1;
    const adjusted = (durations[last] ?? 0) + residual;
    if (adjusted >= min) durations[last] = round2(adjusted);
    else {
      // The last scene cannot absorb a negative residual without dropping below
      // the readability floor, so spread it backwards across scenes with room.
      let remaining = residual;
      for (let i = durations.length - 1; i >= 0 && Math.abs(remaining) > 0.001; i--) {
        const current = durations[i] ?? 0;
        const room = residual < 0 ? current - min : (units[i]?.max_s ?? max) - current;
        const take = Math.abs(remaining) <= room ? remaining : room;
        durations[i] = round2(current + take);
        remaining = round2(remaining - take);
      }
    }
  }

  let cursor = 0;
  return units.map((u, i) => {
    const start = round2(cursor);
    const end = round2(cursor + (durations[i] ?? 0));
    cursor = end;
    return { id: u.id, start, end, duration_s: round2(end - start), overflow_s: round2(overflow) };
  });
}

/**
 * Distribute a total across weights, honouring a floor on every part.
 * Used for pacing attention across the whole runtime rather than per scene.
 */
export function distribute(total: number, weights: number[], floor = 0): number[] {
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (weightSum <= 0) return weights.map(() => round2(total / weights.length));
  return weights.map((w) => round2(Math.max(floor, (Math.max(0, w) / weightSum) * total)));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
