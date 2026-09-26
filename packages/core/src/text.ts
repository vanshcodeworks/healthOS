/**
 * Deterministic text utilities. No model calls: the originality engine, caption
 * aligner and metadata agent all rely on these being stable across runs.
 */

const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","than","that","this","these","those","is","are","was","were",
  "be","been","being","to","of","in","on","at","by","for","with","as","it","its","you","your","yours","we",
  "our","they","their","them","he","she","his","her","i","me","my","not","no","do","does","did","so","just",
  "about","from","into","over","after","before","when","while","can","will","would","could","should","there",
  "here","what","which","who","how","why","very","more","most","some","any","all","also","up","out","down",
]);

export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  return normalizeText(input)
    .replace(/[^a-z0-9'\s.-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function contentTokens(input: string): string[] {
  return tokenize(input).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

export function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}

/** Jaccard similarity of content-token sets. */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Multiset (Dice) similarity — less sensitive to verbosity than Jaccard. */
export function diceCoefficient(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of b) {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) {
      overlap++;
      counts.set(token, remaining - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

function trigrams(value: string): Map<string, number> {
  const padded = `  ${normalizeText(value)} `;
  const map = new Map<string, number>();
  for (let i = 0; i < padded.length - 2; i++) {
    const gram = padded.slice(i, i + 3);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

/** Cosine similarity over character trigrams: robust to paraphrase. */
export function trigramSimilarity(a: string, b: string): number {
  const mapA = trigrams(a);
  const mapB = trigrams(b);
  if (mapA.size === 0 || mapB.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const count of mapA.values()) normA += count * count;
  for (const count of mapB.values()) normB += count * count;
  for (const [gram, countA] of mapA) {
    const countB = mapB.get(gram);
    if (countB) dot += countA * countB;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/** Fraction of a's 4-grams present in b. Catches "same idea, five words apart". */
export function containment(a: string, b: string, n = 4): number {
  const gramsA = new Set(ngrams(tokenize(a), n));
  const gramsB = new Set(ngrams(tokenize(b), n));
  if (gramsA.size === 0) return 0;
  let hit = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) hit++;
  return hit / gramsA.size;
}

/**
 * Estimated syllable count. Drives caption timing when a real forced
 * aligner is unavailable, and drives narration duration estimation.
 */
export function syllables(word: string): number {
  const w = normalizeText(word).replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/(?:[^laeiouy]es|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [
  [1_000_000, "million"],
  [1_000, "thousand"],
];

/** "240" to "two hundred forty", the way a narrator says it. */
function integerToWords(value: number): string {
  if (value < 20) return ONES[value] ?? String(value);
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)] ?? "";
    const ones = value % 10;
    return ones ? `${tens} ${ONES[ones]}` : tens;
  }
  if (value < 1000) {
    const hundreds = `${ONES[Math.floor(value / 100)]} hundred`;
    const rest = value % 100;
    return rest ? `${hundreds} ${integerToWords(rest)}` : hundreds;
  }
  for (const [scale, name] of SCALES) {
    if (value < scale) continue;
    const head = Math.floor(value / scale);
    const tail = value % scale;
    const headWords = integerToWords(head);
    return tail ? `${headWords} ${name} ${integerToWords(tail)}` : `${headWords} ${name}`;
  }
  return String(value);
}

/**
 * Units and abbreviations a narrator expands rather than reads as written.
 *
 * "95 mg" is three spoken words, not two tokens, and "WHO" is three. Left as
 * written, a health script's durations come out short by a third, which is how a
 * 55 second video ends up needing 74.
 */
const SPOKEN_UNITS: Record<string, string> = {
  mg: "milligrams", mcg: "micrograms", µg: "micrograms", ug: "micrograms",
  g: "grams", kg: "kilograms", lb: "pounds", oz: "ounces",
  ml: "millilitres", milliliters: "millilitres", l: "litres", liter: "litres", liters: "litres",
  kcal: "calories", cal: "calories",
  min: "minutes", mins: "minutes", hr: "hours", hrs: "hours", sec: "seconds", secs: "seconds",
  pct: "percent", pp: "percentage points",
  iu: "international units", mcg_dosage: "milligrams",
};

/** Initialisms that are spelled out letter by letter when spoken. */
const SPOKEN_INITIALISMS: Record<string, number> = {
  who: 3, atp: 3, adp: 3, dna: 3, rna: 3, ldl: 3, hdl: 3, efsa: 4, rct: 3, bmi: 3, cog: 3, usa: 3, fda: 3,
};

function numberToWords(token: string): number {
  const cleaned = token.replace(/,/g, "");
  if (!/^\d/.test(cleaned)) return 0;
  if (/^\d+\.\d+$/.test(cleaned)) {
    const [whole = "0", frac = ""] = cleaned.split(".");
    // "0.5" is spoken "zero point five": the whole, "point", then each digit.
    return integerToWords(Number(whole)).split(" ").length + 2 + frac.length;
  }
  if (!/^\d+$/.test(cleaned)) return 0;
  return integerToWords(Number(cleaned)).split(" ").length;
}

/** Spoken word count for one whitespace-free token. */
function spokenWords(token: string): number {
  if (/^\d/.test(token)) {
    const unit = SPOKEN_UNITS[token.replace(/^[\d.,%]+/, "")];
    return (numberToWords(token) || 1) + (unit ? unit.split(" ").length : 0);
  }
  const unit = SPOKEN_UNITS[token];
  if (unit) return unit.split(" ").length;
  const initialism = SPOKEN_INITIALISMS[token];
  if (initialism) return initialism;
  return 1;
}

/**
 * How many words a speech engine will actually utter for this text.
 *
 * This is the number that matters for timing. A whitespace count treats "95 mg"
 * as two words when it is spoken as three, and underestimates every quantified
 * health claim, which is most of them.
 */
export function spokenTokenCount(text: string): number {
  let count = 0;
  // Normalisation drops the percent sign and splits on the thousands comma, so
  // both are repaired first: "10%" is spoken as two words, and "1,200 mg" is one
  // number, not two.
  const prepared = text.replace(/(\d)\s*%/g, "$1 percent").replace(/(\d),(\d)/g, "$1$2");
  for (const token of tokenize(prepared)) {
    if (!/[a-z0-9]/i.test(token)) continue;
    // Compounds are spoken as separate words: "5-6" is two numbers, not one.
    for (const part of token.toLowerCase().split(/[-/]/)) {
      if (part) count += spokenWords(part);
    }
  }
  return count;
}

/**
 * Estimated spoken duration.
 *
 * Calibrated against measured Windows SAPI output: plain prose runs at about
 * 165 words per minute for a neutral en-US voice, once numbers and units are
 * expanded into the words a narrator actually says.
 */
export function estimateSpeechMs(text: string, wordsPerMinute = 165): number {
  const words = spokenTokenCount(text);
  if (words === 0) return 0;
  return (words / wordsPerMinute) * 60_000;
}

export function wordCount(text: string): number {
  return tokenize(text).filter((t) => /[a-z0-9]/.test(t)).length;
}

export function sentenceSplit(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+(?=[a-z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function titleCase(input: string): string {
  const small = new Set(["a","an","and","as","at","but","by","for","in","of","on","or","the","to","vs","with"]);
  return tokenize(input)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && small.has(lower)) return lower;
      if (/^[0-9]/.test(word)) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Casing-preserving wrapper: keeps "DNA", "ATP", "mRNA" intact. */
export function smartSentenceCase(input: string): string {
  const text = input.trim();
  if (text.length === 0) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function stripEmoji(input: string): string {
  // eslint-disable-next-line no-misleading-character-class
  return input.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "");
}

export function isMostlyAscii(input: string): boolean {
  if (input.length === 0) return true;
  let ascii = 0;
  for (const char of input) if (char.charCodeAt(0) < 128) ascii++;
  return ascii / input.length > 0.9;
}
