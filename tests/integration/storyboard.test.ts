// Storyboard generation across the whole knowledge base.
//
// The point of running all 14 topics rather than one is that the visual policy
// branches on evidence type, so a single topic only ever exercises one path.
// Every topic also has to survive the full gate, which is what proves the
// storyboard stage never invents content the reviewer did not approve.

import { describe, expect, it } from "vitest";
import { buildStoryboard, onScreenNumbers } from "@hc/storyboard";
import { checkScript } from "@hc/factcheck";
import { writeScript } from "@hc/script";
import { KB_TOPICS, asVerified, research, topicFor } from "../helpers/corpus.js";

/** Every topic: researched offline, gated, then boarded. */
async function buildAll() {
  return Promise.all(
    KB_TOPICS.map(async (kb) => {
      const { claims, sources } = await research(kb);
      const verified = asVerified(sources);
      const topic = topicFor(kb);
      const draft = writeScript(kb, topic.topic_id, { targetMs: 55_000 });
      const gate = checkScript(draft, { claims, sources: verified });
      if (!gate.ok) {
        return { kb, claims, sources: verified, draft, gate, board: null as ReturnType<typeof buildStoryboard> | null };
      }
      const board = buildStoryboard({
        draft,
        claims,
        sources: verified,
        topic: kb.title,
        question: kb.question,
        category: kb.category,
        format: kb.format,
      });
      return { kb, claims, sources: verified, draft, gate, board };
    }),
  );
}

const all = await buildAll();
const boards = all.filter((r) => r.board !== null);

describe("every topic in the corpus clears the content gate", () => {
  it("gates all 14 topics with no blocking findings", () => {
    const failures = all
      .filter((r) => !r.gate.ok)
      .map((r) => `${r.kb.slug}: ${r.gate.findings.filter((f) => f.blocking).map((f) => f.code).join(",")}`);
    expect(failures).toEqual([]);
    expect(all).toHaveLength(14);
  });
});

describe("every topic produces a storyboard", () => {
  it("builds all 14", () => {
    expect(boards).toHaveLength(14);
  });

  it("starts at zero and ends on the target runtime", () => {
    for (const { board } of boards) {
      expect(board!.storyboard.scenes[0]!.start).toBe(0);
      expect(board!.storyboard.duration).toBeCloseTo(55, 1);
    }
  });

  it("keeps scenes contiguous, because a gap is a frozen frame", () => {
    for (const { board } of boards) {
      const scenes = board!.storyboard.scenes;
      for (let i = 1; i < scenes.length; i++) {
        expect(scenes[i]!.start).toBeCloseTo(scenes[i - 1]!.end, 5);
      }
    }
  });

  it("ends every video with a caveat and a call to action", () => {
    for (const { board } of boards) {
      const intents = board!.storyboard.scenes.map((s) => s.intent);
      expect(intents).toContain("caveat");
      expect(intents).toContain("cta");
    }
  });

  it("puts the caveat and call to action at the end, not the middle", () => {
    for (const { board } of boards) {
      const intents = board!.storyboard.scenes.map((s) => s.intent);
      const caveat = intents.indexOf("caveat");
      const cta = intents.indexOf("cta");
      expect(caveat).toBeGreaterThan(0);
      expect(cta).toBeGreaterThan(0);
      expect(Math.max(caveat, cta)).toBeGreaterThanOrEqual(intents.length - 2);
    }
  });

  it("produces at least one scene per topic", () => {
    for (const { board } of boards) {
      expect(board!.storyboard.scenes.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("on-screen numbers are traceable to a reviewed claim", () => {
  it("approves every number that reaches the screen", () => {
    const unapproved = boards.flatMap(({ board }) =>
      onScreenNumbers(board!.storyboard)
        .filter((n) => n.approved_by === null)
        .map((n) => `${n.value} on ${n.scene_id}`),
    );
    expect(unapproved).toEqual([]);
  });

  it("actually renders numbers, so the check is not vacuous", () => {
    const total = boards.reduce((n, { board }) => n + onScreenNumbers(board!.storyboard).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("credits the claim that approved each number", () => {
    for (const { board, claims } of boards) {
      for (const n of onScreenNumbers(board!.storyboard)) {
        if (n.approved_by !== null) expect(claims.some((c) => c.claim_id === n.approved_by)).toBe(true);
      }
    }
  });

  it("rejects a number injected into a scene after the fact", () => {
    const { board, claims } = boards[0]!;
    const storyboard = structuredClone(board!.storyboard);
    const scene = storyboard.scenes.find((s) => s.on_screen_text)!;
    scene.on_screen_text = `${scene.on_screen_text} (97% of doctors agree)`;
    const bad = onScreenNumbers(storyboard).filter((n) => n.approved_by === null);
    expect(bad.length).toBeGreaterThan(0);
    expect(claims.length).toBeGreaterThan(0);
  });
});

describe("charts only show figures a reviewer declared", () => {
  it("uses charts somewhere in the corpus", () => {
    const charts = boards.reduce((n, { board }) => n + board!.storyboard.scenes.filter((s) => s.chart).length, 0);
    expect(charts).toBeGreaterThan(0);
  });

  it("ties every chart to a claim that carries structured figures", () => {
    for (const { board, claims } of boards) {
      for (const scene of board!.storyboard.scenes) {
        if (!scene.chart) continue;
        const declared = scene.claim_ids.some((id) =>
          claims.find((c) => c.claim_id === id)?.figures.length,
        );
        expect(declared).toBe(true);
      }
    }
  });
});
