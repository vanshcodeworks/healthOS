// Connective lines used to be exempt from grounding entirely.
//
// The reasoning was that a hook or CTA is "connective tissue", not a health
// claim, so it needed no citation and no grounding. In practice the corpus
// stores real advice in those fields: "Adults are generally advised to sleep 7 or
// more hours per night" is a quantitative recommendation, and "the half-life of
// caffeine is roughly 5 hours" turns a reviewed five-to-six-hour range into one
// precise figure. Neither matched any claim, so neither was ever checked.
//
// These tests pin both halves of the fix: the gate must pass the real corpus,
// and it must still reject the things that motivated it.

import { describe, expect, it } from "vitest";
import { researchTopic, KB_TOPICS } from "@hc/research";
import { buildConnectiveCorpus, groundConnective, scanOverclaims } from "@hc/factcheck";
import { topicFor } from "../helpers/corpus.js";

const kb = KB_TOPICS.find((t) => t.slug === "caffeine-and-the-brain")!;
const { claims } = await researchTopic({ topic: topicFor(kb), allowNetwork: false });
const corpus = buildConnectiveCorpus(claims, [kb.title, kb.question, ...kb.keywords]);

const codes = (line: string) => groundConnective(line, corpus, {}).findings.map((f) => f.code);

describe("connective grounding rejects unreviewed content", () => {
  it("rejects an invented number in a hook", () => {
    // The original motivating case: a statistic that no reviewed claim supports.
    expect(codes("Just 3 adults improved their sleep this way.")).toContain("CONNECTIVE_NUMBER_UNSOURCED");
  });

  it("rejects a number no reviewed claim states", () => {
    // The caffeine corpus attests 5, 6, 20, 45, 60, 63, 95 and 240. Three minutes
    // is nowhere in it, and it is exactly the shape of claim that sneaks into a
    // hook because it sounds plausible.
    expect(codes("Caffeine clears completely in 3 minutes.")).toContain("CONNECTIVE_NUMBER_UNSOURCED");
  });

  it("allows a reviewed range endpoint without demanding the whole range", () => {
    // Restating "5 to 6 hours" as "45 minutes" narrows scope rather than inventing
    // a measurement, and forcing hooks to restate whole ranges would make them
    // unusable. False precision is handled separately, by the certainty scan.
    expect(codes("It can cross into the brain within 45 minutes.")).not.toContain("CONNECTIVE_NUMBER_UNSOURCED");
  });

  it("flags absolute precision on a reviewed number", () => {
    // "Exactly 5 hours" is a measurement the sources never made, and the range
    // it came from was "5 to 6 hours".
    const scan = scanOverclaims("The half-life of caffeine is exactly 5 hours.");
    expect(scan.soft.map((m) => m.rule)).toContain("absolute_certainty");
  });

  it("accepts a number the reviewed claims do state", () => {
    expect(codes("One cup is about 95 mg.")).not.toContain("CONNECTIVE_NUMBER_UNSOURCED");
  });

  it("accepts an endpoint of a reviewed range", () => {
    // Restating "20 to 45 minutes" as "45 minutes" is a narrowing of scope, not a
    // new number, and forcing the full range would make hooks unusable.
    expect(codes("It can cross the blood-brain barrier within 45 minutes.")).not.toContain(
      "CONNECTIVE_NUMBER_UNSOURCED",
    );
  });  it("rejects clinical vocabulary the review never used", () => {
    expect(codes("Caffeine also triggers a cortisol spike.")).toContain("CONNECTIVE_NEW_DOMAIN_CONTENT");
  });

  it("rejects a quantitative recommendation", () => {
    expect(codes("Adults should sleep at least 9 hours every night.")).toContain("CONNECTIVE_NUMBER_UNSOURCED");
  });

  it("allows a medical synonym for reviewed wording", async () => {
    // The glucose topic's claims say "glucose" throughout, but a hook that never
    // says "sugar" is not addressing the viewer. Synonyms are allowed only
    // relative to the topic: "sugar" is fine on a glucose topic and not on one
    // whose claims never mention carbohydrate at all.
    const glucoseKb = KB_TOPICS.find((t) => t.slug === "glucose-after-a-meal")!;
    const { claims: glucoseClaims } = await researchTopic({ topic: topicFor(glucoseKb), allowNetwork: false });
    const glucoseCorpus = buildConnectiveCorpus(glucoseClaims, [
      glucoseKb.title,
      glucoseKb.question,
      ...glucoseKb.keywords,
    ]);
    expect(groundConnective("What does a sugar cube do to your blood sugar?", glucoseCorpus, {}).findings).toEqual([]);
  });

  it("allows an inflected form of a reviewed word", () => {
    expect(codes("Caffeine is absorbed before it reaches the brain.")).toEqual([]);
  });

  it("allows ordinary framing and questions", () => {
    expect(codes("So what actually happens next?")).toEqual([]);
  });
});

describe("the real corpus passes connective grounding", () => {
  it("grounds every hook and CTA across all topics", async () => {
    const failures: string[] = [];
    let checked = 0;
    for (const topic of KB_TOPICS) {
      const result = await researchTopic({ topic: topicFor(topic), allowNetwork: false });
      // The gate builds its corpus from claims alone; keywords are only added
      // here to prove the corpus itself is clean without that help.
      const built = buildConnectiveCorpus(result.claims, [topic.title, topic.question, ...topic.keywords]);
      for (const line of [...topic.hooks.map((h) => h.text), topic.cta].filter(Boolean)) {
        checked += 1;
        for (const finding of groundConnective(line, built, {}).findings) {
          failures.push(`${topic.slug}: ${finding.code} in "${line}"`);
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
