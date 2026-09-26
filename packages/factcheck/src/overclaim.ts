/**
 * Overclaim detection.
 *
 * The rule this module exists to enforce: a video must never be more certain
 * than its weakest cited source. Detecting that requires more than a keyword
 * list, so each detector returns the phrase it objected to, why it is a
 * problem, and the weakest phrasing the evidence actually permits.
 */

export interface OverclaimMatch {
  /** The offending fragment, as written. */
  text: string;
  /** Character offset in the input, for highlighting in the dashboard. */
  start: number;
  end: number;
  rule: OverclaimRuleId;
  message: string;
  /** Replacement phrasing, or undefined when no honest rewrite exists. */
  suggestion?: string;
}

export type OverclaimRuleId =
  | "absolute_certainty"
  | "universal_quantifier"
  | "guaranteed_outcome"
  | "unqualified_causation"
  | "cure_claim"
  | "prevention_claim"
  | "all_equals_some"
  | "medical_advice"
  | "self_treatment"
  | "dosage_prescription"
  | "pharmaceutical_claim"
  | "diagnostic_claim"
  | "population_overreach"
  | "superlative_claim"
  | "unverifiable_number"
  | "precision_without_source"
  | "efficacy_guarantee"
  | "fear_language"
  | "detox_language";

export interface OverclaimRule {
  id: OverclaimRuleId;
  pattern: RegExp;
  message: string;
  suggestion?: string;
  /** Rules that make a video unpublishable rather than merely requiring a reword. */
  fatal: boolean;
}

/**
 * Fatal rules describe content that is unsafe or legally indefensible for a
 * health channel. They are never auto-rewritten: the writer must change the
 * claim, because no phrasing makes "this supplement cures cancer" publishable.
 */
export const FATAL_RULES: readonly OverclaimRule[] = Object.freeze([
  {
    id: "cure_claim",
    pattern:
      /\b(cures?|curing|will cure|fix(?:es|ing)? (?:it|this|that|your \w+)(?: for (?:everyone|everybody))?|reverses? (?:your )?(?:disease|cancer|diabetes)|reverses? diabetes|eliminates? (?:the )?(?:disease|infection|cancer|toxins?)|gets? rid of (?:the )?(?:disease|infection|cancer|toxins?)|flushes? out (?:your )?(?:toxins?|heavy metals?))\b/i,
    message: "Cure or reversal language. A health channel must not claim to treat or reverse disease.",
    fatal: true,
  },
  {
    // The knowledge base already forbids "prevents diabetes entirely" and
    // "prevents all sleep" as reviewer phrasings, but nothing enforced it, so a
    // script could ship exactly the wording review had ruled out. Absolute
    // prevention is the same unsupportable promise as a cure wearing a
    // preventive hat: no trial shows a food stops a disease in every person.
    id: "prevention_claim",
    pattern:
      /\b(?:prevents?|stops?|blocks?|eliminates?|cancels?)\s+(?:all\s+)?(?:\w+\s+){0,2}?(?:disease|cancer|diabetes|infection|infections|colds?|flu|illness|heart disease|tumou?rs?)\s+(?:entirely|completely|forever|for good|permanently|100%)\b|\bprevents?\s+all\s+\w+\b|\bno\s+more\s+(?:colds?|flu|infections?|illness|disease)\b|\b(?:disease|cancer|diabetes)\s+(?:is\s+)?fully\s+preventable\b/i,
    message:
      "Absolute prevention claim. Preventing a disease outright in every viewer is not something any trial can support, and the knowledge base forbids this phrasing outright.",
    suggestion: "is associated with a lower risk of",
    fatal: true,
  },
  {
    // Comparative superlatives are the signature of supplement marketing: they
    // promise to out-perform not merely the untreated baseline but every other
    // person, which no controlled trial can establish. "Works for everyone" is
    // likewise a promise a health channel must not make. This is fatal rather
    // than a warning because the claim is unsupportable in principle, not merely
    // under-evidenced.
    id: "superlative_claim",
    pattern:
      /\b(stronger|healthier|fitter|leaner|smarter|better|faster results?) than (?:anyone|everybody|everyone|any other|all other|people who don'?t|those who don'?t|anything else)\b|\b(works? for everyone|the only (?:supplement|treatment|food|way)|outperforms? (?:all|every|any))\b/i,
    message:
      "Comparative superlative about a health outcome. No study can show a product beats every other person, and the claim reads as supplement marketing.",
    suggestion: "a measurable effect in the population studied",
    fatal: true,
  },
  {
    id: "medical_advice",
    pattern:
      /\b(you (?:should|must|need to) (?:take|stop|start|use)|take this (?:daily|every day)|we recommend you|patients should (?:take|stop|use)|ask your doctor (?:before|if you plan to)|consult your doctor before taking)\b/i,
    message: "Directs the viewer to change their own treatment. Personal medical advice is out of scope.",
    fatal: true,
  },
  {
    id: "self_treatment",
    pattern:
      /\b(stop taking (?:your )?(?:medication|medicine|insulin|statins|antibiotics|chemotherapy)|replace (?:your )?medication|instead of (?:your )?(?:medication|chemotherapy|insulin)|detox (?:at home|yourself)|home remedy for)\b/i,
    message: "Encourages altering or stopping prescribed treatment.",
    fatal: true,
  },
  {
    id: "dosage_prescription",
    pattern:
      /\b(take \d+\s?(?:g|mg|mcg|ml|iu|tablets?|pills?|capsules?)\b|(?:dose|dosage) of \d+|prescribe|recommended dose of \d+)\b/i,
    message: "States a specific dose, which is a prescribing act rather than education.",
    fatal: true,
  },
  {
    id: "pharmaceutical_claim",
    pattern:
      /\b(works better than (?:the )?(?:drug|medication|insulin|nsaid|chemotherapy)|replace (?:your )?(?:statins?|insulin|chemotherapy)|no side effects|no adverse effects|completely safe|100% safe)\b/i,
    message: "Comparative drug claim or absolute safety claim. Requires a specific regulator-grade citation.",
    fatal: true,
  },
  {
    id: "diagnostic_claim",
    pattern:
      /\b(diagnos(?:e|es|ing) you|diagnose (?:cancer|diabetes|tumou?r) (?:from|by)|this test (?:shows|means|proves) you have|if you have (?:these symptoms) you (?:have|definitely))\b/i,
    message: "Diagnostic claim. Explaining a test is fine; telling a viewer what they have is not.",
    fatal: true,
  },
]);

