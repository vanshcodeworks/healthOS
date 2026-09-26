import { httpRequest, loadEnv, slugify } from "@hc/core";
import type { CategoryId, FormatId } from "@hc/schemas";
import type { ResearchProvider, TopicCandidate } from "./types.js";

interface FeedItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  description?: string;
  summary?: string;
}

const CATEGORY_HINTS: { match: RegExp; category: CategoryId }[] = [
  { match: /\b(sleep|insomnia|circadian|rest)\b/i, category: "sleep" },
  { match: /\b(hydrat|water|dehydrat|fluid|electrolyte)\b/i, category: "hydration" },
  { match: /\b(creatine|supplement|vitamin|mineral|omega|probiotic)\b/i, category: "supplements" },
  { match: /\b(heart|cardio|blood pressure|cholesterol)\b/i, category: "cardio" },
  { match: /\b(brain|neural|dopamin|serotonin|adhd)\b/i, category: "brain" },
  { match: /\b(digest|stomach|gut|intestin|constipat|bloating)\b/i, category: "digestion" },
  { match: /\b(myth|debunk|does .* really|actually work)\b/i, category: "myths" },
  { match: /\b(exercise|training|muscle|protein|strength|cardio)\b/i, category: "exercise" },
  { match: /\b(glucose|insulin|metabol|blood sugar)\b/i, category: "metabolism" },
  { match: /\b(vitamin|mineral|nutrient|diet|fruit|vegetable|fibre|fiber|protein)\b/i, category: "nutrition" },
];

/**
 * RSS trend reader.
 *
 * This provider exists purely to observe *audience and publisher attention*.
 * Its output is a TREND SIGNAL. It never contributes to a claim's evidence
 * level, and the research stage records that separation explicitly.
 */
export class RssTrendProvider implements ResearchProvider {
  readonly name = "rss";

  isConfigured(): boolean {
    return (loadEnv().RSS_FEEDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).length > 0;
  }

  private feeds(): string[] {
    return (loadEnv().RSS_FEEDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async discover(input: { limit: number }): Promise<TopicCandidate[]> {
    const candidates: TopicCandidate[] = [];
    for (const feed of this.feeds()) {
      if (candidates.length >= input.limit) break;
      try {
        const response = await httpRequest({ url: feed, integration: `rss:${feed}`, accept: "text" });
        const items = parseFeed(response.text()).slice(0, Math.ceil(input.limit / Math.max(1, this.feeds().length)));
        for (const item of items) {
          const title = cleanTitle(item.title ?? "");
          if (title.length < 12) continue;
          candidates.push({
            topic: {
              title: title.slice(0, 180),
              question: toQuestion(title),
              category: categorise(title),
              suggested_format: suggestFormat(title),
              origin: this.name,
              origin_ref: item.link ?? feed,
              keywords: [],
            },
            supporting: [],
            trend_provider: this.name,
            warnings: [
              "Trend signal only: a headline is a demand signal, not evidence of a health effect.",
            ],
          });
        }
      } catch {
        // One dead feed must not stop discovery from the others.
      }
    }
    return candidates.slice(0, input.limit);
  }

  /** This provider only contributes via `discover`; it is not a search backend. */
  search(): Promise<[]> {
    return Promise.resolve([]);
  }
}

/** Minimal RSS/Atom reader: regex based, tolerant of the field ordering in the wild. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const rssMatches = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  if (rssMatches.length > 0) {
    for (const chunk of rssMatches.slice(0, 40)) {
      items.push({
        title: tag(chunk, "title"),
        link: tag(chunk, "link"),
        guid: tag(chunk, "guid"),
        pubDate: tag(chunk, "pubDate"),
        description: tag(chunk, "description") ? stripCdata(tag(chunk, "description") as string) : undefined,
      });
    }
    return items;
  }
  const atomMatches = xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
  for (const chunk of atomMatches.slice(0, 40)) {
    const linkMatch = chunk.match(/<link[^>]*href="([^"]+)"/i);
    const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    items.push({
      title: titleMatch?.[1] ? stripCdata(titleMatch[1]) : undefined,
      link: linkMatch?.[1],
      guid: tag(chunk, "id"),
      pubDate: tag(chunk, "updated"),
    });
  }
  return items;
}

function tag(chunk: string, name: string): string | undefined {
  const match = chunk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match?.[1];
}

function stripCdata(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(title: string): string {
  return stripCdata(title)
    .replace(/\s*[|\-–—]\s*(Reuters|AP|NHS|Healthline|MedlinePlus)[^|]*$/i, "")
    .trim();
}

function toQuestion(title: string): string {
  const lower = title.toLowerCase();
  if (lower.startsWith("what")) return title;
  if (lower.startsWith("does") || lower.startsWith("do") || lower.startsWith("can") || lower.startsWith("is")) {
    return `${title}?`;
  }
  return `What does the evidence say about ${title.toLowerCase()}?`;
}

function categorise(text: string): CategoryId {
  for (const hint of CATEGORY_HINTS) if (hint.match.test(text)) return hint.category;
  return "nutrition";
}

function suggestFormat(text: string): FormatId {
  const lower = text.toLowerCase();
  if (/\b(how|after|inside|process|step|journey)\b/.test(lower)) return "mechanism";
  if (/\b(myth|debunk|fake|nope|truth about)\b/.test(lower)) return "myth";
  if (/\b(vs|versus|compared|which is better)\b/.test(lower)) return "comparison";
  if (/\b(study|research|percent|%|data|rate)\b/.test(lower)) return "data";
  if (/\b(timeline|hours? later|minutes? later|over \d+)\b/.test(lower)) return "timeline";
  if (/\b(creatine|supplement|stack|dose)\b/.test(lower)) return "supplement";
  if (/\b(eat|food|meal|protein|recipe)\b/.test(lower)) return "nutrition";
  return "mechanism";
}

export const slugifyTopic = slugify;

