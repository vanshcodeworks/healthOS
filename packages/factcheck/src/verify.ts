import {
  evidenceRank,
  PRECISE_QUANTITY_FLOOR,
  CAUSAL_DESIGN,
  MECHANISM_CAUSAL_FLOOR,
  EFFECT_CLAIM_TYPES,
} from "./evidence-levels.js";
import { extractNumbers, scanOverclaims } from "./overclaim.js";

/**
 * Claim verification.
 *
 * Two independent questions are asked of every line the narrator will speak:
 *
 *   1. Is it supported?  A claim needs a citation whose evidence level is at
 *      least as strong as the sentence's own claim type, and the sentence may
 *      not be more confident than that evidence.
 *   2. Is it safe?       Independent of support, the wording must not give
 *      medical advice, prescribe, claim a cure, or assert an absolute.
 *
 * A line can pass the first and fail the second, and vice versa. Both must pass.
 */

export type Severity = "error" | "warning" | "info";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  /** The text that triggered the finding. */
  excerpt?: string;
  /** Where a human should look. */
  location?: string;
  hint?: string;
  /** Offending rule, for overclaim findings. */
  rule?: string;
  blocking: boolean;
}

export interface LineVerification {
  line_id: string;
  text: string;
  claim_id?: string;
  support_count: number;
  evidence_level: string;
  confidence: number;
  findings: Finding[];
  ok: boolean;
}

export interface VerifyOptions {
  /** IDs of the claims that back this script. */
  supportedClaimIds?: string[];
  /** Treat unverified citations as blocking. Off in local preview runs. */
  requireVerifiedSources?: boolean;
  /** Evidence level below which causal verbs are rejected. */
  allowCausalLanguage?: boolean;
}

export interface VerifyResult {
  lines: LineVerification[];
  findings: Finding[];
  ok: boolean;
  blocking: number;
  warnings: number;
  /** Aggregate evidence strength across the script. */
  weakest_evidence: string;
  summary: string;
}

const CAUSAL_VERBS =
  /\b(causes?|caused|causing|leads? to|led to|results? in|resulting in|triggers?|drives?)\b/i;
const HEDGES = /\b(may|might|could|can|is associated with|are associated with|linked to|tends? to|appears? to|likely|probably|roughly|about|approximately|on average|in most cases|in the studies? reviewed|suggests?)\b/i;

/**
 * Causal verbs are only honest when the design can support them, and the bar
 * depends on what the sentence is about. A mechanism sentence ("a nerve signal
 * triggers calcium release") is describing established physiology and only needs
 * a reviewed physiological source. An effect sentence ("this causes anxiety") is
 * making a health claim about a viewer and needs a design that tested it.
 */
function causalLanguageAllowed(evidence: string, claimType: string | undefined, allowCausalLanguage: boolean): boolean {
  if (allowCausalLanguage) return true;
  if (claimType && EFFECT_CLAIM_TYPES.includes(claimType)) {
    return CAUSAL_DESIGN.includes(evidence as (typeof CAUSAL_DESIGN)[number]);
  }
  return evidenceRank(evidence as never) >= evidenceRank(MECHANISM_CAUSAL_FLOOR);
}

