// Regressions for two safety holes found by writing adversarial tests.
//
// Both of these were live bugs, not hypotheticals. They are pinned here so that
// a future "simplification" of the number extractor or the overclaim rules cannot
// silently reopen them.
//
// 1. A unitless count ("a trial of 240 participants") was invisible to the
//    number check, because the extractor only recognised numbers that carry a
//    known unit. Changing 240 to 24 therefore passed every gate: the trigram
//    similarity stays high when one token in fourteen changes, and the number
//    was never extracted in the first place. Inventing a sample size is one of
//    the easiest ways to make a study sound more convincing than it is.
//
// 2. Absolute prevention language was not a rule at all, even though the
//    knowledge base lists "prevents diabetes entirely" and "prevents all sleep"
//    as reviewer-forbidden phrasings. Reviewer intent that no code enforces is
//    just a wish.

import { describe, expect, it } from "vitest";
import { groundLine, scanOverclaims } from "@hc/factcheck";
import type { Claim } from "@hc/schemas";

const REVIEWED_CLAIM = {
  claim_id: "c_fibre_trial",
  text: "In a trial of 240 participants, higher fibre intake was associated with fewer constipation episodes.",
  claim_type: "association",
  evidence_level: "rct",
  hedge_required: true,
  permitted_phrasing: [],
  forbidden_phrasing: [],
} as unknown as Claim;

const withCount = (n: string) =>
  `In a trial of ${n} participants, higher fibre intake was associated with fewer constipation episodes.`;

const blockingCodes = (text: string) =>
  groundLine(text, REVIEWED_CLAIM).findings.filter((f) => f.blocking).map((f) => f.code);

describe("regression: a unitless count must be treated as a figure", () => {
  it("allows the count the reviewer actually approved", () => {
    expect(blockingCodes(withCount("240"))).toEqual([]);
  });

  it.each(["24", "2400", "1,200", "0"])("blocks an invented count of %s", (n) => {
    expect(blockingCodes(withCount(n))).toContain("GROUNDING_UNAPPROVED_NUMBER");
  });

  it("blocks silently dropping the count altogether", () => {
    const dropped =
      "Higher fibre intake was associated with fewer constipation episodes in that trial.";
    expect(blockingCodes(dropped)).toContain("GROUNDING_NUMBER_DROPPED");
  });

  it("blocks dropping the figure while keeping the wording", () => {
    const text = "A single trial found a link with no sample size given.";
    const findings = groundLine(text, REVIEWED_CLAIM).findings;
    expect(findings.some((f) => f.blocking)).toBe(true);
  });
});

describe("regression: prevention language the knowledge base forbids", () => {
  // These exact phrasings appear in the corpus's own forbidden_phrasing lists.
  it.each([
    "This prevents diabetes entirely.",
    "This prevents all sleep.",
    "This prevents cancer completely.",
    "You will have no more colds.",
  ])("blocks %s", (text) => {
    expect(scanOverclaims(text).fatal.map((m) => m.rule)).toContain("prevention_claim");
  });

  it("still allows ordinary risk-reduction phrasing", () => {
    for (const text of [
      "Higher fibre intake is associated with a lower risk of constipation.",
      "Vaccination reduces the risk of severe disease.",
      "Strength training is linked to better bone density.",
    ]) {
      expect(scanOverclaims(text).fatal).toEqual([]);
    }
  });
});
