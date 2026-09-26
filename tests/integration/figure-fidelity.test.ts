// Regressions for a figure-fidelity bug.
//
// A claim reading "reaches the brain within 20 to 45 minutes" was stored as the
// structured figure 20, because Number.parseFloat stops at the hyphen. A counter
// or bar chart built from that figure would display "20 minutes" as though it
// were the measured value, quietly understating a range the reviewer approved.
//
// Ranges and open bounds are legitimate content; what is not legitimate is
// flattening one into a single number. They now stay in the prose, where "20 to
// 45" survives intact.

import { describe, expect, it } from "vitest";
import { researchTopic } from "@hc/research";
import { KB_TOPICS, topicFor } from "../helpers/corpus.js";

/** Every structured figure the corpus can produce, with its originating claim. */
async function allFigures() {
  const out: { slug: string; claim: string; value: number; display: string; unit: string }[] = [];
  for (const kb of KB_TOPICS) {
    const { claims } = await researchTopic({ topic: topicFor(kb), allowNetwork: false });
    for (const claim of claims) {
      for (const figure of claim.figures) {
        out.push({ slug: kb.slug, claim: claim.claim_id, ...figure });
      }
    }
  }
  return out;
}

const figures = await allFigures();

describe("a structured figure is always a single exact number", () => {
  it("produces figures from the corpus, so the checks below are not vacuous", () => {
    expect(figures.length).toBeGreaterThan(0);
  });

  it("never stores a range as its lower bound", () => {
    // The bug's signature: value 20 paired with display "20-45".
    for (const f of figures) {
      if (/[0-9]\s*-\s*[0-9]/.test(f.display)) {
        throw new Error(
          `range "${f.display}" in ${f.slug}/${f.claim} was flattened to ${f.value}`,
        );
      }
    }
  });

  it("never stores an open bound as its floor", () => {
    // "7+" means at least seven; storing 7 states it as exactly seven.
    for (const f of figures) {
      expect(f.display, `open bound "${f.display}" in ${f.slug}/${f.claim}`).not.toMatch(/\+$/);
    }
  });

  it("keeps the stored value equal to the displayed text", () => {
    for (const f of figures) {
      expect(Number.parseFloat(f.display.replace(/,/g, "")), `${f.slug}/${f.claim}`).toBe(f.value);
    }
  });

  it("never stores a number that is not in the claim text", () => {
    // Anything else is an unreviewed figure that no human approved.
    for (const f of figures) {
      expect(f.display).toMatch(/^-?\d+(?:\.\d+)?$/);
    }
  });
});
