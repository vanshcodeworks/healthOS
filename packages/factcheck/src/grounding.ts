import { containment, trigramSimilarity, normalizeText } from "@hc/core";
import type { Claim } from "@hc/schemas";
import { extractAllNumbers } from "./overclaim.js";
import type { Finding } from "./verify.js";

/**
 * Grounding: proving the spoken sentence is the reviewed claim.
 *
 * Every other check in this package reasons about a claim's *evidence*. That is
 * only sound if the sentence on screen is still the sentence a human reviewed.
 * Without this pass, a writer could take "is associated with" and ship "will
 * fix", and every downstream check would happily vouch for the evidence level
 * of the original, weaker claim. Grounding is what closes that hole.
 *
 * The rule is deliberately conservative: a line may be trimmed for speech, but
 * it may not introduce content the review never saw.
 */
export interface GroundingOptions {
  /** Minimum fraction of the claim's trigrams that must survive into the line. */
  minContainment?: number;
  /** Minimum trigram similarity, for lines that are close to a full restatement. */
  minSimilarity?: number;
}

export interface GroundingResult {
  containment: number;
  similarity: number;
  findings: Finding[];
}

const DEFAULT_MIN_CONTAINMENT = 0.6;
const DEFAULT_MIN_SIMILARITY = 0.45;

function finding(code: string, message: string, excerpt: string, severity: "warning" | "error" = "error"): Finding {
  return { code, severity, blocking: severity === "error", message, excerpt };
}

/**
 * Numbers are checked for set equality against the claim. A line that invents a
 * figure is fabricating data, and a line that drops an "about" qualifier turns a
 * reviewed approximation into a false precision, so both directions fail.
 */
function checkNumbers(line: string, claim: Claim, findings: Finding[]): void {
  const lineNumbers = extractAllNumbers(line);
  const claimNumbers = extractAllNumbers(claim.text);
  if (lineNumbers.length === 0) {
    if (claimNumbers.length > 0) {
      findings.push(
        finding(
          "GROUNDING_NUMBER_DROPPED",
          `The claim is quantitative (${claimNumbers.map((n) => n.text).join(", ")}) but the line states no figure. Dropping the number strips the evidence from the sentence.`,
          line,
        ),
      );
    }
    return;
  }
  const claimKeys = new Set(claimNumbers.map((n) => n.value));
  const lineKeys = new Set(lineNumbers.map((n) => n.value));
  for (const num of lineNumbers) {
    if (!claimKeys.has(num.value)) {
      findings.push(
        finding(
          "GROUNDING_UNAPPROVED_NUMBER",
          `"${num.text}" is not a figure in the reviewed claim. A line may not introduce a quantity the review never approved.`,
          line,
        ),
      );
    }
  }
  for (const num of claimNumbers) {
    if (!lineKeys.has(num.value)) {
      findings.push(
        finding(
          "GROUNDING_NUMBER_DROPPED",
          `The reviewed claim carries the figure "${num.text}" and the line omits it.`,
          line,
          "warning",
        ),
      );
    }
  }
}

function checkPhrasing(line: string, claim: Claim, findings: Finding[]): void {
  const haystack = normalizeText(line);
  for (const phrase of claim.forbidden_phrasing) {
    const needle = normalizeText(phrase);
    if (needle.length > 3 && haystack.includes(needle)) {
      findings.push(
        finding(
          "GROUNDING_FORBIDDEN_PHRASING",
          `The review explicitly forbids "${phrase}", and the line says it.`,
          line,
        ),
      );
    }
  }
  if (claim.hedge_required && claim.permitted_phrasing.length > 0) {
    const keepsAHedge = claim.permitted_phrasing.some((p) => haystack.includes(normalizeText(p)));
    // "most", "many" and "a minority of" are quantifier hedges just as much as
    // "may" and "roughly": they bound the claim instead of asserting it outright.
    const statesAHedge =
      /\b(may|might|could|can|is associated with|are associated with|linked to|roughly|about|approximately|on average|typically|usually|in most cases|most|many|a minority|fewer than|tends? to|appears? to|likely|probably|suggests?)\b/i.test(line);
    if (!keepsAHedge && !statesAHedge) {
      findings.push(
        finding(
          "GROUNDING_HEDGE_DROPPED",
          "This claim required hedged language and the line asserts it flatly.",
          line,
        ),
      );
    }
  }
}

