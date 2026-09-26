// The pacing ceiling has to survive the whole allocator, including the rounding
// pass that puts rounding drift back into the timeline.
//
// Hydration could not be built at all: three scenes came out longer than the
// 14s ceiling and schema validation refused the storyboard, so a topic with
// longer spoken lines than caffeine could never render. A ceiling that only holds
// for the first draft of the arithmetic is not a ceiling.

import { describe, expect, it } from "vitest";
import { MAX_SCENE_S, MIN_SCENE_S, allocateScenes, type TimeUnit } from "@hc/storyboard";

function unit(id: string, speech_s: number): TimeUnit {
  return { id, speech_s };
}

describe("scene windows respect the pacing ceiling", () => {
  it("never exceeds the ceiling when every line is comfortably short", () => {
    const units = [unit("a", 4), unit("b", 4), unit("c", 4), unit("d", 4)];
    const windows = allocateScenes(units, { total_s: 30 });
    expect(windows.every((w) => w.duration_s <= MAX_SCENE_S)).toBe(true);
  });

  it("never exceeds the ceiling even when the target is larger than the ceiling allows", () => {
    // Four 15s lines cannot fit in 60s if each is capped at 14s. The only honest
    // answers are to break the ceiling or to come up short, and coming up short is
    // the one a scheduler can act on.
    const units = [unit("a", 15.4), unit("b", 15.4), unit("c", 6), unit("d", 5)];
    const windows = allocateScenes(units, { total_s: 60 });
    expect(windows.every((w) => w.duration_s <= MAX_SCENE_S)).toBe(true);
    const sum = windows.reduce((a, w) => a + w.duration_s, 0);
    expect(sum).toBeLessThanOrEqual(4 * MAX_SCENE_S);
    expect(sum).toBeGreaterThan(60 - 5);
  });

  it("keeps a scene at least as long as the line it has to say", () => {
    // 15s of speech in a 10s target. Both lines fit the ceiling, so nothing forces
    // a choice: the windows must keep the words they carry and report the overrun
    // rather than cutting a line short to hit the target.
    const units = [unit("a", 8), unit("b", 7)];
    const windows = allocateScenes(units, { total_s: 10 });
    expect(windows[0]?.duration_s).toBeGreaterThanOrEqual(8);
    expect(windows[1]?.duration_s).toBeGreaterThanOrEqual(7);
    expect(windows.every((w) => w.overflow_s > 0)).toBe(true);
  });

  it("caps a line longer than the ceiling and reports the conflict", () => {
    // A 15.4s line cannot be honoured both ways. The ceiling holds, because it is
    // enforced by storyboard validation, and the cut is reported as an overrun
    // rather than hidden. The alternative, a 15.4s scene, fails validation with no
    // indication of which arithmetic produced it.
    const units = [unit("a", 15.4), unit("b", 4)];
    const windows = allocateScenes(units, { total_s: 30 });
    expect(windows[0]?.duration_s).toBeLessThanOrEqual(MAX_SCENE_S);
    expect(windows[0]?.overflow_s).toBeGreaterThan(0);
  });

  it("keeps every window contiguous and summing to the total", () => {
    const units = [unit("a", 15.4), unit("b", 3.2), unit("c", 9.8), unit("d", 4.1), unit("e", 2.2)];
    const windows = allocateScenes(units, { total_s: 55 });
    let cursor = 0;
    for (const w of windows) {
      expect(w.start).toBeCloseTo(cursor, 1);
      expect(w.end).toBeCloseTo(w.start + w.duration_s, 1);
      cursor = w.end;
    }
    expect(cursor).toBeCloseTo(55, 1);
  });

  it("never drops a window below the readability floor", () => {
    const units = [unit("a", 15.4), unit("b", 0.2), unit("c", 0.2), unit("d", 0.3)];
    const windows = allocateScenes(units, { total_s: 20 });
    expect(windows.every((w) => w.duration_s >= MIN_SCENE_S)).toBe(true);
  });

  it("respects a caller-supplied ceiling", () => {
    const units = [unit("a", 9), unit("b", 9), unit("c", 9)];
    const windows = allocateScenes(units, { total_s: 40, max_s: 6 });
    expect(windows.every((w) => w.duration_s <= 6)).toBe(true);
  });
});
