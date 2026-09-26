import { checkMedicalSafety, evaluateGates, verifyScript, type Finding, type GateOutcome, type SafetyVerdict, type VerifyResult } from "./index.js";
import { buildConnectiveCorpus, groundConnective, groundLine, type GroundingOptions } from "./grounding.js";
import type { ScriptDraft } from "@hc/script";
import type { Claim, Source } from "@hc/schemas";

/**
 * The bridge from a drafted script to the gate.
 *
 * Every spoken line is attributed to the reviewed claim it came from, so a
 * narration line that no longer matches its claim fails the gate instead of
 * quietly shipping a claim stronger than the evidence supports.
 */

export interface CheckScriptOptions {
  claims: Claim[];
  sources: Source[];
  requireVerifiedSources?: boolean;
  minVerifiedRatio?: number;
  grounding?: GroundingOptions;
  minDistinctSources?: number;
}

export interface ScriptCheck {
  verify: VerifyResult;
  safety: SafetyVerdict;
  gate: GateOutcome;
  totalCitations: number;
  verifiedCitations: number;
  distinctSources: number;
  findings: Finding[];
  ok: boolean;
  /** Lines the writer produced that no reviewed claim backs. */
  orphanLines: string[];
}

export function checkScript(draft: ScriptDraft, options: CheckScriptOptions): ScriptCheck {
  const byClaimId = new Map(options.claims.map((c) => [c.claim_id, c]));
  const sourcesById = new Map(options.sources.map((s) => [s.source_id, s]));
  const requireVerified = options.requireVerifiedSources ?? true;

  const orphans: string[] = [];

  const grounding: Finding[] = [];
  // Connective lines draw on the topic's reviewed material as a whole, so the
  // corpus is built once and shared.
  const connectiveCorpus = buildConnectiveCorpus(options.claims);
  const lines = draft.lines.map((line) => {
    const claim = line.claim_id ? byClaimId.get(line.claim_id) : undefined;
    // The hook, CTA and disclaimer are connective tissue, not health claims. They
    // are checked for overclaiming and safety, but are not required to carry a
    // citation; counting them as unsupported would make the gate unusable.
    const connective = !line.claim_id;
    if (connective) orphans.push(line.beat_id);
    const support = claim ? claim.support.map((id) => sourcesById.get(id)).filter((s): s is Source => Boolean(s)) : [];
    // Grounding runs on the spoken words, not on the claim's metadata. A claim id
    // on a line proves nothing about what the line actually says.
    if (claim) grounding.push(...groundLine(line.text, claim, options.grounding ?? {}).findings);
    // Connective lines carry no claim to match, so they are grounded against every
    // reviewed claim for the topic instead. Without this they are unchecked, which
    // is how a quantitative recommendation reached the audience unreviewed.
    else grounding.push(...groundConnective(line.text, connectiveCorpus, options.grounding ?? {}).findings);
    return {
      line_id: line.beat_id,
      text: line.text,
      ...(line.claim_id ? { claim_id: line.claim_id } : {}),
      connective,
      support_count: support.length,
      evidence_level: claim?.evidence_level ?? "unrated",
      ...(claim ? { claim_type: claim.claim_type } : {}),
      confidence: claim?.confidence ?? 0,
      verified_sources: support.filter((s) => s.verified).length,
    };
  });

  const verify = verifyScript(lines, { requireVerifiedSources: requireVerified });
  // Grounding findings are part of verification: a drifted line is a citation
  // that points at something the video does not say.
  verify.findings = [...verify.findings, ...grounding];
  verify.blocking = verify.findings.filter((f) => f.blocking).length;
  verify.warnings = verify.findings.filter((f) => f.severity === "warning").length;

  const safety = checkMedicalSafety(
    draft.lines.map((l) => l.text),
    { requireReferral: true },
  );

  const substantive = lines.filter((l) => !orphans.includes(l.line_id));
  const totalCitations = substantive.reduce((sum, l) => sum + l.support_count, 0);
  const verifiedCitations = substantive.reduce((sum, l) => sum + l.verified_sources, 0);
  // Count only the sources the script actually leans on. Counting every source
  // attached to every candidate claim would let a script buy a passing grade
  // with citations it never made.
  const distinctSources = new Set<string>();
  for (const line of substantive) {
    for (const id of byClaimId.get(line.claim_id ?? "")?.support ?? []) {
      const source = sourcesById.get(id);
      if (source) distinctSources.add(source.source_id);
    }
  }

  const gate = evaluateGates(
    {
      texts: draft.lines.map((l) => l.text),
      verify,
      safety,
      verifiedCitations,
      totalCitations,
      distinctSources: distinctSources.size,
      ...(options.minVerifiedRatio !== undefined ? { minVerifiedRatio: options.minVerifiedRatio } : {}),
      ...(options.minDistinctSources !== undefined ? { minDistinctSources: options.minDistinctSources } : {}),
    },
    { requireVerifiedSources: requireVerified },
  );

  return {
    verify,
    safety,
    gate,
    totalCitations,
    verifiedCitations,
    distinctSources: distinctSources.size,
    findings: gate.findings,
    ok: gate.passed,
    orphanLines: orphans,
  };
}


