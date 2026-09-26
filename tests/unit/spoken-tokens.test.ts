// Narration length is a timing input, not a word count.
//
// A caption window sized from whitespace-delimited words desynchronises from the
// voice as soon as a number appears, because "240 ml" is four spoken words and
// "95 mg" is three. These tests pin the spoken expansion, since every scene
// window downstream is derived from it.

import { describe, expect, it } from "vitest";
import { estimateSpeechMs, spokenTokenCount } from "@hc/core";

describe("spokenTokenCount", () => {
  it("counts plain prose as words", () => {
    expect(spokenTokenCount("Caffeine blocks adenosine receptors.")).toBe(4);
  });

  it("spells out a number and its unit", () => {
    expect(spokenTokenCount("95 mg")).toBe(3);
    expect(spokenTokenCount("240 ml")).toBe(4);
  });

  it("expands thousands separators instead of reading the comma", () => {
    expect(spokenTokenCount("1,200 mg")).toBe(5);
  });

  it("expands decimals as spoken digits", () => {
    expect(spokenTokenCount("0.5 g")).toBe(5);
  });

  it("expands a percentage", () => {
    expect(spokenTokenCount("10%")).toBe(2);
  });

  it("reads a range as two numbers and the bound, not one value", () => {
    // "5-6 hours" is said as "five to six hours". Collapsing it to a single
    // number is how a range silently became an exact figure in this corpus.
    expect(spokenTokenCount("5-6 hours")).toBe(3);
  });

  it("expands spoken initialisms", () => {
    expect(spokenTokenCount("ATP")).toBe(3);
  });

  it("returns zero for text that is only punctuation", () => {
    expect(spokenTokenCount("... --")).toBe(0);
  });
});

describe("estimateSpeechMs", () => {
  it("treats a number-heavy line as longer than its word count", () => {
    const written = "95 mg at 240 ml is about 10% of the total";
    const spoken = spokenTokenCount(written);
    const words = written.split(/\s+/).length;
    expect(spoken).toBeGreaterThan(words);
  });

  it("is zero for an empty line", () => {
    expect(estimateSpeechMs("")).toBe(0);
  });

  it("scales linearly with spoken length", () => {
    const one = estimateSpeechMs("Caffeine blocks adenosine receptors in the brain.");
    const two = estimateSpeechMs(
      "Caffeine blocks adenosine receptors in the brain. Caffeine blocks adenosine receptors in the brain.",
    );
    expect(two).toBeCloseTo(one * 2, 5);
  });

  it("lands within a quarter of the measured rate for a short line", () => {
    // Calibrated against Microsoft Zira at 165 WPM; wide enough to catch a
    // regression to whitespace counting, tight enough to catch unit breakage.
    const text = "General education, not medical advice. Talk to your doctor before changing anything.";
    const seconds = estimateSpeechMs(text) / 1000;
    expect(seconds).toBeGreaterThan(3);
    expect(seconds).toBeLessThan(6);
  });
});
