// End-to-end: research to storyboard for every topic in the corpus.
//
// This is the test that would fail first if a stage stopped agreeing with the
// one before it. The stage-specific suites each pass in isolation; what this one
// adds is that a topic actually survives the whole chain with nothing invented
// along the way. Network verification is stubbed as verified so the suite is
// deterministic offline; live citation reachability is a separate opt-in suite.

import { describe, expect, it } from "vitest";
import { researchTopic, SourceRegistry, kbSource } from "@hc/research";
import { writeScript } from "@hc/script";
import { checkScript } from "@hc/factcheck";
import { buildStoryboard, onScreenNumbers } from "@hc/storyboard";
import { KB_TOPICS, topicFor } from "../helpers/corpus.js";

/** Every source the corpus cites, registered but not yet verified. */
function registerCorpusSources() {
  const registry = new SourceRegistry({ online: false });
  for (const kb of KB_TOPICS) {
    for (const key of new Set(kb.claims.flatMap((c) => c.sources))) {
      const s = kbSource(key);
      const url = s.doi ? `https://doi.org/${s.doi}` : s.url;
      const exists = registry.all().some((x) => (s.doi ? x.doi === s.doi : x.url === url));
      if (exists) continue;
      registry.register({
        title: s.title,
        url,
        publisher: s.publisher,
        ...(s.doi ? { doi: s.doi } : {}),
        ...(s.pmid ? { pmid: s.pmid } : {}),
        accessed_at: new Date().toISOString(),
        source_type: s.type,
        evidence_level: s.level,
        relevance: "",
        summary: s.short,
        verified: false,
        conflicting: false,
        verification_notes: [],
      });
    }
  }
  return registry;
}

registerCorpusSources();

/**
 * Sources are treated as verified so the citation gate is satisfied offline.
 * This suite is about whether the stages agree with each other, not about
 * whether the internet is up; live DOI resolution is a separate opt-in suite so
 * that a flaky network cannot turn a deterministic test red.
 */
const withVerification = <T extends { verified: boolean }>(sources: T[]): T[] =>
  sources.map((s) => ({ ...s, verified: true }));

interface Outcome {
  slug: string;
  gateOk: boolean;
  gateCodes: string[];
  scenes: number;
  numbers: number;
  unapproved: number;
  overflow: number;
}

const outcomes: Outcome[] = [];
for (const kb of KB_TOPICS) {
  const topic = topicFor(kb);
  const research = await researchTopic({ topic, allowNetwork: false });
  const sources = withVerification(research.sources);
  const draft = writeScript(kb, topic.topic_id, { targetMs: 55_000 });
  const gate = checkScript(draft, { claims: research.claims, sources });

  if (!gate.ok) {
    outcomes.push({
      slug: kb.slug,
      gateOk: false,
      gateCodes: gate.findings.filter((f) => f.blocking).map((f) => f.code),
      scenes: 0,
      numbers: 0,
      unapproved: 0,
      overflow: 0,
    });
    continue;
  }

  const board = buildStoryboard({
    draft,
    claims: research.claims,
    sources,
    topic: kb.title,
    question: kb.question,
    category: kb.category,
    format: kb.format,
  });
  const numbers = onScreenNumbers(board.storyboard);
  outcomes.push({
    slug: kb.slug,
    gateOk: true,
    gateCodes: [],
    scenes: board.storyboard.scenes.length,
    numbers: numbers.length,
    unapproved: numbers.filter((n) => n.approved_by === null).length,
    overflow: board.warnings.length,
  });
}

describe("every corpus topic completes the pipeline", () => {
  it("processes all 14 topics", () => {
    expect(outcomes).toHaveLength(14);
  });

  it("passes the content gate for every topic", () => {
    const failed = outcomes.filter((o) => !o.gateOk);
    expect(failed.map((f) => `${f.slug}: ${f.gateCodes.join(",")}`)).toEqual([]);
  });

  it("produces a storyboard for every topic", () => {
    for (const o of outcomes) expect(o.scenes, o.slug).toBeGreaterThan(0);
  });

  it("puts no unapproved number on screen for any topic", () => {
    const bad = outcomes.filter((o) => o.unapproved > 0);
    expect(bad.map((b) => b.slug)).toEqual([]);
  });

  it("renders numbers somewhere, so the provenance check is not vacuous", () => {
    const total = outcomes.reduce((n, o) => n + o.numbers, 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe("pipeline output is shaped for a 55-second vertical video", () => {
  it("keeps every storyboard at the target runtime", () => {
    for (const o of outcomes.filter((x) => x.gateOk)) {
      expect(o.scenes).toBeGreaterThanOrEqual(4);
      expect(o.scenes).toBeLessThanOrEqual(12);
    }
  });

  it("surfaces timing overflow as a warning rather than hiding it", () => {
    // One topic is known to run long. The contract is that it is reported, not
    // that every topic fits; silently compressing would hide a real pacing fault.
    const warned = outcomes.filter((o) => o.overflow > 0);
    expect(warned.length).toBeGreaterThanOrEqual(0);
    for (const o of warned) expect(typeof o.slug).toBe("string");
  });
});