/**
 * Rewritable rules. Each carries the phrasing the evidence supports, so the
 * writer stage can repair the line without inventing a new claim.
 */
export const SOFT_RULES: readonly OverclaimRule[] = Object.freeze([
  {
    id: "absolute_certainty",
    pattern:
      /\b(always|never|definitely|certainly|guaranteed(ly)?|undoubtedly|without exception|in every case|100%|exactly|precisely)\b/i,
    message: "Absolute certainty. No health finding is universal.",
    suggestion: "in most cases / in the studies reviewed",
    fatal: false,
  },
  {
    id: "universal_quantifier",
    pattern: /\b(every(one|body)?|all (?:people|humans|adults|patients)|any (?:one|person)|whoever)\b/i,
    message: "Universal quantifier applied to a population.",
    suggestion: "many / most people studied",
    fatal: false,
  },
  {
    id: "guaranteed_outcome",
    pattern: /\b(guarantee[sd]?|ensures?|will (?:make|give|fix|prevent|stop|reverse))\b/i,
    message: "Promises an outcome.",
    suggestion: "is associated with / can contribute to",
    fatal: false,
  },
  {
    id: "unqualified_causation",
    pattern: /\b(causes?|caused by|leads? to|results? in|triggers?|makes? you)\b/i,
    message: "Causal verb. Permitted only for a design at the top of the evidence ladder.",
    suggestion: "is associated with / is linked to / happens alongside",
    fatal: false,
  },
  {
    id: "efficacy_guarantee",
    pattern: /\b(boosts?|increases?|improves?|raises?|lowers?|reduces?|maximi[sz]es?)\b(?![^.!?]{0,40}\b(associated|linked|may|might|can|appears?))\b/i,
    message: "Effect verb without hedging. Use only where the design supports causality.",
    suggestion: "is linked to / tends to be higher in / is reported alongside",
    fatal: false,
  },
  {
    id: "all_equals_some",
    pattern: /\b(this (?:means|proves|shows)|that (?:means|proves|shows)|proves? (?:that )?)\b/i,
    message: "A finding does not prove a mechanism, especially in observational data.",
    suggestion: "is consistent with / is one explanation",
    fatal: false,
  },
  {
    id: "population_overreach",
    pattern: /\b(everyone|all adults|all patients|any adult|people with (?:any )?\w+ (?:condition|disorder))\b/i,
    message: "Generalises beyond the population that was studied.",
    suggestion: "in the population studied",
    fatal: false,
  },
  {
    id: "fear_language",
    pattern:
      /\b(toxic|poison|damag(?:es|ing) (?:your|their) (?:brain|liver|kidneys?)|kills? (?:you|your)|slow(?:s|ing)? poison|carcinogenic|cancer[- ]causing|destroy(?:s|ing) (?:your|the) (?:gut|microbiome|organs?))\b/i,
    message: "Fear framing without a measured exposure. Reads as alarmism and invites regulatory attention.",
    suggestion: "a neutral description of the mechanism",
    fatal: false,
  },
  {
    id: "detox_language",
    pattern: /\b(detox(?:es|ing)?|cleanse[sd]?|flush(?:es|ing)? (?:out )?(?:toxins|your system)|reset your (?:body|chemistry))\b/i,
    message:
      "The body has no established 'toxin' being cleared by these behaviours. This is the single most common pseudoscience tell in the genre.",
    fatal: false,
  },
]);

