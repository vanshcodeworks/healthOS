// Scene timing allocation.
//
// The invariant that matters: scenes must be contiguous. A gap between two
// scenes is a frozen frame in the finished video, because the renderer places
// each scene on its own timeline. A gap of zero is the whole contract, so it is
// asserted directly rather than inferred from the total duration.

import { describe, expect, it } from "vitest";
import { allocateScenes, distribute, round2, MIN_SCENE_S } from "@hc/storyboard";

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

  it("still fills the total exactly when it compresses", () => {
    const scenes = allocateScenes([unit("a", 30), unit("b", 30)], { total_s: 20 });
    expect(round2(scenes[scenes.length - 1]!.end)).toBe(20);
  });

  // max_s is a soft target, not a guarantee: when there are too few scenes to
  // reach the total, the remaining time lands on the last one. In the real
  // pipeline the final scene is the spoken disclaimer, which is exactly the
  // scene that can absorb slack, so this has never produced a 41-second pause in
  // a finished video. It is pinned here so the behaviour is deliberate and
  // visible rather than accidental.
  it("gives leftover time to the final scene when the caps cannot absorb it", () => {
    const scenes = allocateScenes([unit("a", 20), unit("disclaimer", 5)], { total_s: 55 });
    const last = scenes[scenes.length - 1]!;
    expect(last.id).toBe("disclaimer");
    expect(last.duration_s).toBeGreaterThan(20);
    expect(round2(last.end)).toBe(55);
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
