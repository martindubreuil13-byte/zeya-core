// Hypothesis Reasoning Service — Conservative, evidence-grounded synthesis
// Uses Zeya's existing OpenAI infrastructure (gpt-4o via Responses API)

import OpenAI from 'openai';
import type {
  HypothesisReasoningRequest,
  HypothesisReasoningResult,
  EvidenceInput,
  ObservationInput,
} from './hypothesis-reasoning-types';
import {
  validateHypothesisReasoningResult,
  validateHypothesisReasoningInput,
  HypothesisReasoningValidationError,
} from './hypothesis-reasoning-validation';

// Matches OpenAI Responses API structured output schema
const HYPOTHESIS_SCHEMA = {
  type: 'object' as const,
  properties: {
    hypotheses: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          constitutionalDomain: {
            type: 'string',
            enum: [
              'whatYouSell',
              'whoItIsFor',
              'problemOrAspiration',
              'whyCustomersShouldCare',
              'proposedDescription',
              'authorityBoundaries',
              'clarificationsNeeded',
            ],
          },
          epistemicState: {
            type: 'string',
            enum: ['supported', 'partial', 'unknown', 'contradicted'],
          },
          currentBelief: {
            type: ['string', 'null'],
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low', 'unknown'],
          },
          representationRisk: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
          },
          riskReason: {
            type: 'string',
          },
          verificationNeed: {
            type: ['string', 'null'],
          },
          sourceEvidenceIds: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          evidenceCutoffAt: {
            type: 'string',
          },
        },
        required: [
          'constitutionalDomain',
          'epistemicState',
          'currentBelief',
          'confidence',
          'representationRisk',
          'riskReason',
          'verificationNeed',
          'sourceEvidenceIds',
          'evidenceCutoffAt',
        ],
        additionalProperties: false,
      },
      minItems: 7,
      maxItems: 7,
    },
    generatedAt: {
      type: 'string',
    },
  },
  required: ['hypotheses', 'generatedAt'],
  additionalProperties: false,
};