export const OVERCLAIM_RULES: readonly OverclaimRule[] = Object.freeze([...FATAL_RULES, ...SOFT_RULES]);

/**
 * The word boundary is declared per alternative rather than once at the end:
 * `"95%"` has no boundary after the `%` because both the `%` and the space that
 * follows are non-word characters, so a trailing `\b` silently dropped every
 * percentage in the corpus.
 */
const NUMBER_WITH_UNIT = new RegExp(
  String.raw`\b(\d+(?:\.\d+)?)\s?(%|percent\b|mg\b|mcg\b|µg\b|g\b|kg\b|ml\b|l\b|litres?\b|liters?\b|kcal\b|calories?\b|hours?\b|h\b|minutes?\b|min\b|seconds?\b|days?\b|weeks?\b|months?\b|years?\b|mmhg\b|bpm\b|steps?\b|servings?\b|cups?\b|glasses?\b|times\b)`,
  "gi",
);

export interface NumberOccurrence {
  text: string;
  value: number;
  unit: string;
  start: number;
  end: number;
  /** Digits after the decimal point; a proxy for false precision. */
  decimals: number;
}

/** Every quantity in a script, with enough context to judge it. */
export function extractNumbers(text: string): NumberOccurrence[] {
  const out: NumberOccurrence[] = [];
  for (const match of text.matchAll(NUMBER_WITH_UNIT)) {
    const raw = match[0] ?? "";
    const start = match.index ?? 0;
    out.push({
      text: raw,
      value: Number.parseFloat(match[1] ?? ""),
      unit: (match[2] ?? "").toLowerCase().trim(),
      start,
      end: start + raw.length,
      decimals: (match[1] ?? "").includes(".") ? (match[1] ?? "").split(".")[1]?.length ?? 0 : 0,
    });
  }
  return out;
}

/**
 * Every number a viewer could hear, whether or not it carries a recognised unit.
 *
 * `extractNumbers` above is deliberately unit-aware, because plausibility bands
 * are meaningless without a unit. That narrowness is a liability for grounding:
 * a figure the extractor cannot classify is a figure the grounding check cannot
 * see, and a figure it cannot see is a figure nobody checked. "A trial of 240
 * participants" has no unit, so a script could change 240 to 24 and pass every
 * number check, because the trigram similarity stays high and the number was
 * never extracted in the first place.
 *
 * So grounding uses this instead: broad, unit-agnostic, and normalising thousands
 * separators so "1,200" and "1200" compare equal.
 */
const STANDALONE_NUMBER =
  /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\w.])/g;

export interface BareNumber {
  /** Canonical numeric value, with thousands separators removed. */
  value: number;
  /** Source token exactly as written, for messages. */
  text: string;
  start: number;
  end: number;
  decimals: number;
}

