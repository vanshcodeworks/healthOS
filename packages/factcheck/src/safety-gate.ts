import { scanOverclaims } from "./overclaim.js";
import type { Finding, VerifyOptions, VerifyResult } from "./verify.js";

/**
 * Medical safety gate.
 *
 * Separate from claim verification on purpose. A video can be perfectly cited
 * and still be unsafe, and an unsafe video is not repairable by rewording, so
 * this gate has a distinct, non-overridable veto.
 */

export interface SafetyIssue {
  code: string;
  message: string;
  excerpt?: string;
  location?: string;
  /** A veto cannot be waived by configuration. */
  veto: boolean;
}

export interface SafetyVerdict {
  safe: boolean;
  /** True when a veto was triggered: publishing is forbidden regardless of QA. */
  vetoed: boolean;
  issues: SafetyIssue[];
  /** Advice a viewer should be pointed to, e.g. to see a clinician. */
  referral_present: boolean;
  notes: string[];
}

/**
 * Statements that must be paired with a "consult a professional" pointer.
 * Recognising them prevents the medical-advice rule from firing on safe
 * educational phrasing that happens to name a symptom.
 */
const CLINICAL_REFERRAL =
  /\b(consult (?:your|a) (?:doctor|gp|clinician|physician|dietitian|pharmacist|specialist|healthcare (?:provider|professional))|talk to your doctor|speak to (?:your|a) doctor|see your doctor|ask a (?:doctor|pharmacist|dietitian)|with your doctor'?s? (?:guidance|advice)|under medical (?:guidance|supervision)|if (?:you are|this) (?:pregnant|breastfeeding|on medication|taking medication)|do not (?:stop|change) (?:your )?(?:medication|treatment))\b/i;

/** Phrases that are only safe inside a claim explicitly marked as a disclaimer. */
const DISCLAIMER_CONTEXT =
  /\b(do not (?:stop|replace|change)(?: taking)? (?:your )?(?:medication|treatment|insulin|statins?)|talk to (?:your|a) doctor|consult (?:your|a) (?:doctor|clinician|pharmacist)|not medical advice|educational purposes only|individual results may vary|under medical (?:guidance|supervision))\b/i;

export interface SafetyOptions {
  /** Require a professional-referral or disclaimer somewhere in the script. */
  requireReferral?: boolean;
}

export function checkMedicalSafety(texts: string[], options: SafetyOptions = {}): SafetyVerdict {
  const issues: SafetyIssue[] = [];
  const notes: string[] = [];
  let referralPresent = false;

  texts.forEach((text, index) => {
    const location = `line:${index + 1}`;
    if (DISCLAIMER_CONTEXT.test(text)) referralPresent = true;
    if (CLINICAL_REFERRAL.test(text)) referralPresent = true;

    const scan = scanOverclaims(text);
    const isDisclaimer = DISCLAIMER_CONTEXT.test(text);
    for (const match of scan.fatal) {
      // "Do not stop taking your medication without talking to your doctor" is
      // the opposite of self-treatment advice, and "consult your doctor before
      // taking" is a referral. Both rules must stand down inside an explicit
      // disclaimer, or the gate would punish the safest line in the script.
      if (isDisclaimer && (match.rule === "medical_advice" || match.rule === "self_treatment")) continue;
      issues.push({
        code: `SAFETY_${match.rule.toUpperCase()}`,
        message: match.message,
        excerpt: match.text,
        location,
        veto: match.rule !== "medical_advice",
      });
    }
    for (const number of scan.implausibleNumbers) {
      issues.push({
        code: "SAFETY_IMPLAUSIBLE_NUMBER",
        message: `Implausible quantity: ${number.reason}`,
        excerpt: number.occurrence.text,
        location,
        veto: true,
      });
    }
  });

  if (options.requireReferral && !referralPresent) {
    notes.push(
      "No professional-referral or medication disclaimer found. If the script touches medication, pregnancy, or a diagnosed condition, add one.",
    );
  }

  const vetoed = issues.some((i) => i.veto);
  return {
    safe: issues.length === 0,
    vetoed,
    issues,
    referral_present: referralPresent,
    notes,
  };
}

export interface GateInput {
  /** Narration text per line, in order. */
  texts: string[];
  verify: VerifyResult;
  safety: SafetyVerdict;
  /** Minimum verified-citation ratio, 0..1. */
  minVerifiedRatio?: number;
  verifiedCitations: number;
  totalCitations: number;
  /** Distinct sources cited. */
  distinctSources: number;
  minDistinctSources?: number;
}

export interface GateOutcome {
  passed: boolean;
  /** Hard veto: publishing forbidden, not merely retried. */
  vetoed: boolean;
  findings: Finding[];
  notes: string[];
  checked: {
    lines: number;
    citations: number;
    verified_citations: number;
    verified_ratio: number;
    distinct_sources: number;
    weakest_evidence: string;
  };
}

export interface GateOptions extends VerifyOptions, SafetyOptions {
  minVerifiedRatio?: number;
  minDistinctSources?: number;
}

/**
 * The pre-render gate. A video may only proceed to rendering when this passes.
 */
export function evaluateGates(input: GateInput, options: GateOptions = {}): GateOutcome {
  const notes = [...input.safety.notes];
  const ratio = input.totalCitations === 0 ? 0 : input.verifiedCitations / input.totalCitations;
  const minRatio = options.minVerifiedRatio ?? 0.6;
  const minSources = options.minDistinctSources ?? 2;

  if (input.totalCitations === 0) {
    notes.push("No citations at all. A health video with no sources cannot pass.");
  }
  if (ratio < minRatio) {
    notes.push(`Only ${Math.round(ratio * 100)}% of citations verified; ${Math.round(minRatio * 100)}% required.`);
  }
  if (input.distinctSources < minSources) {
    notes.push(`Only ${input.distinctSources} distinct source(s); ${minSources} required.`);
  }

  const citationFindings: Finding[] = [
    ...(input.totalCitations === 0
      ? [
          {
            code: "NO_CITATIONS",
            severity: "error" as const,
            message: "Script cites no sources.",
            blocking: true,
          },
        ]
      : []),
    ...(ratio < minRatio
      ? [
          {
            code: "LOW_VERIFIED_RATIO",
            severity: "error" as const,
            message: `Verified citation ratio ${ratio.toFixed(2)} below ${minRatio}.`,
            blocking: true,
          },
        ]
      : []),
    ...(input.distinctSources < minSources
      ? [
          {
            code: "THIN_SOURCE_BASE",
            severity: "error" as const,
            message: `Only ${input.distinctSources} distinct sources cited (${minSources} required).`,
            blocking: true,
          },
        ]
      : []),
  ];

  const findings = [...input.verify.findings, ...citationFindings];
  const safetyFindings: Finding[] = input.safety.issues.map((issue) => ({
    code: issue.code,
    severity: "error" as const,
    message: issue.message,
    ...(issue.excerpt ? { excerpt: issue.excerpt } : {}),
    ...(issue.location ? { location: issue.location } : {}),
    blocking: true,
  }));

  const all = [...findings, ...safetyFindings];
  const passed = all.every((f) => !f.blocking) && !input.safety.vetoed;

  return {
    passed,
    vetoed: input.safety.vetoed,
    findings: all,
    notes,
    checked: {
      lines: input.texts.length,
      citations: input.totalCitations,
      verified_citations: input.verifiedCitations,
      verified_ratio: Number(ratio.toFixed(3)),
      distinct_sources: input.distinctSources,
      weakest_evidence: input.verify.weakest_evidence,
    },
  };
}


