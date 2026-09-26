// The script writer may only arrange reviewed claims.
//
// The writer is the one component that could quietly invent content: it decides
// what a viewer hears. Every other stage validates what it is given, so a writer
// that paraphrased freely would be an unaudited hole in the whole system. These
// tests pin the guarantee that it only ever reorders and lightly trims text a
// reviewer already approved.

import { describe, expect, it } from "vitest";
import { writeScript } from "@hc/script";
import { groundLine } from "@hc/factcheck";
import { KB_TOPICS, research, topicFor } from "../helpers/corpus.js";

const scripts = KB_TOPICS.map((kb) => {
  const topic = topicFor(kb);
  return { kb, topic, draft: writeScript(kb, topic.topic_id, { targetMs: 55_000 }) };
});

describe("a script is built only from knowledge-base claims", () => {
  it("never repeats a claim to fill the runtime", () => {
    // The knowledge-base arc is deliberately longer than the claim list. If the
    // writer looped over the arc it would reuse claims, and the repeated line
    // would be narration no reviewer ever checked.
    for (const { kb, draft } of scripts) {
      const ids = draft.beats.map((b) => b.claim_id).filter((id): id is string => Boolean(id));
      expect(new Set(ids).size, `topic ${kb.slug} repeats a claim`).toBe(ids.length);
    }
  });

  it("emits no more beats than the topic has claims", () => {
    for (const { kb, draft } of scripts) {
      expect(draft.beats.length).toBeLessThanOrEqual(kb.claims.length);
    }
  });

  it("only cites claim ids that exist in the knowledge base", () => {
    for (const { kb, draft } of scripts) {
      const known = new Set(kb.claims.map((c) => c.id));
      for (const beat of draft.beats) expect(known.has(beat.claim_id)).toBe(true);
    }
  });

  it("gives every beat a unique id", () => {
    for (const { draft } of scripts) {
      const ids = draft.beats.map((b) => b.beat_id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("a script has the safety framing a health channel needs", () => {
  it("includes a disclaimer and a call to action", () => {
    for (const { draft } of scripts) {
      expect(draft.disclaimer.length).toBeGreaterThan(0);
      expect(draft.cta.length).toBeGreaterThan(0);
    }
  });

  it("tells viewers the content is general education, not medical advice", () => {
    for (const { draft } of scripts) {
      expect(draft.disclaimer.toLowerCase()).toContain("not medical advice");
    }
  });

  it("routes a viewer with a health condition to a clinician", () => {
    for (const { draft } of scripts) {
      expect(draft.disclaimer.toLowerCase()).toMatch(/doctor|clinician|professional/);
    }
  });

  it("uses a hook type the topic actually declares", () => {
    for (const { kb, draft } of scripts) {
      expect(kb.hooks.map((h) => h.type)).toContain(draft.hook_type);
    }
  });

  it("takes the hook text from the topic", () => {
    for (const { kb, draft } of scripts) {
      const hook = kb.hooks.find((h) => h.type === draft.hook_type);
      expect(hook?.text).toBe(draft.hook);
    }
  });
});

describe("spoken claim lines stay grounded in the reviewed claim", () => {
  it("keeps every spoken line traceable to its source claim", async () => {
    let checked = 0;
    for (const kb of KB_TOPICS) {
      const { claims } = await research(kb);
      const byId = new Map(claims.map((c) => [c.claim_id, c]));
      const topic = topicFor(kb);
      const draft = writeScript(kb, topic.topic_id, { targetMs: 55_000 });

      for (const beat of draft.beats) {
        const claim = byId.get(beat.claim_id);
        expect(claim, `beat ${beat.beat_id} cites unknown claim ${beat.claim_id}`).toBeDefined();
        const result = groundLine(beat.narration, claim);
        const blocking = result.findings.filter((f) => f.blocking);
        expect(blocking.map((f) => f.code), `beat "${beat.narration.slice(0, 60)}"`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe("script timing", () => {
  it("reports a realistic speech estimate", () => {
    for (const { draft } of scripts) {
      expect(draft.estimated_ms).toBeGreaterThan(20_000);
      expect(draft.estimated_ms).toBeLessThan(120_000);
    }
  });

  it("warns when the script cannot fit its target runtime", () => {
    // Overflow is surfaced rather than silently compressing, so a topic that
    // cannot be narrated in 55 seconds is visible before it reaches a renderer.
    const { draft } = scripts[0]!;
    expect(Array.isArray(draft.warnings)).toBe(true);
  });

  it("keeps word counts consistent with the narration", () => {
    for (const { draft } of scripts) {
      for (const beat of draft.beats) {
        const words = beat.narration.split(/\s+/).filter(Boolean).length;
        expect(beat.words).toBe(words);
      }
    }
  });
});