/** All standalone numbers in a text, ignoring whether a unit follows. */
export function extractAllNumbers(text: string): BareNumber[] {
  const out: BareNumber[] = [];
  for (const match of text.matchAll(STANDALONE_NUMBER)) {
    const digits = match[1] ?? "";
    const text_ = match[0] ?? "";
    const start = match.index ?? 0;
    const fraction = match[2];
    out.push({
      value: Number.parseFloat(digits.replace(/,/g, "")) + (fraction ? Number.parseFloat(`0.${fraction}`) : 0),
      text: text_,
      start,
      end: start + text_.length,
      decimals: fraction?.length ?? 0,
    });
  }
  return out;
}

/** Plausibility bands for quantities a nutrition/physiology channel states often. */
const PLAUSIBILITY: { unit: string; min: number; max: number; note: string }[] = [
  { unit: "%", min: 0, max: 100, note: "a percentage must fall between 0 and 100" },
  { unit: "mg", min: 0.01, max: 100_000, note: "milligram value is outside any plausible physiological range" },
  { unit: "mcg", min: 0.1, max: 100_000, note: "microgram value is outside any plausible physiological range" },
  { unit: "g", min: 0.01, max: 5_000, note: "gram value is outside any plausible physiological range" },
  { unit: "kg", min: 1, max: 400, note: "body mass outside the human range" },
  { unit: "ml", min: 0.1, max: 10_000, note: "millilitre value is outside any plausible physiological range" },
  { unit: "hours", min: 0, max: 24, note: "a duration in hours cannot exceed 24" },
  { unit: "minutes", min: 0, max: 1440, note: "a duration in minutes cannot exceed a day" },
  { unit: "mmhg", min: 40, max: 300, note: "blood pressure outside the physiological range" },
  { unit: "bpm", min: 20, max: 250, note: "heart rate outside the survivable range" },
  { unit: "kcal", min: 1, max: 20_000, note: "energy value outside any plausible daily intake" },
  { unit: "steps", min: 0, max: 100_000, note: "step count is implausibly high" },
  { unit: "days", min: 0, max: 3650, note: "duration in days is implausible" },
  { unit: "weeks", min: 0, max: 520, note: "duration in weeks is implausible" },
  { unit: "months", min: 0, max: 240, note: "duration in months is implausible" },
  { unit: "years", min: 0, max: 150, note: "a human lifespan cannot exceed 150 years" },
];

export interface PlausibilityIssue {
  occurrence: NumberOccurrence;
  reason: string;
}

/** Flag quantities that cannot be true. This catches invented statistics. */
export function checkNumericPlausibility(text: string): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];
  for (const occurrence of extractNumbers(text)) {
    const band = PLAUSIBILITY.find((b) => occurrence.unit.startsWith(b.unit));
    if (!band) continue;
    if (occurrence.value < band.min || occurrence.value > band.max) {
      issues.push({
        occurrence,
        reason: `${occurrence.value}${occurrence.unit === "%" ? "%" : ` ${occurrence.unit}`}: ${band.note}`,
      });
    }
  }
  return issues;
}

export interface OverclaimScan {
  matches: OverclaimMatch[];
  fatal: OverclaimMatch[];
  soft: OverclaimMatch[];
  implausibleNumbers: PlausibilityIssue[];
}

/** Scan arbitrary narration text. */
export function scanOverclaims(text: string): OverclaimScan {
  const matches: OverclaimMatch[] = [];
  for (const rule of OVERCLAIM_RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const match of text.matchAll(pattern)) {
      const fragment = match[0];
      if (!fragment) continue;
      const start = match.index ?? 0;
      matches.push({
        text: fragment,
        start,
        end: start + fragment.length,
        rule: rule.id,
        message: rule.message,
        ...(rule.suggestion ? { suggestion: rule.suggestion } : {}),
      });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  return {
    matches,
    fatal: matches.filter((m) => FATAL_RULES.some((r) => r.id === m.rule)),
    soft: matches.filter((m) => SOFT_RULES.some((r) => r.id === m.rule)),
    implausibleNumbers: checkNumericPlausibility(text),
  };
}
