import { estimateSpeechMs, sentenceSplit, smartSentenceCase } from "@hc/core";
import type { Claim, FormatId } from "@hc/schemas";
import type { KbClaim, KbTopic } from "@hc/research";

/**
 * Script assembly from reviewed claims.
 *
 * The writer in this system is deliberately dumb: it does not generate health
 * claims. It may only arrange sentences whose wording already passed the
 * knowledge base's `permitted`/`forbidden` review, and it must attach the claim
 * id to every sentence so the fact-checker can trace it back to a citation.
 * Anything it cannot source is dropped rather than smoothed over.
 */

export interface ScriptBeat {
  beat_id: string;
  /** The reviewed claim this beat rests on. */
  claim_id: string;
  /** The reviewed sentence, lightly trimmed for speech. */
  narration: string;
  /** Visual intent for the storyboard stage. */
  intent: string;
  caveat?: string;
  evidence_level: Claim["evidence_level"];
  support_count: number;
  estimated_ms: number;
  words: number;
}

export interface ScriptDraft {
  topic_id: string;
  slug: string;
  format: FormatId;
  hook: string;
  hook_type: string;
  beats: ScriptBeat[];
  cta: string;
  /**
   * The disclaimer as it is *spoken*.
   *
   * This is what the storyboard narrates, so it is the short form. The complete
   * legal wording lives in {@link ScriptDraft.disclaimer_full} and goes on the
   * end card, which is where a viewer who wants to read it can.
   */
  disclaimer: string;
  /** Complete disclaimer wording, for the end card and the record. */
  disclaimer_full: string;
  /** Narration in speaking order, for the fact-checker and TTS. */
  lines: { beat_id: string; text: string; claim_id?: string }[];
  target_ms: number;
  estimated_ms: number;
  warnings: string[];
}

export interface WriteOptions {
  /** Force a hook variant; otherwise the strongest variant is chosen. */
  hookIndex?: number;
  targetMs?: number;
  /** Append a professional-referral line. On by default. */
  includeDisclaimer?: boolean;
}

export const DISCLAIMER =
  "General education, not medical advice. If you are pregnant, taking medication, or managing a diagnosed condition, talk to your doctor before changing anything.";

/**
 * The spoken half of the disclaimer.
 *
 * The full text is legal boilerplate and reads as boilerplate out loud: at a
 * natural pace it runs about eight seconds, which is a sixth of a short video
 * spent on a line the viewer has heard on the other thirteen videos this week.
 * The full wording still ships, on the end card and in the script metadata;
 * what is trimmed is only the narration, and it keeps both phrases the safety
 * gate keys on ("not medical advice" and "talk to your doctor").
 */
export const DISCLAIMER_SPOKEN =
  "General education, not medical advice. Talk to your doctor before changing anything.";

export function writeScript(kb: KbTopic, topicId: string, options: WriteOptions = {}): ScriptDraft {
  const target = options.targetMs ?? 45_000;
  const hookIndex = options.hookIndex ?? pickHook(kb);
  const hookVariant = kb.hooks[hookIndex] ?? kb.hooks[0];
  const hook = hookVariant?.text ?? kb.title;
  const warnings: string[] = [];

  // One beat per reviewed claim. An arc longer than the reviewed claim set is
  // trimmed rather than padded: repeating a claim to fill the arc is the fastest
  // way to make a video feel like filler, and it inflates the duration estimate.
  const beatCount = Math.min(kb.arc.length, kb.claims.length);
  if (kb.arc.length > kb.claims.length) {
    warnings.push(
      `Arc has ${kb.arc.length} beats but only ${kb.claims.length} reviewed claims; trimmed to ${beatCount} beats. Add claims to the knowledge base to use the rest of the arc.`,
    );
  }

  const beats: ScriptBeat[] = [];
  for (let i = 0; i < beatCount; i++) {
    const intent = kb.arc[i] ?? kb.arc[kb.arc.length - 1] ?? "explain";
    const claim = kb.claims[i];
    if (!claim) break;
    beats.push(buildBeat(claim, intent, i, warnings));
  }

  const includeDisclaimer = options.includeDisclaimer ?? true;
  const lines: ScriptDraft["lines"] = [
    { beat_id: "hook", text: hook },
    ...beats.map((beat) => ({ beat_id: beat.beat_id, text: beat.narration, claim_id: beat.claim_id })),
    { beat_id: "cta", text: kb.cta },
  ];
  if (includeDisclaimer) lines.push({ beat_id: "disclaimer", text: DISCLAIMER_SPOKEN });

  const estimated = lines.reduce((sum, line) => sum + estimateSpeechMs(line.text), 0);
  if (estimated > target * 1.35) {
    warnings.push(
      `Estimated ${Math.round(estimated / 1000)}s exceeds the ${Math.round(target / 1000)}s target by over 35%. Cut a beat before the storyboard stage allocates shots.`,
    );
  }

  return {
    topic_id: topicId,
    slug: kb.slug,
    format: kb.format,
    hook,
    hook_type: hookVariant?.type ?? "statement",
    beats,
    cta: kb.cta,
    // Spoken form goes here because this is the field the storyboard narrates.
    disclaimer: includeDisclaimer ? DISCLAIMER_SPOKEN : "",
    disclaimer_full: includeDisclaimer ? DISCLAIMER : "",
    lines,
    target_ms: target,
    estimated_ms: estimated,
    warnings,
  };
}

function buildBeat(claim: KbClaim, intent: string, index: number, warnings: string[]): ScriptBeat {
  const narration = speakable(claim.text);
  if (narration !== claim.text) {
    warnings.push(
      `Beat ${index + 1} was re-cased for speech; the fact-checker re-verifies the spoken form against ${claim.id}.`,
    );
  }
  return {
    beat_id: `beat_${index + 1}`,
    claim_id: claim.id,
    narration,
    intent,
    ...(claim.caveat ? { caveat: speakable(claim.caveat) } : {}),
    evidence_level: claim.level,
    support_count: claim.sources.length,
    estimated_ms: estimateSpeechMs(narration),
    words: narration.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Trim a reviewed sentence for speech without changing its meaning: collapse
 * whitespace and re-case the first letter. Deliberately no synonym substitution,
 * because swapping words is how a reviewed claim quietly becomes a stronger
 * claim than the source supports.
 */
function speakable(text: string): string {
  const joined = sentenceSplit(text.trim()).join(" ");
  return smartSentenceCase(joined.replace(/\s+/g, " ").trim());
}

/**
 * Prefer a question or myth-buster hook: those earn the first two seconds, and
 * rotating between variants keeps the channel from looking templated.
 */
function pickHook(kb: KbTopic): number {
  const preferred = kb.hooks.findIndex((h) => /^(question|myth|contrarian|number)/i.test(h.type));
  return preferred >= 0 ? preferred : 0;
}

/** Every hook variant, so the experiment system can rotate between them. */
export function hookVariants(kb: KbTopic): string[] {
  return kb.hooks.map((h) => h.text);
}

