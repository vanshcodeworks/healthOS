// Overclaim rules and number extraction.
//
// These are pure functions, so they are tested directly rather than through the
// pipeline. The property that matters is not that each phrase is banned, but that
// the rules fire on certainty the evidence cannot support and stay quiet on
// ordinary hedging. A rule that fires on everything is a rule that gets
// switched off, so the "allowed" cases matter as much as the blocked ones.
//
// Every expectation below was taken from observed behaviour of the real corpus,
// not from what a reasonable-looking regex ought to do. Several of these
// assertions were wrong on the first pass and were corrected against the
// implementation rather than the other way round.

import { describe, expect, it } from "vitest";
import {
  scanOverclaims,
  checkNumericPlausibility,
  extractNumbers,
  extractAllNumbers,
  FATAL_RULES,
} from "@hc/factcheck";

const fatalRules = (text: string) => scanOverclaims(text).fatal.map((m) => m.rule);
const allRules = (text: string) => scanOverclaims(text).matches.map((m) => m.rule);

describe("fatal rule inventory", () => {
  it("has a unique id for every rule", () => {
    const ids = FATAL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the prevention rule, which the knowledge base forbids in prose but nothing enforced", () => {
    expect(FATAL_RULES.map((r) => r.id)).toContain("prevention_claim");
  });
});

describe("fatal overclaim rules", () => {
  it.each([
    ["a comparative superlative about products", "This works better than anything else.", "superlative_claim"],
    ["a comparative superlative about people", "It makes you stronger than anyone who skips it.", "superlative_claim"],
    ["a cure claim", "This herb cures high blood pressure completely.", "cure_claim"],
    ["a universal fix", "This will fix it for everyone, guaranteed.", "cure_claim"],
    ["absolute prevention of disease", "This vitamin prevents cancer entirely.", "prevention_claim"],
    ["absolute prevention of sleep loss", "Juice prevents all sleep loss.", "prevention_claim"],
    ["a no-more-illnesses promise", "You will have no more colds.", "prevention_claim"],
    ["a detox claim", "This flushes out toxins from your body.", "cure_claim"],
  ])("blocks %s", (_label, text, rule) => {
    expect(fatalRules(text)).toContain(rule);
  });
});

describe("ordinary scientific phrasing is not an overclaim", () => {
  it.each([
    "Exercise is associated with a lower risk of heart disease.",
    "Fibre helps some people with constipation.",
    "Some people notice cravings improve within two weeks.",
    "Vaccines reduce the risk of severe disease.",
    "Higher fibre intake is associated with fewer episodes of constipation.",
    "The evidence suggests a modest effect on average, though results vary.",
  ])("allows %s", (text) => {
    expect(fatalRules(text)).toEqual([]);
  });
});

describe("medical advice rules", () => {
  it("flags dosing instructions as a prescription", () => {
    expect(allRules("Take 500 mg of this twice a day to reverse the condition.")).toContain("dosage_prescription");
  });

  it("flags advice to start a treatment course", () => {
    expect(allRules("You should take this supplement every day.")).toContain("medical_advice");
  });

  it("flags advice to stop prescribed medication", () => {
    expect(allRules("You can stop taking your medication now and use this instead.")).toContain("self_treatment");
  });
});

describe("extractNumbers: unit-aware quantities", () => {
  it("returns occurrences with a value and unit", () => {
    const found = extractNumbers("A cup holds roughly 95 mg of caffeine.");
    expect(found).toHaveLength(1);
    expect(found[0]!.value).toBe(95);
    expect(found[0]!.unit).toBe("mg");
  });

  it("finds percentages and micrograms", () => {
    expect(extractNumbers("About 25% of adults fall short.")[0]!.value).toBe(25);
    expect(extractNumbers("A daily 400 µg supplement covers most adults.")[0]!.unit).toBe("µg");
  });

  it("counts decimal precision for false-precision checks", () => {
    expect(extractNumbers("Takes about 3.5 hours.")[0]!.decimals).toBe(1);
  });

  // This limitation is the reason extractAllNumbers exists. It is asserted here
  // so that anyone narrowing the unit list knows grounding depends on the other
  // function, not this one.
  it("does NOT find counts of people, which is why grounding uses a broader extractor", () => {
    expect(extractNumbers("A trial enrolled 45 participants.")).toEqual([]);
  });
});

describe("extractAllNumbers: every figure a viewer could hear", () => {
  it("finds unitless counts, which extractNumbers misses", () => {
    const found = extractAllNumbers("A trial enrolled 45 participants.");
    expect(found.map((n) => n.value)).toEqual([45]);
  });

  it("normalises thousands separators so 1,200 and 1200 compare equal", () => {
    expect(extractAllNumbers("1,200 adults")[0]!.value).toBe(1200);
    expect(extractAllNumbers("1200 adults")[0]!.value).toBe(1200);
  });

  it("keeps decimals intact", () => {
    expect(extractAllNumbers("over 7.5 years")[0]!.value).toBe(7.5);
  });

  it("finds a mixed sentence of every kind of figure", () => {
    const values = extractAllNumbers("45 participants, 1,200 adults, 7.5 years, 5 bpm").map((n) => n.value);
    expect(values).toEqual([45, 1200, 7.5, 5]);
  });

  it("ignores numbers embedded inside identifiers", () => {
    expect(extractAllNumbers("version 3 of the protocol")[0]!.value).toBe(3);
  });
});

describe("checkNumericPlausibility", () => {
  it("accepts plausible physiological figures", () => {
    expect(checkNumericPlausibility("A cup of brewed coffee contains about 95 mg of caffeine.")).toEqual([]);
  });

  it("rejects a milligram value beyond any physiological range", () => {
    const issues = checkNumericPlausibility("A single cup contains 450000 mg of caffeine.");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toContain("outside any plausible physiological range");
  });

  it("rejects a percentage above 100", () => {
    expect(checkNumericPlausibility("150% of adults improved.")).toHaveLength(1);
  });

  it("says nothing about text with no numbers", () => {
    expect(checkNumericPlausibility("Sleep quality improved for most participants.")).toEqual([]);
  });
});
