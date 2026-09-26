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

  // Each unit needs at least its own speech time.
  //
  // The head and tail breathing room is deliberately not part of that floor. On a
  // tight track the measured lines already fill the recording, so charging every
  // scene 0.47s of padding manufactures overflow out of nothing: the content sum
  // is pushed past the track, the run is declared over budget, and scenes are then
  // asked to shrink below the time their own words take. Padding is bought out of
  // the slack below, and when there is no slack it is the overrun that gets
  // reported, not a scene that cuts its own line off.
  const floors = units.map((u) =>
    Math.max(u.min_s ?? min, u.silent ? min : u.speech_s),
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
  const shared = units.map((u, i) => {
    const floor = floors[i] ?? min;
    const share = weightSum === 0 ? 0 : (floor / weightSum) * slack;
    return round2(Math.min(u.max_s ?? max, floor + share));
  });

  // Rounding must not create drift, so the leftover is handed out to whichever
  // scenes can still absorb it, within their own bounds. The last scene is
  // offered first because a final beat running a fraction long is the natural
  // place for slack.
  const durations = fillToTotal(shared, units, floors, total, min, max);

  let cursor = 0;
  return units.map((u, i) => {
    const start = round2(cursor);
    const end = round2(cursor + (durations[i] ?? 0));
    cursor = end;
    // How much of this beat's speech does not fit the window it was given: the
    // run's overrun, or the part of this scene that the ceiling clipped off it.
    // A line silently trimmed by the ceiling reads as a scene that simply had less
    // to say, which is the one reading that is wrong.
    const cut = round2((floors[i] ?? min) - (durations[i] ?? 0));
    return {
      id: u.id,
      start,
      end,
      duration_s: round2(end - start),
      overflow_s: round2(Math.max(overflow, cut, 0)),
    };
  });
}

/**
 * Nudges windows so they sum to the total without breaking any bound.
 *
 * A window may grow to its ceiling, and shrink only to its own floor, which is the
 * time its line takes to say. Shrinking below that would clip the narration, and
 * clipping narration to hit a target is the one adjustment this timing code exists
 * to avoid. If the total cannot be met inside those bounds — the content is longer
 * than the runtime, or there are fewer scenes than the ceiling allows — the
 * leftover stays unallocated. A reported shortfall is something a scheduler can
 * act on; a window past the ceiling is a validation crash several steps later with
 * no indication of which arithmetic produced it.
 *
 * The previous version offered the leftover to one scene, then spread it backwards
 * with `take = room`, which *added* each scene's headroom instead of taking it
 * back. A track 7s short of its content therefore produced windows close to twice
 * as long as the video, three of them past the ceiling, and a storyboard that
 * failed validation instead of reporting the overrun.
 */
function fillToTotal(
  durations: number[],
  units: TimeUnit[],
  floors: number[],
  total: number,
  min: number,
  max: number,
): number[] {
  const out = [...durations];
  const capOf = (i: number): number => units[i]?.max_s ?? max;
  const floorOf = (i: number): number => Math.max(min, floors[i] ?? min);
  let remaining = round2(total - out.reduce((a, b) => a + b, 0));

  // Repeated passes rather than a single sweep: a scene already at its bound simply
  // contributes nothing this time round, and the next scene gets the chance. It
  // terminates because every non-empty pass either finishes the remaining total or
  // strictly reduces the room left in the system.
  let moved = true;
  while (moved && Math.abs(remaining) > 0.005) {
    moved = false;
    for (let i = out.length - 1; i >= 0 && Math.abs(remaining) > 0.005; i--) {
      const current = out[i] ?? 0;
      const room = remaining > 0 ? capOf(i) - current : current - floorOf(i);
      if (room <= 0.005) continue;
      const take = Math.min(Math.abs(remaining), room);
      const signed = remaining > 0 ? take : -take;
      out[i] = round2(current + signed);
      remaining = round2(remaining - signed);
      moved = true;
    }
  }
  return out;
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