export function verifyLine(
  input: {
    line_id: string;
    text: string;
    claim_id?: string;
    support_count: number;
    evidence_level: string;
    confidence: number;
    verified_sources?: number;
    /** Drives the causal-language bar: mechanism vs effect. */
    claim_type?: string;
    /**
     * A connective line (hook, CTA, disclaimer) carries no health claim, so
     * support and evidence-level checks do not apply. Overclaim, safety and
     * numeric checks still do: a CTA that promises an outcome is still a defect.
     */
    connective?: boolean;
  },
  options: VerifyOptions = {},
): LineVerification {
  const findings: Finding[] = [];
  const { text } = input;
  const connective = input.connective === true;

  // 1. Support.
  if (!connective && input.support_count === 0) {
    findings.push({
      code: "UNSUPPORTED_CLAIM",
      severity: "error",
      message: "This sentence has no citation behind it.",
      excerpt: text,
      location: input.line_id,
      hint: "Attach a claim id from research, or cut the sentence.",
      blocking: true,
    });
  } else if (!connective && options.requireVerifiedSources && (input.verified_sources ?? 0) === 0) {
    findings.push({
      code: "UNVERIFIED_SOURCE",
      severity: "error",
      message: "Every citation behind this sentence is unverified.",
      excerpt: text,
      location: input.line_id,
      hint: "Run source verification, or mark the video as an offline draft.",
      blocking: true,
    });
  }

  // 2. Confidence must not exceed evidence.
  if (!connective && input.evidence_level === "unrated") {
    findings.push({
      code: "UNRATED_EVIDENCE",
      severity: "error",
      message: "Evidence level is unrated, so the narration cannot state this as fact.",
      excerpt: text,
      location: input.line_id,
      blocking: true,
    });
  }

  const causal = CAUSAL_VERBS.test(text);
  if (causal && !causalLanguageAllowed(evidenceOf(connective, input.evidence_level), input.claim_type, options.allowCausalLanguage ?? false)) {
    findings.push({
      code: "CAUSAL_OVERREACH",
      severity: "error",
      message: `Causal wording ("${matchVerb(text)}") but the evidence is ${evidenceOf(connective, input.evidence_level)}. Observational evidence supports association only.`,
      excerpt: text,
      location: input.line_id,
      hint: "Rewrite as an association, or cite a stronger design.",
      rule: "unqualified_causation",
      blocking: true,
    });
  }

  // 3. Quantities need a strong enough source to be stated precisely.
  const numbers = extractNumbers(text);
  for (const number of numbers) {
    if (number.decimals >= 2 && evidenceRank(evidenceOf(connective, input.evidence_level) as never) < evidenceRank(PRECISE_QUANTITY_FLOOR)) {
      findings.push({
        code: "FALSE_PRECISION",
        severity: "warning",
        message: `"${number.text}" states two decimal places from ${evidenceOf(connective, input.evidence_level)} evidence.`,
        excerpt: text,
        location: input.line_id,
        hint: "Round to one decimal or say \"about\".",
        blocking: false,
      });
    }
  }

  // 4. Overclaims and safety, independent of support.
  const scan = scanOverclaims(text);
  for (const match of scan.fatal) {
    findings.push({
      code: "UNSAFE_CLAIM",
      severity: "error",
      message: match.message,
      excerpt: match.text,
      location: input.line_id,
      hint: "This cannot be reworded into something publishable. Change the claim.",
      rule: match.rule,
      blocking: true,
    });
  }
  for (const match of scan.soft) {
    // A soft rule that the evidence genuinely supports is not a finding. A hedge
    // is still required even when causal wording is allowed, because "causes"
    // asserted flatly about a study population is still an overstatement.
    if (match.rule === "unqualified_causation" || match.rule === "efficacy_guarantee") {
      const allowed = causalLanguageAllowed(
        evidenceOf(connective, input.evidence_level),
        input.claim_type,
        options.allowCausalLanguage ?? false,
      );
      if (allowed && (HEDGES.test(text) || connective)) continue;
    }
    if (match.rule === "absolute_certainty" && /\b(in most cases|except|no cases|none of|not always|never in)\b/i.test(text)) {
      continue;
    }
    findings.push({
      code: "OVERCLAIM",
      severity: "warning",
      message: match.message,
      excerpt: match.text,
      location: input.line_id,
      ...(match.suggestion ? { hint: `Consider: "${match.suggestion}".` } : {}),
      rule: match.rule,
      blocking: false,
    });
  }
  for (const issue of scan.implausibleNumbers) {
    findings.push({
      code: "IMPLAUSIBLE_NUMBER",
      severity: "error",
      message: `Implausible quantity: ${issue.reason}`,
      excerpt: issue.occurrence.text,
      location: input.line_id,
      hint: "Check the number against its citation. Invented statistics fail here.",
      blocking: true,
    });
  }

  // 5. A hedged sentence with no hedge word but a confident verb, in a short,
  //    is the pattern that reads as hype. Only flag when the line is short
  //    enough that the writer clearly had no room to hedge.
  if (input.confidence < 0.4 && !HEDGES.test(text) && !connective && input.evidence_level !== "unrated") {
    findings.push({
      code: "HEDGE_MISSING",
      severity: "warning",
      message: `Low confidence (${input.confidence}) with no hedging language.`,
      excerpt: text,
      location: input.line_id,
      hint: "Add \"may\", \"is associated with\", or \"in most cases\".",
      blocking: false,
    });
  }

  return {
    line_id: input.line_id,
    text,
    ...(input.claim_id ? { claim_id: input.claim_id } : {}),
    support_count: connective ? 0 : input.support_count,
    evidence_level: input.evidence_level,
    confidence: input.confidence,
    findings,
    ok: findings.every((f) => !f.blocking),
  };
}

/**
 * A connective line is judged as if it had the strongest possible backing, since
 * it is a framing sentence rather than a finding. This only affects the wording
 * checks; support and evidence-level checks skip connective lines entirely.
 */
function evidenceOf(connective: boolean, level: string): string {
  return connective ? "meta_analysis" : level;
}

function matchVerb(text: string): string {
  const match = CAUSAL_VERBS.exec(text);
  return match?.[0] ?? "";
}

export function verifyScript(
  lines: Parameters<typeof verifyLine>[0][],
  options: VerifyOptions = {},
): VerifyResult {
  const connectiveIds = new Set(lines.filter((l) => l.connective).map((l) => l.line_id));
  const verified = lines.map((line) => verifyLine(line, options));
  const findings = verified.flatMap((v) => v.findings);
  const blocking = findings.filter((f) => f.blocking).length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  // Connective lines carry no evidence, so including them would report every
  // script's weakest evidence as "unrated" and hide the real floor.
  const substantive = verified.filter((v) => !connectiveIds.has(v.line_id));
  const levels = substantive.map((v) => v.evidence_level);
  const weakest =
    levels.length === 0
      ? "unrated"
      : levels.reduce((a, b) => (evidenceRank(a as never) <= evidenceRank(b as never) ? a : b));
  const ok = verified.every((v) => v.ok);
  return {
    lines: verified,
    findings,
    ok,
    blocking,
    warnings,
    weakest_evidence: weakest,
    summary: ok
      ? `${verified.length} lines checked, ${warnings} wording note(s), weakest evidence ${weakest}.`
      : `${blocking} blocking issue(s) across ${verified.length} lines.`,
  };
}

