// Research, persistence and corpus integrity.
//
// Persistence matters here for a specific reason: the storyboard stage reads
// numbers, caveats and visual hints out of the claims it is given. If those
// fields silently degrade through a database round trip, a figure can reach the
// screen with no reviewer-approved source behind it. So the round trip is
// asserted field by field rather than merely "it did not throw".

import { describe, expect, it } from "vitest";
import { getDb, closeDb } from "@hc/core";
import { ResearchStore, kbSource, auditClaims } from "@hc/research";
import { HOOK_TYPES } from "@hc/schemas";
import { KB_TOPICS, research, topicFor } from "../helpers/corpus.js";

describe("knowledge base integrity", () => {
  it("has 14 topics with unique slugs", () => {
    expect(KB_TOPICS).toHaveLength(14);
    expect(new Set(KB_TOPICS.map((t) => t.slug)).size).toBe(KB_TOPICS.length);
  });

  it("gives every topic an arc to draw from", () => {
    // The arc is a pool of angles and is deliberately longer than the claim list;
    // the writer draws one beat per claim. What must never happen is the writer
    // reusing a claim to fill the runtime, which is asserted in the script tests.
    for (const kb of KB_TOPICS) {
      expect(kb.arc.length).toBeGreaterThan(0);
    }
  });

  it("uses only hook types the schema accepts", () => {
    // Read from the enum rather than a copied list, so adding a hook type cannot
    // make this test fail for the wrong reason.
    for (const kb of KB_TOPICS) {
      for (const hook of kb.hooks) {
        expect(HOOK_TYPES).toContain(hook.type);
      }
    }
  });

  it("cites only sources that exist in the registry", () => {
    for (const kb of KB_TOPICS) {
      for (const key of kb.claims.flatMap((c) => c.sources)) {
        expect(() => kbSource(key)).not.toThrow();
      }
    }
  });

  it("declares a quantity only where the claim text actually contains it", () => {
    // Every figure shown on screen is derived from a knowledge-base `numbers`
    // entry, so that entry has to be traceable to the reviewed prose. Two
    // allowances are made, both of which preserve the value: a display range is
    // written in prose as "20 to 45" but recorded as "20-45", and a small count
    // is often spelled out ("about two hours" recorded as "2").
    const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    for (const kb of KB_TOPICS) {
      for (const claim of kb.claims) {
        for (const num of claim.numbers) {
          const groups = num.value.match(/\d+(?:\.\d+)?/g) ?? [];
          expect(groups.length, `${kb.slug}/${claim.id} declares "${num.value}" with no digits`).toBeGreaterThan(0);
          const lower = claim.text.toLowerCase();
          for (const group of groups) {
            const spelled = WORDS[Number.parseInt(group, 10)];
            const inText = claim.text.includes(group) || (spelled !== undefined && lower.includes(spelled));
            expect(inText, `${kb.slug}/${claim.id} declares "${num.value}" but the text never expresses "${group}"`).toBe(
              true,
            );
          }
        }
      }
    }
  });

  it("gives every declared quantity a unit", () => {
    // A figure with no unit cannot be charted honestly, and a chart silently
    // dropping the unit is how "95" ends up on screen reading as a bare number.
    for (const kb of KB_TOPICS) {
      for (const claim of kb.claims) {
        for (const num of claim.numbers) {
          expect(num.unit.trim().length, `${kb.slug}/${claim.id} "${num.value}" has no unit`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("claim persistence", () => {
  it("round-trips review metadata through SQLite unchanged", async () => {
    const db = getDb({ path: ":memory:" });
    try {
      db.migrate();
      const store = new ResearchStore(db);
      let checked = 0;
      let figures = 0;
      let caveats = 0;

      for (const kb of KB_TOPICS.slice(0, 4)) {
        const { claims } = await research(kb);
        const topic = topicFor(kb);
        for (const claim of claims) store.upsertClaim(claim, topic.topic_id);
        const back = store.listClaimsForTopic(topic.topic_id);
        expect(back).toHaveLength(claims.length);

        const original = new Map(claims.map((c) => [c.claim_id, c]));
        for (const claim of back) {
          const before = original.get(claim.claim_id)!;
          for (const field of [
            "figures",
            "caveat",
            "visual_hints",
            "visual_strategy_hint",
            "permitted_phrasing",
            "forbidden_phrasing",
            "risk_flags",
            "claim_type",
            "evidence_level",
            "hedge_required",
          ] as const) {
            expect(JSON.stringify(claim[field]), `claim ${claim.claim_id} field ${field}`).toBe(
              JSON.stringify(before[field]),
            );
          }
          figures += claim.figures.length;
          caveats += claim.caveat ? 1 : 0;
          checked++;
        }
      }
      // Guards against the round trip passing because it had nothing to carry.
      expect(checked).toBeGreaterThan(10);
      expect(figures).toBeGreaterThan(0);
      expect(caveats).toBeGreaterThan(0);
    } finally {
      closeDb();
    }
  });

  it("applies migrations idempotently", () => {
    const db = getDb({ path: ":memory:" });
    try {
      db.migrate();
      const first = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
      db.migrate();
      const second = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
      expect(second.length).toBe(first.length);
      expect(first.length).toBeGreaterThanOrEqual(28);
    } finally {
      closeDb();
    }
  });
});

describe("source registry", () => {
  it("has at least 16 curated sources and none duplicated by DOI", () => {
    const keys = new Set(KB_TOPICS.flatMap((kb) => kb.claims.flatMap((c) => c.sources)));
    expect(keys.size).toBeGreaterThanOrEqual(16);
    const dois = [...keys].map((k) => kbSource(k).doi).filter((d): d is string => Boolean(d));
    expect(new Set(dois).size).toBe(dois.length);
  });
});

describe("corpus citation audit", () => {
  it("reports no problems for any topic in the corpus", async () => {
    // Offline: sources are marked verified so this asserts that every claim's
    // citations resolve and are strong enough, not that the network is up.
    const problems: string[] = [];
    for (const kb of KB_TOPICS) {
      const { claims, sources } = await research(kb);
      const verified = sources.map((s) => ({ ...s, verified: true }));
      const summary = auditClaims(claims, verified);
      problems.push(...summary.problems.map((p) => `${kb.slug}: ${p}`));
    }
    expect(problems).toEqual([]);
  });
});
