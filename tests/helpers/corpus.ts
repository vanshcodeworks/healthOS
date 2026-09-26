// Shared fixtures for the test suite.
//
// Tests deliberately build topics from the real knowledge base rather than from
// hand-written stand-ins. A fake claim that satisfies the schema but would never
// pass review is exactly the kind of fixture that lets a real safety bug through
// unnoticed, so the corpus is the fixture.

import { KB_TOPICS, researchTopic, type KbTopic } from "@hc/research";
import { TopicSchema, parse, type Topic } from "@hc/schemas";
import { deterministicId } from "@hc/core";

export { KB_TOPICS };

/** Build a persisted-shape Topic from a knowledge-base entry. */
export function topicFor(kb: KbTopic, overrides: Partial<Record<string, unknown>> = {}): Topic {
  const now = new Date().toISOString();
  return parse(TopicSchema, {
    topic_id: deterministicId("top", kb.slug),
    slug: kb.slug,
    title: kb.title,
    question: kb.question,
    category: kb.category,
    suggested_format: kb.format,
    origin: "knowledge_base",
    trend_strength: 0,
    priority_score: 0.5,
    status: "DISCOVERED",
    keywords: kb.keywords,
    source_ids: [],
    generated_videos: [],
    performance: {},
    discovered_at: now,
    updated_at: now,
    ...overrides,
  });
}

export function kbTopic(slug: string): KbTopic {
  const found = KB_TOPICS.find((t) => t.slug === slug);
  if (!found) throw new Error(`no knowledge-base topic with slug "${slug}"`);
  return found;
}

export interface Researched {
  kb: KbTopic;
  topic: Topic;
  claims: Awaited<ReturnType<typeof researchTopic>>["claims"];
  sources: Awaited<ReturnType<typeof researchTopic>>["sources"];
}

/** Research a topic offline. Network lookups are opt-in per test, never implicit. */
export async function research(kb: KbTopic): Promise<Researched> {
  const topic = topicFor(kb);
  const result = await researchTopic({ topic, allowNetwork: false });
  return { kb, topic, claims: result.claims, sources: result.sources };
}

/**
 * Mark every source verified so a test can isolate the gate it actually cares
 * about. Citation reachability is tested separately, because a test that depends
 * on the network stops being a unit test the moment the network flaps.
 */
export function asVerified(sources: Researched["sources"]): Researched["sources"] {
  return sources.map((s) => ({ ...s, verified: true }));
}
