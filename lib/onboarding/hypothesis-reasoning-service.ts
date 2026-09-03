// Hypothesis Reasoning Service — Conservative, evidence-grounded synthesis
// Uses Zeya's existing OpenAI infrastructure (gpt-4o via Responses API)

import OpenAI from 'openai';
import type {
  HypothesisReasoningRequest,
  HypothesisReasoningResult,
  EvidenceInput,
  ObservationInput,
  ConstitutionalDomain,
  HypothesisReasoningScope,
} from './hypothesis-reasoning-types';
import {
  validateHypothesisReasoningResult,
  validateHypothesisReasoningInput,
  HypothesisReasoningValidationError,
  resolveHypothesisReasoningScope,
  type HypothesisValidationDiagnostic,
} from './hypothesis-reasoning-validation';

export const HYPOTHESIS_REASONING_CONTRACT_VERSION = '1.1-source-semantics';

export type RedactedHypothesisCandidate = {
  domain: string | null;
  epistemicState: string | null;
  confidence: string | null;
  representationRisk: string | null;
  evidenceIds: string[];
  beliefPresence: 'null' | 'non-null' | 'missing';
};

export type RedactedHypothesisCandidateShape = {
  hypothesisCount: number | null;
  generatedAtPresent: boolean;
  hypotheses: RedactedHypothesisCandidate[];
};

export function redactHypothesisCandidate(candidate: unknown): RedactedHypothesisCandidateShape {
  if (!candidate || typeof candidate !== 'object') {
    return { hypothesisCount: null, generatedAtPresent: false, hypotheses: [] };
  }
  const record = candidate as Record<string, unknown>;
  const hypotheses = Array.isArray(record.hypotheses) ? record.hypotheses : [];
  return {
    hypothesisCount: Array.isArray(record.hypotheses) ? hypotheses.length : null,
    generatedAtPresent: typeof record.generatedAt === 'string',
    hypotheses: hypotheses.map((item) => {
      const hypothesis = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        domain: typeof hypothesis.constitutionalDomain === 'string' ? hypothesis.constitutionalDomain : null,
        epistemicState: typeof hypothesis.epistemicState === 'string' ? hypothesis.epistemicState : null,
        confidence: typeof hypothesis.confidence === 'string' ? hypothesis.confidence : null,
        representationRisk: typeof hypothesis.representationRisk === 'string' ? hypothesis.representationRisk : null,
        evidenceIds: Array.isArray(hypothesis.sourceEvidenceIds)
          ? hypothesis.sourceEvidenceIds.filter((id): id is string => typeof id === 'string')
          : [],
        beliefPresence: !Object.prototype.hasOwnProperty.call(hypothesis, 'currentBelief')
          ? 'missing'
          : hypothesis.currentBelief === null ? 'null' : 'non-null',
      };
    }),
  };
}

const CONSTITUTIONAL_DOMAINS: ConstitutionalDomain[] = [
  'whatYouSell',
  'whoItIsFor',
  'problemOrAspiration',
  'whyCustomersShouldCare',
  'proposedDescription',
  'authorityBoundaries',
  'clarificationsNeeded',
];

export type PreparationReasoningStageCode =
  | 'preparation_reasoning_snapshot_invalid'
  | 'preparation_reasoning_observation_scope_invalid'
  | 'preparation_reasoning_input_validation_failed'
  | 'preparation_reasoning_provider_unavailable'
  | 'preparation_reasoning_provider_failed'
  | 'preparation_reasoning_output_validation_failed'
  | 'preparation_reasoning_persistence_failed'
  | 'preparation_reasoning_readback_failed';

export class PreparationReasoningStageError extends Error {
  constructor(
    public readonly stageCode: PreparationReasoningStageCode,
    public readonly validationDiagnostic?: HypothesisValidationDiagnostic,
    public readonly redactedCandidate?: RedactedHypothesisCandidateShape,
  ) {
    super(stageCode);
    this.name = 'PreparationReasoningStageError';
  }
}