function buildReasoningPrompt(
  req: HypothesisReasoningRequest,
  evidence: EvidenceInput[],
  observations: ObservationInput[]
): string {
  const evidenceText = evidence
    .map(
      e =>
        `Evidence ${e.id}:
  Source Type: ${e.sourceType}
  Page Type: ${e.source_page_type || '(not specified)'}
  Evidence Kind: ${e.source_evidence_kind || '(not specified)'}
  Canonical URL: ${e.canonical_source_url || '(none)'}
  Raw Statement: ${e.rawStatement}
  Domains: ${e.affected_domains.join(', ')}`
    )
    .join('\n\n');

  const observationText = observations
    .map(
      o =>
        `Observation ${o.id} (from Evidence ${o.evidenceId}):
  Interpretation: ${o.interpreted_meaning}
  Confidence: ${o.confidence_in_interpretation}%
  Domains: ${o.affected_domains.join(', ')}`
    )
    .join('\n\n');

  return `DIRECT HIRE CONSTITUTIONAL REASONING SESSION

Owner: ${req.ownerName}
Business: ${req.businessName}
Session: ${req.onboardingSessionId}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AVAILABLE EVIDENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${evidenceText}

${observations.length > 0 ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OBSERVATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${observationText}
` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE PRINCIPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Evidence records what a source stated; it does not establish truth.
2. Observations are provisional interpretations, not verified facts.
3. Contradictions remain unresolved until owner verification.
4. Unknowns remain visible. Do not invent.
5. Owner-provided Evidence and public Evidence must be distinguished.
6. Multiple extracts from one page are NOT independent corroboration.
7. Absence of Evidence does not prove a claim is false or confidential.
8. Confidence and Representation Risk are separate dimensions.
9. High representation risk can exist at any confidence level.
10. Prefer unknown over plausible inference.
11. Do not produce marketing language unsupported by Evidence.
12. Do not reveal chain-of-thought.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONFIDENCE LEVELS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

high:
  MINIMUM REQUIREMENT for public Evidence alone:
  - 2+ independent Evidence sources (distinct canonical URLs)
  - Multiple pages covering the claim
  - Strong Observation corroboration

  ALTERNATIVE for high confidence:
  - owner Evidence explicitly confirming the claim + public Evidence alignment

  FORBIDDEN:
  - Do NOT award high confidence to multiple extracts from ONE page
  - Do NOT award high confidence to claims from single homepage/URL
  - Do NOT infer high confidence from marketing language alone
  - EVEN WITH OBSERVATIONS: single-page public Evidence maxes out at MEDIUM confidence

medium:
  - single page + solid Observation (most common for homepage-only Evidence)
  - OR multiple pages without corroborating independent URL coverage
  - weak Observation support with multiple pages
  - single-page Evidence with strong Observation (standard for business homepages)

low:
  - single source, weak corroboration
  - surface-level Evidence without Observation support
  - single-page Evidence with weak Observation

unknown:
  - no relevant Evidence available

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REPRESENTATION RISK LEVELS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Risk Question: "If Zeya is wrong about this, what damage could occur to the Direct Hire relationship or business representation?"

high:
  - Pricing, rates, payment terms
  - Guarantees, SLAs, uptime commitments
  - Legal claims or compliance statements
  - Technical promises or delivery timelines
  - Negotiation authority or signature authority
  - Target customer identity (material to hiring)
  - Any claim that would expose business to liability if misrepresented
  Default: authority_boundaries should be "high risk + unknown" unless owner explicitly establishes authority

medium:
  - Positioning nuance or differentiation claims
  - Business model or lead prioritization assumptions
  - Tone or brand positioning

low:
  - Descriptive details not materially affecting representation
  - Supporting facts about team or history

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONSTITUTIONAL DOMAINS (exactly 7)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. whatYouSell
   Boundary: the actual offer/service/product (not category language)
   Do NOT infer from: marketing taglines, "we help businesses"
   Return unknown if: only vague or generic statements available

2. whoItIsFor
   Boundary: buyer/customer identity (not growth potential or market size)
   Do NOT infer: from absence of data about audience
   Return unknown if: no Evidence of target customer

3. problemOrAspiration
   Boundary: customer problem or desired outcome (not generic needs)
   Do NOT accept: "we help solve their problems" without specifics
   Return unknown if: no concrete problem stated

4. whyCustomersShouldCare
   Boundary: value, outcome, or differentiation
   Do NOT infer: from marketing copy without corroboration
   Return unknown if: no Evidence of why customer should pay attention

5. proposedDescription
   Boundary: ONE cautious representation-ready sentence
   Synthesis rule: use ONLY from supported/partial hypotheses
   Do NOT: exceed the confidence of supporting Evidence
   Must NOT contain adjectives unsupported by Evidence:
     - NO "leading", "best", "innovative", "highly experienced", "award-winning", "scalable", "cost-effective"
     - NO marketing polish or superlatives
   Use only factual descriptors present in Evidence
   Return unknown if: no supported foundations exist
   Return partial if: insufficient Evidence for certainty
   If unsure, omit the unsupported clause

6. authorityBoundaries
   Boundary: pricing, guarantees, negotiation authority, technical promises, legal claims
   Default posture: unknown + high risk
   Return unknown if: owner Evidence does NOT explicitly establish authority
   Do NOT infer authority from: website content alone, marketing promises, absence of disclaimers
   Return supported ONLY when: owner explicitly establishes authority/pricing/guarantees
   Risk Reason (always required for high risk): "Misrepresenting [X] could expose business to liability or mistrust"

7. clarificationsNeeded
   Boundary: concise summary of most important unresolved areas
   Do NOT: ask generic questions
   Focus on: what would most reduce representation risk or misunderstanding
   List specifically: what to ask owner, what to verify, what remains unknown
   Special rule for this domain:
     - epistemicState should reflect availability of Evidence (typically "unknown")
     - currentBelief may remain null (does not violate contract)
     - verificationNeed contains the specific verification requirements
     - Example: epistemicState=unknown, currentBelief=null, verificationNeed="Confirm pricing authority; verify target customer segments"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generate exactly 7 hypotheses (one per domain).

For each hypothesis:
  - constitutionalDomain: string (one of the 7 above)
  - epistemicState: "supported" | "partial" | "unknown" | "contradicted"
  - currentBelief: string (non-null) OR null (only if unknown; for clarificationsNeeded may be null)
  - confidence: "high" | "medium" | "low" | "unknown"
  - representationRisk: "high" | "medium" | "low"
  - riskReason: string
    - REQUIRED if representationRisk = "medium" or "high"
    - MAY be empty string if representationRisk = "low"
    - Format: "If wrong about this, [consequence]"
  - verificationNeed: string or null
    - Use for clarificationsNeeded domain to specify verification needs
    - May be null if no specific verification need
    - Example: "Confirm pricing authority; verify target customer profile"
  - sourceEvidenceIds: array of Evidence IDs (empty only if unknown)
  - evidenceCutoffAt: ISO-8601 timestamp

CRITICAL RULES:
- If representationRisk = "medium" or "high", riskReason MUST NOT be empty
- If representationRisk = "low", riskReason may be empty
- Unknown epistemicState + non-null currentBelief is ONLY acceptable for clarificationsNeeded domain (with verificationNeed)
- For other domains: unknown ALWAYS means null currentBelief

Return only JSON. No explanation. No chain-of-thought.
`;
}

export async function generateHypotheses(
  req: HypothesisReasoningRequest,
  evidence: EvidenceInput[],
  observations: ObservationInput[]
): Promise<HypothesisReasoningResult> {
  // Validate input scope before calling provider
  validateHypothesisReasoningInput(req, evidence, observations);

  const openai = new OpenAI();
  const prompt = buildReasoningPrompt(req, evidence, observations);

  try {
    const response = await openai.responses.create({
      model: 'gpt-4o',
      instructions: prompt,
      input: [
        {
          role: 'user',
          content: 'Generate hypotheses for all 7 constitutional domains.',
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'hypothesis_reasoning_result',
          schema: HYPOTHESIS_SCHEMA,
          strict: true,
        },
      },
    });

    let result: unknown;
    try {
      result = JSON.parse(response.output_text);
    } catch (parseError) {
      throw new Error(`Failed to parse OpenAI response as JSON: ${String(parseError)}`);
    }

    const evidenceMetadata = new Map(evidence.map(e => [e.id, e]));
    const validated = validateHypothesisReasoningResult(result, new Set(evidence.map(e => e.id)), evidenceMetadata);

    return validated;
  } catch (error) {
    if (error instanceof HypothesisReasoningValidationError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new Error(`Hypothesis reasoning failed: ${error.message}`);
    }
    throw new Error('Hypothesis reasoning failed with unknown error');
  }
}