/**
 * Numbers plus forbidden phrasing are checked when the claim supports them.
 * The similarity floor is intentionally lenient: captions, contractions and
 * speech-friendly rephrasing all lower overlap without changing meaning, so a
 * hard threshold here would reject good writing. The floor exists to catch
 * wholesale substitution, not to police style.
 */
export function groundLine(
  line: string,
  claim: Claim | undefined,
  options: GroundingOptions = {},
): GroundingResult {
  const findings: Finding[] = [];
  if (!claim) return { containment: 0, similarity: 0, findings };

  const minContainment = options.minContainment ?? DEFAULT_MIN_CONTAINMENT;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const contain = containment(line, claim.text);
  const similar = trigramSimilarity(line, claim.text);
  const findingsOut = findings;

  if (contain < minContainment) {
    findingsOut.push(
      finding(
        "GROUNDING_DRIFT",
        `Only ${Math.round(contain * 100)}% of the reviewed claim survives in this line (${Math.round(minContainment * 100)}% required). The sentence has drifted from the claim the sources actually support.`,
        line,
      ),
    );
  } else if (similar < minSimilarity) {
    findingsOut.push(
      finding(
        "GROUNDING_WEAK_MATCH",
        `The line reads as a loose paraphrase of the claim (similarity ${similar.toFixed(2)}, ${minSimilarity} required). Confirm this sentence says the same thing the review approved.`,
        line,
        "warning",
      ),
    );
  }

  checkNumbers(line, claim, findingsOut);
  checkPhrasing(line, claim, findingsOut);
  return { containment: contain, similarity: similar, findings: findingsOut };
}

/**
 * The reviewed material a connective line is allowed to draw on.
 *
 * Built once per topic from the claims that survived review, so a hook cannot be
 * checked against a different standard for every line it appears in.
 */
export interface ConnectiveCorpus {
  /** Reviewed claim text and caveats. */
  texts: string[];
  /** Every digit group appearing in the reviewed text, for number attribution. */
  digits: Set<string>;
}

/**
 * Words a hook or CTA needs that carry no health content of their own. Without
 * these the gate would reject "What happens in your brain?" purely for asking a
 * question, which would train authors to avoid questions rather than avoid
 * unsupported claims.
 */
const CONNECTIVE_FRAMING = new Set([
  "actually", "after", "again", "against", "along", "already", "also", "always", "another", "around", "because",
  "become", "becomes", "before", "behind", "below", "between", "beyond", "both", "bring", "brings", "but", "by",
  "can", "cannot", "cause", "causes", "change", "changes", "come", "comes", "could", "decide", "decides", "did",
  "does", "doing", "done", "down", "during", "each", "either", "else", "even", "ever", "every", "exactly", "fact",
  "facts", "far", "few", "first", "follow", "follows", "from", "get", "gets", "give", "gives", "go", "goes", "going",
  "good", "got", "happen", "happens", "hard", "has", "have", "having", "here", "here's", "hers", "herself", "him",
  "himself", "his", "how", "inside", "instead", "into", "its", "itself", "just", "keep", "keeps", "less", "let",
  "let's", "like", "little", "look", "looks", "made", "make", "makes", "many", "matter", "matters", "maybe", "mean",
  "means", "might", "mine", "more", "most", "much", "must", "myth", "myths", "need", "needs", "never", "next",
  "none", "not", "nothing", "now", "often", "once", "one", "only", "onto", "or", "other", "others", "our", "ours",
  "out", "over", "own", "part", "people", "perhaps", "point", "possible", "probably", "question", "questions",
  "quietly", "rather", "real", "really", "reason", "reasons", "right", "same", "say", "says", "second", "see",
  "seem", "seems", "set", "several", "shall", "she", "should", "show", "shows", "simply", "since", "so", "some",
  "something", "sometimes", "soon", "still", "stuff", "such", "sure", "take", "takes", "than", "that", "that's",
  "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they", "thing", "things", "think",
  "this", "those", "though", "through", "time", "times", "to", "together", "too", "under", "until", "up", "upon",
  "us", "use", "used", "using", "very", "want", "was", "way", "we", "well", "were", "what", "whatever", "when",
  "where", "whether", "which", "while", "who", "whom", "whose", "why", "will", "with", "within", "without", "would",
  "yet", "you", "your", "yours",
]);

