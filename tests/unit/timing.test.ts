// Scene timing allocation.
//
// The invariant that matters: scenes must be contiguous. A gap between two
// scenes is a frozen frame in the finished video, because the renderer places
// each scene on its own timeline. A gap of zero is the whole contract, so it is
// asserted directly rather than inferred from the total duration.

import { describe, expect, it } from "vitest";
import { allocateScenes, distribute, round2, MAX_SCENE_S, MIN_SCENE_S } from "@hc/storyboard";

const unit = (id: string, speech_s: number, silent = false) => ({ id, speech_s, silent });

describe("allocateScenes", () => {
  it("returns nothing for no units", () => {
    expect(allocateScenes([], { total_s: 55 })).toEqual([]);
  });

  it("fills the requested total exactly", () => {
    const scenes = allocateScenes([unit("a", 8), unit("b", 10), unit("c", 6)], { total_s: 40 });
    expect(round2(scenes[scenes.length - 1]!.end)).toBe(40);
  });

  it("keeps scenes contiguous with no gaps", () => {
    const scenes = allocateScenes([unit("a", 8), unit("b", 12), unit("c", 5), unit("d", 7)], {
      total_s: 55,
    });
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i]!.start).toBeCloseTo(scenes[i - 1]!.end, 5);
    }
  });

  it("never drops a scene, however badly the content overflows", () => {
    const scenes = allocateScenes([unit("a", 30), unit("b", 30)], { total_s: 20 });
    expect(scenes).toHaveLength(2);
  });

  it("fills the total exactly when it can be done without cutting a line", () => {
    // 8 + 12 + 5 + 7 of speech in a 40s target: the content fits, so the windows
    // are compressed down to the target and the timeline is still tiled to the end.
    const scenes = allocateScenes([unit("a", 12), unit("b", 12), unit("c", 12)], { total_s: 40 });
    expect(round2(scenes[scenes.length - 1]!.end)).toBe(40);
  });

  // max_s is a ceiling, not a suggestion. Dumping the leftover on the last scene
  // used to look harmless because in the real pipeline the last scene is the
  // spoken disclaimer, and a disclaimer can absorb slack — which is exactly why
  // nobody read the number. It is 41 seconds of a held frame in a finished video
  // whenever the caps cannot absorb the time, and a storyboard that fails
  // validation on three scenes whenever the shortfall spreads the other way. The
  // ceiling holds now and the leftover is reported instead.
  it("holds the ceiling rather than handing the leftover to the final scene", () => {
    const scenes = allocateScenes([unit("a", 20), unit("disclaimer", 5)], { total_s: 55 });
    const last = scenes[scenes.length - 1]!;
    expect(last.duration_s).toBeLessThanOrEqual(MAX_SCENE_S);
    expect(last.end).toBeLessThan(55);
  });

  it("reports the overrun on every scene when the target is shorter than the content", () => {
    // 60s of speech cannot be rendered in 20s. Neither bound can be satisfied —
    // the ceiling is enforced by storyboard validation, and a scene shorter than
    // its own line would clip the narration — so the ceiling holds and the cut is
    // reported rather than hidden. A line trimmed by the ceiling otherwise reads
    // as a scene that simply had less to say, which is the one reading that is
    // wrong.
    const scenes = allocateScenes([unit("a", 30), unit("b", 30)], { total_s: 20 });
    expect(scenes.every((s) => s.duration_s <= MAX_SCENE_S)).toBe(true);
    expect(scenes.every((s) => s.overflow_s > 0)).toBe(true);
  });

  it("does not starve a silent beat below the minimum", () => {
    const scenes = allocateScenes([unit("a", 20), unit("beat", 0, true)], { total_s: 55 });
    const beat = scenes.find((s) => s.id === "beat")!;
    expect(beat.duration_s).toBeGreaterThanOrEqual(MIN_SCENE_S);
  });
});

describe("distribute", () => {
  it("splits a total across weights", () => {
    const parts = distribute(12, [1, 1, 1]);
    expect(round2(parts.reduce((a, b) => a + b, 0))).toBe(12);
  });

  it("respects a floor on every part", () => {
    const parts = distribute(10, [1, 1], 4);
    expect(parts.every((p) => p >= 4)).toBe(true);
  });
});

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.23456)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
  });
});
