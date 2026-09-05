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
 * Zeya presents rich understanding before asking questions.
 * Feels like "I've done my homework" not "I read a database summary."
 */
export function buildPreparedOpening(preparation: OwnerPreparationProjection): PreparedOpening {
  const segments: PreparedOpeningSegment[] = [];

  const intro = `Here's what I've understood so far from your materials and what you've shared:`;

  // WHAT + WHO: Core business identity
  const whatDomain = preparation.domains.whatYouSell;
  const whoDomain = preparation.domains.whoItIsFor;
  const problemDomain = preparation.domains.problemOrAspiration;
  const proposedDescriptionDomain = preparation.domains.proposedDescription;

  // Opening frame: What they do and who they serve
  if (whatDomain?.provisionalUnderstanding && whoDomain?.provisionalUnderstanding) {
    const what = whatDomain.provisionalUnderstanding;
    const who = whoDomain.provisionalUnderstanding;
    segments.push({
      kind: whatDomain.epistemicState === 'supported' ? 'supported' : 'inference',
      content: `You're offering ${what} to ${who}. That's your core play.`,
    });
  }

  // Problem/aspiration: What drives your customer
  if (problemDomain?.provisionalUnderstanding) {
    const problem = problemDomain.provisionalUnderstanding;
    segments.push({
      kind: problemDomain.epistemicState === 'supported' ? 'supported' : 'inference',
      content: `The problem they're facing that you solve is: ${problem}.`,
    });
  }

  // Proposed description: How you describe your solution
  if (proposedDescriptionDomain?.provisionalUnderstanding) {
    const description = proposedDescriptionDomain.provisionalUnderstanding;
    segments.push({
      kind: proposedDescriptionDomain.epistemicState === 'supported' ? 'supported' : 'inference',
      content: `The way I see you describing and positioning this is: ${description}.`,
    });
  }

  // GAPS: What's unclear
  const gaps: Array<{ domain: string; question: string }> = [];

  if (preparation.domains.whyCustomersShouldCare?.epistemicState === 'unknown') {
    gaps.push({
      domain: 'value_articulation',
      question: `How do you help a customer understand why YOUR approach is better than just buying off-the-shelf alternatives or staying with what they have?`,
    });
  }

  if (preparation.domains.authorityBoundaries?.epistemicState === 'unknown') {
    gaps.push({
      domain: 'authority',
      question: `What are the exact boundaries of what you commit to? What's in scope, what's not, and where do you draw the line?`,
    });
  }

  if (preparation.domains.clarificationsNeeded?.provisionalUnderstanding) {
    gaps.push({
      domain: 'clarifications',
      question: `You mentioned that ${preparation.domains.clarificationsNeeded.provisionalUnderstanding}—help me understand that better.`,
    });
  }

  if (gaps.length > 0) {
    const firstGap = gaps[0];
    segments.push({
      kind: 'uncertain',
      content: `What I'm still not crystal clear on is: ${firstGap.question}`,
    });

    if (gaps.length > 1) {
      const secondGap = gaps[1];
      segments.push({
        kind: 'uncertain',
        content: `And also: ${secondGap.question}`,
      });
    }
  }

  // CONTRADICTIONS if present
  for (const contradiction of preparation.contradictions) {
    segments.push({
      kind: 'contradiction',
      content: `I noticed something that seemed inconsistent: your materials emphasize ${contradiction.provisionalUnderstanding}, but I want to understand how that fits with your actual direction.`,
    });
  }

  const transition = `So—is that the shape of it? Where am I off, and what should I understand differently?`;

  return {
    introduction: intro,
    segments,
    transition,
  };
}