/**
 * Words that only carry meaning in health context. An unrecognised word that is
 * not plain connective framing is treated as new clinical content, which is the
 * case worth stopping for: a hook that names a hormone, drug or symptom nobody
 * reviewed is making a claim.
 */
const DOMAIN_HINT = /\b(mg|kg|ml|litre|liter|gram|percent|mg|dose|dosing|supplement|vitamin|mineral|hormone|insulin|glucagon|adenosine|caffeine|creatine|protein|peptide|amino|fibre|fiber|sugar|glucose|glycogen|insulin|cortisol|testosterone|estrogen|thyroid|receptor|enzyme|metabolism|metabolic|absorption|absorb|secretion|diarrhea|diarrhoea|indigestion|bloating|cramp|nausea|syndrome|disease|infection|inflammation|anxiety|depression|insomnia|cancer|diabetes|hypertension)/i;

/**
 * Domain words that mean the same thing to a reader but not to a string match.
 *
 * A hook has to speak the viewer's language, and that language is not the claim
 * text's. "Blood sugar" and "blood glucose" are the same quantity; rejecting the
 * first would push authors to write in the corpus's wording, which is worse for
 * the audience than the synonym is for the gate.
 */
const SYNONYM_GROUPS: string[][] = [
  ["sugar", "glucose", "glycaemic", "glycemic", "carbohydrate"],
  ["fibre", "fiber"],
  ["protein", "amino", "peptide"],
  ["heart", "cardiac"],
  ["kidney", "renal"],
  ["breath", "respiratory"],
  ["sweat", "perspiration"],
  ["tired", "fatigue", "sleepy", "drowsy"],
  ["muscle", "muscular"],
  ["cholesterol", "lipid"],
];

/**
 * A deliberately crude stem. This is a novelty check, not a linguistic one: it
 * only has to stop "absorbed" from reading as new content next to a reviewed
 * "absorption".
 *
 * Suffix stripping alone is not enough for that pair, because they stem
 * differently ("absorb" and "absorpt"), so {@link isSeenReview} also compares
 * leading characters. Both are lossy in the same direction: they can treat a
 * genuinely new word as familiar, never the reverse. Missing a novel word costs a
 * human read; crying wolf on "absorbed" would cost the gate its credibility.
 */
function stem(word: string): string {
  const w = word.toLowerCase();
  for (const suffix of ["ations", "ation", "ions", "ion", "ing", "ed", "es", "s"]) {
    if (w.length - suffix.length >= 5 && w.endsWith(suffix)) return w.slice(0, w.length - suffix.length);
  }
  return w;
}

/** Whether a token is the same word as something in the reviewed text. */
function isSeenReview(token: string, reviewedTokens: Set<string>, haystack: string): boolean {
  const stemmed = stem(token);
  // Substring match, so a stem buried inside a longer word still counts.
  if (haystack.includes(stemmed)) return true;
  for (const reviewed of reviewedTokens) {
    const other = stem(reviewed);
    if (other === stemmed) return true;
    // Same word family: "absorbed" against "absorption".
    if (stemmed.length >= 6 && other.length >= 6 && stemmed.slice(0, 5) === other.slice(0, 5)) return true;
  }
  // Different word, same meaning to a reader: "sugar" against "glucose".
  return SYNONYM_GROUPS.some(
    (group) => group.map(stem).includes(stemmed) && group.some((word) => haystack.includes(stem(word))),
  );
}

