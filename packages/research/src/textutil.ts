import { contentTokens } from "@hc/core";

export const STOPWORDS_LOCAL = new Set([
  "a","an","the","and","or","of","to","in","on","at","by","for","with","as","is","are","was","were","be",
  "do","does","did","what","how","why","which","who","when","your","you","it","its","that","this","and",
]);

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Meaningful tokens used for topic-level overlap. */
export function STOPWORD_FREE_TOKENS(topic: { title: string; question: string; keywords: string[] }): string[] {
  return contentTokens([topic.title, topic.question, ...topic.keywords].join(" "));
}
