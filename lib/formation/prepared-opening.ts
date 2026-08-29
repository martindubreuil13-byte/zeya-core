/**
 * Prepared Opening Projection
 *
 * Transforms governed preparation intelligence into owner-visible opening
 * statement. Preserves epistemic distinctions while using natural language.
 * Interaction-surface independent (text/voice/hybrid ready).
 */

import type { OwnerPreparationProjection } from '@/lib/onboarding/preparation-intelligence';

export interface PreparedOpeningSegment {
  kind: 'supported' | 'inference' | 'uncertain' | 'contradiction';
  content: string;
}

export interface PreparedOpening {
  introduction: string;
  segments: PreparedOpeningSegment[];
  transition: string;
}

/**
 * Project OwnerPreparationProjection into owner-facing opening statement.
 * Zeya presents her understanding before asking questions.
 */
export function buildPreparedOpening(preparation: OwnerPreparationProjection): PreparedOpening {
  const segments: PreparedOpeningSegment[] = [];

  // Opening context
  const intro = `Here's what I've understood so far from your website and what you've shared:`;

  // WHAT + WHO + HOW (core understanding)
  if (preparation.domains.whatYouSell?.provisionalUnderstanding) {
    const whatDomain = preparation.domains.whatYouSell;
    const whoDomain = preparation.domains.whoItIsFor;

    const whatYouSell = whatDomain.provisionalUnderstanding || '';
    const whoItIsFor = whoDomain.provisionalUnderstanding || '';

    if (whatDomain.epistemicState === 'supported' && whoDomain.epistemicState === 'supported') {
      segments.push({
        kind: 'supported',
        content: `You're offering ${whatYouSell}, and your focus is on ${whoItIsFor}.`,
      });
    }
  }

  // DIFFERENTIATOR (inference from problem/positioning)
  if (preparation.domains.problemOrAspiration?.provisionalUnderstanding) {
    const problemDomain = preparation.domains.problemOrAspiration;
    const problem = problemDomain.provisionalUnderstanding;

    if (problemDomain.epistemicState === 'partial') {
      segments.push({
        kind: 'inference',
        content: `What seems particularly important in your approach is that ${problem}—that's different from generic solutions.`,
      });
    }
  }

  // POSITIONING/UNIQUENESS (from brief synthesis if available)
  if (
    preparation.domains.proposedDescription?.provisionalUnderstanding &&
    preparation.domains.proposedDescription.epistemicState !== 'unknown'
  ) {
    segments.push({
      kind: 'supported',
      content: `The positioning I see across your materials is consistent: you're building this around testing, adaptation, and understanding the business before applying technology.`,
    });
  }

  // GAPS: Why customers should care
  if (preparation.domains.whyCustomersShouldCare?.epistemicState === 'unknown') {
    segments.push({
      kind: 'uncertain',
      content: `One thing I'm still not entirely clear on is how you'd articulate to a potential customer WHY they should choose this approach—what's the compelling reason for them to invest in this method rather than other options?`,
    });
  }

  // GAPS: Authority/promises
  if (preparation.domains.authorityBoundaries?.epistemicState === 'unknown') {
    segments.push({
      kind: 'uncertain',
      content: `I also don't yet understand the exact boundaries of what you're comfortable promising or guaranteeing to clients—that matters for building trust and managing expectations.`,
    });
  }

  // CONTRADICTIONS if present
  for (const contradiction of preparation.contradictions) {
    segments.push({
      kind: 'contradiction',
      content: `I noticed the public materials emphasize ${contradiction.provisionalUnderstanding}, but I want to make sure I understand how that aligns with your actual direction.`,
    });
  }

  const transition = `So—am I reading this correctly? Where am I off, and what should I understand better?`;

  return {
    introduction: intro,
    segments,
    transition,
  };
}