function contentWords(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

/**
 * Build the grounding target for a topic's connective lines.
 *
 * `extra` carries the topic's own framing (title, question, keywords), which a
 * hook may legitimately echo even when no claim repeats it.
 */
export function buildConnectiveCorpus(claims: Claim[], extra: string[] = []): ConnectiveCorpus {
  const texts = [...claims.map((c) => c.text), ...claims.map((c) => c.caveat ?? ""), ...extra].filter(
    (t): t is string => typeof t === "string" && t.trim().length > 0,
  );
  const digits = new Set<string>();
  for (const text of texts) {
    for (const n of extractAllNumbers(text)) {
      digits.add(String(n.value));
      // Digit groups, so a declared range such as "20-45" also covers a line that
      // states one endpoint without restating the range.
      for (const group of n.text.match(/\d+(?:\.\d+)?/g) ?? []) digits.add(group.replace(/,/g, ""));
    }
    for (const group of text.match(/\d+(?:\.\d+)?/g) ?? []) digits.add(group.replace(/,/g, ""));
  }
  return { texts, digits };
}

/**
 * Ground a connective line: a hook, CTA or caveat that carries no claim id.
 *
 * These lines were previously exempt from grounding on the grounds that they are
 * "connective tissue". In practice they are where unreviewed health claims
 * reach the audience, because the corpus stores real advice in them: "Adults are
 * generally advised to sleep 7 or more hours per night" is a quantitative
 * recommendation, and "the half-life of caffeine is roughly 5 hours" converts a
 * reviewed five-to-six-hour range into a single precise figure. Neither had to
 * match any claim, so neither was ever checked.
 *
 * The floor here is lower than for a claim line, because a hook is supposed to
 * rephrase. The two hard rules are the ones that cannot be rephrased away: a
 * number must be attributable to the reviewed material, and a hook may not
 * introduce clinical vocabulary the review never saw.
 */
export function groundConnective(
  line: string,
  corpus: ConnectiveCorpus,
  options: GroundingOptions = {},
): GroundingResult {
  const findings: Finding[] = [];
  const haystack = normalizeText(corpus.texts.join(" "));

  // Rule 1: every number must trace back to reviewed text.
  for (const n of extractAllNumbers(line)) {
    if (corpus.digits.has(String(n.value))) continue;
    // A line may restate one end of a reviewed range; the range's endpoints are
    // separately attested by the digit groups collected above.
    if ((n.text.match(/\d+(?:\.\d+)?/g) ?? []).every((g) => corpus.digits.has(g.replace(/,/g, "")))) continue;
    findings.push(
      finding(
        "CONNECTIVE_NUMBER_UNSOURCED",
        `"${n.text}" appears in a hook, CTA or caveat but no reviewed claim for this topic states it. Unsourced numbers in connective lines are the easiest way for an unreviewed claim to reach the audience.`,
        line,
      ),
    );
  }

  // Rule 2: no new clinical content. Framing words are exempt; domain vocabulary
  // is not, because naming a hormone or a symptom is a claim about the body.
  const reviewedTokens = new Set(haystack.split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
  const novel = contentWords(line).filter(
    (w) => !CONNECTIVE_FRAMING.has(w) && !isSeenReview(w, reviewedTokens, haystack) && DOMAIN_HINT.test(w),
  );
  if (novel.length > 0) {
    findings.push(
      finding(
        "CONNECTIVE_NEW_DOMAIN_CONTENT",
        `Introduces clinical language no reviewed claim for this topic uses: ${[...new Set(novel)].join(", ")}. A hook may rephrase reviewed material; it may not add new health content.`,
        line,
      ),
    );
  }

  // Rule 3: warn when the line is not recognisably about the reviewed material.
  const best = corpus.texts.reduce((acc, t) => Math.max(acc, trigramSimilarity(line, t)), 0);
  const floor = options.minSimilarity ?? 0.12;
  if (best < floor && findings.length === 0) {
    findings.push(
      finding(
        "CONNECTIVE_UNRECOGNISED",
        `This line shares little wording with the reviewed claims for this topic (similarity ${best.toFixed(2)}). Confirm it is framing rather than a new claim.`,
        line,
        "warning",
      ),
    );
  }

  return { containment: 0, similarity: best, findings };
}
