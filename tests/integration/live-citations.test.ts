// Live citation verification. Opt-in, because it depends on the internet.
//
// Run with HEALTHOS_LIVE_SOURCES=1. The default suite stays deterministic, but
// the ability to actually resolve every DOI the channel cites is worth having on
// demand: a source that quietly rots into a dead link is a citation-support gap
// that no offline test can detect.
//
// Blocked is a legitimate outcome. Publishers commonly refuse automated clients
// with 401/403/429, which says nothing about whether the source exists, so those
// are reported separately from genuinely dead links.

import { describe, expect, it } from "vitest";
import { SourceRegistry, kbSource, type VerificationResult } from "@hc/research";
import { KB_TOPICS } from "../helpers/corpus.js";

const live = process.env.HEALTHOS_LIVE_SOURCES === "1";
const registry = new SourceRegistry({ online: true, timeoutMs: 20_000 });

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

// Typed explicitly so the callbacks below keep their element type even though the
// suite is skipped when the network check is off.
const results: VerificationResult[] = live ? await registry.verifyAll() : [];

describe.skipIf(!live)("live citation verification", () => {
  it("registers every source the corpus cites", () => {
    const expected = new Set(KB_TOPICS.flatMap((kb) => kb.claims.flatMap((c) => c.sources)));
    expect(registry.all().length).toBe(expected.size);
  });

  it("has no dead citations", () => {
    const dead = results.filter((r) => r.outcome === "not_found").map((r) => r.source_id);
    expect(dead, "dead citations must be replaced, not tolerated").toEqual([]);
  });

  it("resolves or explicitly blocks every citation", () => {
    const unresolved = results.filter((r) => r.outcome === "error").map((r) => `${r.source_id}: ${r.note}`);
    expect(unresolved).toEqual([]);
  });

  it("verifies a healthy majority of citations", () => {
    const verified = results.filter((r) => r.outcome === "verified").length;
    expect(verified / results.length).toBeGreaterThan(0.5);
  });
});

describe("offline default", () => {
  it.skipIf(live)("skips network checks unless HEALTHOS_LIVE_SOURCES=1", () => {
    expect(results).toEqual([]);
  });

  it("still registers the full corpus without touching the network", () => {
    expect(registry.all().length).toBeGreaterThanOrEqual(16);
    expect(registry.all().every((s) => s.url.startsWith("http"))).toBe(true);
  });
});
