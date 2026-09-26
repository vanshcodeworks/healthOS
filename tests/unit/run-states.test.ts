import { describe, expect, it } from "vitest";
import {
  RUN_STATES,
  RUN_TRANSITIONS,
  canTransition,
  nextState,
  type RunState,
} from "@hc/orchestrator";

const HAPPY_PATH: RunState[] = [
  "PLANNED",
  "AUDIO_SYNTHESIZED",
  "AUDIO_MEASURED",
  "STORYBOARD_REBUILT",
  "TIMING_VALIDATED",
  "RENDERING",
  "RENDERED",
  "FINAL_VALIDATED",
  "READY",
];

describe("run states", () => {
  it("walks the pipeline in the order the audio requires", () => {
    let state: RunState = "PLANNED";
    const walked: RunState[] = [state];
    for (;;) {
      const next = nextState(state);
      if (!next) break;
      expect(canTransition(state, next)).toBe(true);
      state = next;
      walked.push(state);
    }
    expect(walked).toEqual(HAPPY_PATH);
  });

  it("lets a render be retried without going back to the voice", () => {
    // The reason audio is persisted separately: a browser crash on the last
    // frame must not cost a synthesis.
    expect(canTransition("RENDERING", "RENDERING")).toBe(true);
    expect(canTransition("RENDERED", "RENDERING")).toBe(false);
    expect(canTransition("RENDERING", "AUDIO_SYNTHESIZED")).toBe(false);
  });

  it("refuses to skip a measurement or a validation", () => {
    expect(canTransition("PLANNED", "RENDERING")).toBe(false);
    expect(canTransition("AUDIO_SYNTHESIZED", "STORYBOARD_REBUILT")).toBe(false);
    expect(canTransition("STORYBOARD_REBUILT", "RENDERED")).toBe(false);
    expect(canTransition("AUDIO_MEASURED", "READY")).toBe(false);
  });

  it("treats READY as final", () => {
    expect(canTransition("READY", "PLANNED")).toBe(false);
    expect(canTransition("READY", "RENDERING")).toBe(false);
    expect(nextState("READY")).toBeNull();
  });

  it("allows a failed run to be re-entered but not skipped forward", () => {
    expect(canTransition("FAILED", "PLANNED")).toBe(true);
    expect(canTransition("FAILED", "RENDERING")).toBe(true);
    expect(canTransition("FAILED", "READY")).toBe(false);
  });

  it("gives every declared state a transition table and reaches every one", () => {
    // A state missing from the table would throw at runtime instead of being
    // caught here, and an unreachable state is dead code wearing a state name.
    const reachable = new Set<RunState>(["PLANNED", "FAILED"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const from of [...reachable]) {
        for (const to of RUN_TRANSITIONS[from]) {
          if (!reachable.has(to)) {
            reachable.add(to);
            grew = true;
          }
        }
      }
    }
    expect([...RUN_STATES].sort()).toEqual([...reachable].sort());
  });

  it("never leaves a state without an exit", () => {
    for (const state of RUN_STATES) {
      const exits = RUN_TRANSITIONS[state];
      expect(Array.isArray(exits)).toBe(true);
      if (state !== "READY") {
        expect(exits.length).toBeGreaterThan(0);
      }
    }
  });
});
