import { normalizeText, tokenize, STOPWORD_FREE_TOKENS } from "./textutil.js";
import type { Topic } from "@hc/schemas";

/** Stable, lowercase, hyphen-free key for topic de-duplication. */
export function normaliseTitle(title: string): string {
  return normalizeText(title)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .join(" ")
    .trim();
}

export function topicToSearchText(topic: Pick<Topic, "title" | "question" | "keywords">): string {
  return [topic.title, topic.question, ...topic.keywords].join(" ").toLowerCase();
}

/** Overlap of two topics on meaningful tokens. */
export function topicOverlap(a: Topic, b: Topic): number {
  const setA = new Set(STOPWORD_FREE_TOKENS(a));
  const setB = new Set(STOPWORD_FREE_TOKENS(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let hits = 0;
  for (const token of setA) if (setB.has(token)) hits++;
  return hits / Math.min(setA.size, setB.size);
}

export function tokenSet(input: string): Set<string> {
  return new Set(tokenize(input));
}
