// Grounding: the check that the spoken line still says what the claim said.
//
// This is the highest-value safety test in the repo. Every other gate in the
// pipeline (evidence level, citation, numeric plausibility) validates the claim
// as written in the knowledge base. None of them notice if a script rewrites
// "is associated with" into "will fix". Grounding is the only thing standing
// between a reviewed claim and an unreviewed sentence in the final video, so the
// tests below are written adversarially: each one tampers with a real generated
// script and asserts the pipeline refuses it.

import { describe, expect, it } from "vitest";
import { checkScript } from "@hc/factcheck";
import { writeScript } from "@hc/script";
import { asVerified, kbTopic, research } from "../helpers/corpus.js";

const TOPIC = "caffeine-and-the-brain";

interface Fixture {
  claims: Awaited<ReturnType<typeof research>>["claims"];
  sources: Awaited<ReturnType<typeof research>>["sources"];
  draft: ReturnType<typeof writeScript>;
  check: (draft: ReturnType<typeof writeScript>) => ReturnType<typeof checkScript>;
}

async function fixture(): Promise<Fixture> {
  const kb = kbTopic(TOPIC);
  const { claims, sources } = await research(kb);
  // Sources are forced verified so the citation gate cannot be what fails the
  // test; if grounding ever stops working, this must be the reason.
  const verified = asVerified(sources);
  const draft = writeScript(kb, "topic-fixture", { targetMs: 55_000 });
  return { claims, sources: verified, draft, check: (d) => checkScript(d, { claims, sources: verified }) };
}

function blockingCodes(result: ReturnType<typeof checkScript>): string[] {
  return [...new Set(result.findings.filter((f) => f.blocking).map((f) => f.code))];
}

describe("grounding: the unmodified script must pass", () => {
  it("passes its own gates before any tampering", async () => {
    const f = await fixture();
    const result = f.check(f.draft);
    expect(blockingCodes(result)).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("grounding: tampered claims must be rejected", () => {
  it("rejects a hedged association hardened into a cure", async () => {
    const f = await fixture();
    const draft = structuredClone(f.draft);
    draft.lines[2]!.text = "Higher fibre intake cures constipation completely.";
    const result = f.check(draft);
    expect(result.ok).toBe(false);
  });

  it("rejects an invented dose figure", async () => {
    const f = await fixture();
    const draft = structuredClone(f.draft);
    draft.lines[1]!.text =
      "One 240 ml cup of brewed coffee contains roughly 195 mg of caffeine, while a 60 ml espresso contains about 63 mg.";
    const result = f.check(draft);
    expect(result.ok).toBe(false);
  });

  it("rejects a number deleted from a quantitative claim", async () => {
    const f = await fixture();
    const draft = structuredClone(f.draft);
    draft.lines[1]!.text = "A brewed coffee and an espresso contain caffeine in very different amounts.";
    const result = f.check(draft);
    expect(result.ok).toBe(false);
  });

  it("rejects a line swapped for unrelated content", async () => {
    const f = await fixture();
    const draft = structuredClone(f.draft);
    draft.lines[3]!.text = "Chickenpox is caused by a virus in the varicella-zoster family.";
    const result = f.check(draft);
    expect(result.ok).toBe(false);
  });

  it("rejects absolute certainty added to a probabilistic claim", async () => {
    const f = await fixture();
    const draft = structuredClone(f.draft);
    draft.lines[4]!.text = "Caffeine always prevents sleep no matter what time you drink it.";
    const result = f.check(draft);
    expect(result.ok).toBe(false);
  });

  it("rejects an unsupported efficacy superlative", async () => {
    const f = await fixture();
    const draft = structuredClone(f.draft);
    draft.lines[0]!.text = "Taking creatine daily will make you stronger than anyone who does not take it.";
    const result = f.check(draft);
    // The finding code is generic; the rule id is what identifies the problem.
    const rules = result.findings.filter((x) => x.blocking).map((x) => x.rule);
    expect(rules).toContain("superlative_claim");
    expect(result.ok).toBe(false);
  });
});

describe("grounding: normal speech adaptation must survive", () => {
  it("allows a dropped full stop", async () => {
    const f = await fixture();
    const draft = structuredClone(f.draft);
    draft.lines[0]!.text = draft.lines[0]!.text.replace(/\.$/, "");
    expect(f.check(draft).ok).toBe(true);
  });

  it("allows a hedge synonym swap", async () => {
    const f = await fixture();
    const draft = structuredClone(f.draft);
    draft.lines[1]!.text = draft.lines[1]!.text.replace("roughly", "about").replace("about about", "about");
    expect(f.check(draft).ok).toBe(true);
  });
});