export function createReasoningOutputValidationFailure(
  error: HypothesisReasoningValidationError,
  candidate: unknown,
): PreparationReasoningStageError {
  return new PreparationReasoningStageError(
    'preparation_reasoning_output_validation_failed',
    error.diagnostic,
    redactHypothesisCandidate(candidate),
  );
}

// Matches OpenAI Responses API structured output schema.
export function buildHypothesisSchema(
  scope: HypothesisReasoningScope,
  allowedEvidenceIds: string[]
) {
  const outputCount = scope.mode === 'specific_domain' ? 1 : 7;
  const domainEnum = scope.mode === 'specific_domain'
    ? [scope.constitutionalDomain]
    : CONSTITUTIONAL_DOMAINS;

  return {
    type: 'object' as const,
    properties: {
      hypotheses: {
        type: 'array' as const,
        items: {
        type: 'object' as const,
        properties: {
          constitutionalDomain: {
            type: 'string',
            enum: domainEnum,
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
            items: allowedEvidenceIds.length > 0
              ? { type: 'string', enum: allowedEvidenceIds }
              : { type: 'string' },
            ...(allowedEvidenceIds.length === 0 ? { maxItems: 0 } : {}),
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
        minItems: outputCount,
        maxItems: outputCount,
      },
      generatedAt: {
        type: 'string',
      },
    },
    required: ['hypotheses', 'generatedAt'],
    additionalProperties: false,
  };
}

export function scopeReasoningInputs(
  scope: HypothesisReasoningScope,
  evidence: EvidenceInput[],
  observations: ObservationInput[]
): { evidence: EvidenceInput[]; observations: ObservationInput[] } {
  if (scope.mode === 'all_domains') return { evidence, observations };

  const scopedEvidence = evidence.filter(item =>
    item.affected_domains.includes(scope.constitutionalDomain)
  );
  const scopedEvidenceIds = new Set(scopedEvidence.map(item => item.id));
  const scopedObservations = observations.filter(item =>
    item.affected_domains.includes(scope.constitutionalDomain) &&
    (item.evidenceIds ?? [item.evidenceId]).every(id => scopedEvidenceIds.has(id))
  );
  return { evidence: scopedEvidence, observations: scopedObservations };
}

export function buildReasoningPrompt(
  req: HypothesisReasoningRequest,
  evidence: EvidenceInput[],
  observations: ObservationInput[]
): string {
  const scope = resolveHypothesisReasoningScope(req);
  const scopeInstruction = scope.mode === 'specific_domain'
    ? `You are re-evaluating ONLY ${scope.constitutionalDomain}. Do not make or revise conclusions for any other constitutional domain.`
    : 'You are evaluating all seven constitutional domains.';
  const outputInstruction = scope.mode === 'specific_domain'
    ? `Generate exactly 1 hypothesis for ${scope.constitutionalDomain}.`
    : 'Generate exactly 7 hypotheses (one per domain).';
  const evidenceText = evidence
    .map(
      e =>
        `Evidence ${e.id}:
  Source Type: ${e.sourceType}
  Page Type: ${e.source_page_type || '(not specified)'}
  Evidence Kind: ${e.source_evidence_kind || '(not specified)'}
  Location: ${e.source_selector || '(not specified)'}
  Canonical URL: ${e.canonical_source_url || '(none)'}
  Logical Source: ${e.logical_source_key || `unknown-source:${e.id}`}
  Authority Type: ${e.authority_type || 'unknown'}
  Authority Group: ${e.authority_key || `unknown-authority:${e.id}`}
  Retrieved At: ${e.source_retrieved_at || '(not specified)'}
  Content Hash: ${e.source_content_hash || '(not specified)'}
  Raw Statement: ${e.rawStatement}
  Domains: ${e.affected_domains.join(', ')}`
    )
    .join('\n\n');

  const observationText = observations
    .map(
      o =>
        `Observation ID — NON-CITABLE: ${o.id}
  Category: ${o.category ?? 'legacy interpretation'}
  CITABLE SUPPORTING EVIDENCE IDS: ${(o.evidenceIds ?? [o.evidenceId]).join(', ')}
  Interpretation: ${o.interpreted_meaning}
  Confidence: ${o.confidence_in_interpretation}%
  Domains: ${o.affected_domains.join(', ')}`
    )
    .join('\n\n');

  return `DIRECT HIRE CONSTITUTIONAL REASONING SESSION

Owner: ${req.ownerName}
Business: ${req.businessName}
Session: ${req.onboardingSessionId}

REASONING SCOPE
${scopeInstruction}

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
   Owner Evidence is stronger verification Evidence but still a sourced statement, not objective truth.
2. Observations are provisional interpretations, not verified facts.
3. Contradictions remain unresolved until owner verification.
4. Unknowns remain visible. Do not invent.
5. Owner-provided Evidence and public Evidence must be distinguished.
6. Artifact count is not source count. Evidence sharing a Logical Source is one source.
7. Source count is not authority count. Evidence sharing an Authority Group is one authority.
8. Multiple extracts from one webpage are one source, never independent corroboration.
9. Multiple pages from one company website are normally one first-party authority.
10. Owner testimony and company-site claims are different origins, but are not automatically independent third-party confirmation.
11. Unknown authority relationships must not be treated as independent corroboration.
12. Repeated first-party wording must not inflate confidence.
    Even distinct canonical URLs are NOT independent when they share one authority group.
13. Absence of Evidence does not prove a claim is false or confidential.
14. Confidence and Representation Risk are separate dimensions.
15. A high representation risk can exist at any confidence level.
16. Prefer unknown over plausible inference.
17. Do not produce marketing language unsupported by Evidence.
18. Do not reveal chain-of-thought.
19. A synthesized Observation may cite several Evidence records. Preserve every cited Evidence ID when using it; never cite the Observation ID as Evidence.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONFIDENCE LEVELS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

high:
  MINIMUM REQUIREMENT for public Evidence alone:
  - 2+ genuinely independent authority groups
  - Multiple sources covering the claim
  - Strong Observation corroboration

  ALTERNATIVE for high confidence:
  - owner Evidence explicitly confirming the claim + aligned first-party public Evidence,
    only when the claim is within the owner's authority to confirm

  FORBIDDEN:
  - Do NOT award high confidence to multiple extracts from ONE page
  - Do NOT award high confidence merely to multiple pages from ONE authority
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
CONSTITUTIONAL DOMAIN RULES
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

${outputInstruction}

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
  try {
    validateHypothesisReasoningInput(req, evidence, observations);
  } catch {
    throw new PreparationReasoningStageError('preparation_reasoning_input_validation_failed');
  }

  const scope = resolveHypothesisReasoningScope(req);
  const scopedInputs = scopeReasoningInputs(scope, evidence, observations);
  const scopedEvidence = scopedInputs.evidence;
  const scopedEvidenceIds = new Set(scopedEvidence.map(item => item.id));
  const scopedObservations = scopedInputs.observations;

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new PreparationReasoningStageError('preparation_reasoning_provider_unavailable');
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = buildReasoningPrompt(req, scopedEvidence, scopedObservations);
  let result: unknown;

  try {
    const response = await openai.responses.create({
      model: 'gpt-4o',
      instructions: prompt,
      input: [
        {
          role: 'user',
          content: scope.mode === 'specific_domain'
            ? `Generate one hypothesis for ${scope.constitutionalDomain} only.`
            : 'Generate hypotheses for all 7 constitutional domains.',
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'hypothesis_reasoning_result',
          schema: buildHypothesisSchema(scope, [...scopedEvidenceIds]),
          strict: true,
        },
      },
    });

    try {
      result = JSON.parse(response.output_text);
    } catch (parseError) {
      throw new Error(`Failed to parse OpenAI response as JSON: ${String(parseError)}`);
    }

    const evidenceMetadata = new Map(scopedEvidence.map(e => [e.id, e]));
    const validated = validateHypothesisReasoningResult(
      result,
      scopedEvidenceIds,
      evidenceMetadata,
      scope
    );

    return validated;
  } catch (error) {
    if (error instanceof HypothesisReasoningValidationError) {
      throw createReasoningOutputValidationFailure(error, result);
    }
    throw new PreparationReasoningStageError('preparation_reasoning_provider_failed');
  }
}
