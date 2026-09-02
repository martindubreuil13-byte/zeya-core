// Hypothesis Reasoning Validator — Strict governance layer

import type {
  HypothesisReasoningOutput,
  HypothesisReasoningResult,
  ConstitutionalDomain,
  HypothesisReasoningRequest,
  EvidenceInput,
  ObservationInput,
  HypothesisReasoningScope,
} from './hypothesis-reasoning-types';

const VALID_CONSTITUTIONAL_DOMAINS: readonly ConstitutionalDomain[] = [
  'whatYouSell',
  'whoItIsFor',
  'problemOrAspiration',
  'whyCustomersShouldCare',
  'proposedDescription',
  'authorityBoundaries',
  'clarificationsNeeded',
];

const VALID_EPISTEMIC_STATES = new Set(['supported', 'partial', 'unknown', 'contradicted']);
const VALID_CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low', 'unknown']);
const VALID_RISK_LEVELS = new Set(['high', 'medium', 'low']);

export const ALL_DOMAINS_SCOPE: HypothesisReasoningScope = { mode: 'all_domains' };

export type HypothesisValidationRuleCode =
  | 'HYPOTHESIS_INPUT_IDENTITY_MISSING'
  | 'HYPOTHESIS_INPUT_SCOPE_INVALID'
  | 'HYPOTHESIS_INPUT_OBSERVATION_OUT_OF_SCOPE'
  | 'HYPOTHESIS_RESULT_NOT_OBJECT'
  | 'HYPOTHESIS_LIST_NOT_ARRAY'
  | 'HYPOTHESIS_GENERATED_AT_NOT_STRING'
  | 'HYPOTHESIS_COUNT_MISMATCH'
  | 'HYPOTHESIS_ITEM_NOT_OBJECT'
  | 'HYPOTHESIS_DOMAIN_INVALID'
  | 'HYPOTHESIS_DOMAIN_DUPLICATE'
  | 'HYPOTHESIS_SCOPE_DOMAIN_MISMATCH'
  | 'HYPOTHESIS_EPISTEMIC_STATE_INVALID'
  | 'HYPOTHESIS_EPISTEMIC_BELIEF_MISMATCH'
  | 'HYPOTHESIS_CONFIDENCE_INVALID'
  | 'HYPOTHESIS_CONFIDENCE_STATE_MISMATCH'
  | 'HYPOTHESIS_REPRESENTATION_RISK_INVALID'
  | 'HYPOTHESIS_AUTHORITY_RISK_MISMATCH'
  | 'HYPOTHESIS_RISK_REASON_REQUIRED'
  | 'HYPOTHESIS_EVIDENCE_LIST_NOT_ARRAY'
  | 'HYPOTHESIS_EVIDENCE_REQUIRED'
  | 'HYPOTHESIS_UNKNOWN_EVIDENCE_FORBIDDEN'
  | 'HYPOTHESIS_EVIDENCE_ID_NOT_STRING'
  | 'HYPOTHESIS_EVIDENCE_OUT_OF_SCOPE'
  | 'HYPOTHESIS_DUPLICATE_EVIDENCE'
  | 'HYPOTHESIS_HIGH_CONFIDENCE_AUTHORITY_INSUFFICIENT'
  | 'HYPOTHESIS_HIGH_CONFIDENCE_SINGLE_AUTHORITY'
  | 'HYPOTHESIS_VERIFICATION_NEED_INVALID'
  | 'HYPOTHESIS_EVIDENCE_CUTOFF_NOT_STRING'
  | 'HYPOTHESIS_DOMAIN_MISSING';

export type HypothesisValidationDiagnostic = {
  ruleCode: HypothesisValidationRuleCode;
  domain: ConstitutionalDomain | null;
  field: string | null;
  expectedCategory: string;
  actualCategory: string;
};

export function resolveHypothesisReasoningScope(
  req: HypothesisReasoningRequest
): HypothesisReasoningScope {
  return req.scope ?? ALL_DOMAINS_SCOPE;
}

export class HypothesisReasoningValidationError extends Error {
  constructor(message: string, public readonly diagnostic: HypothesisValidationDiagnostic) {
    super(`Hypothesis Reasoning Validation: ${message}`);
    this.name = 'HypothesisReasoningValidationError';
  }
}

function reject(
  ruleCode: HypothesisValidationRuleCode,
  message: string,
  field: string | null,
  expectedCategory: string,
  actualCategory: string,
  domain: ConstitutionalDomain | null = null,
): never {
  throw new HypothesisReasoningValidationError(message, {
    ruleCode,
    domain,
    field,
    expectedCategory,
    actualCategory,
  });
}

// Validate input request before provider call
export function validateHypothesisReasoningInput(
  req: HypothesisReasoningRequest,
  evidence: EvidenceInput[],
  observations: ObservationInput[]
): void {
  if (!req.onboardingSessionId || !req.businessRepresentationId || !req.businessId) {
    reject('HYPOTHESIS_INPUT_IDENTITY_MISSING', 'Request must include required identity fields', null, 'complete-identity', 'missing-identity');
  }

  const scope = resolveHypothesisReasoningScope(req);
  if (scope.mode === 'specific_domain' && !VALID_CONSTITUTIONAL_DOMAINS.includes(scope.constitutionalDomain)) {
    reject('HYPOTHESIS_INPUT_SCOPE_INVALID', 'specific_domain requires a valid constitutionalDomain', 'constitutionalDomain', 'constitutional-domain', 'unrecognized');
  }

  const evidenceIds = new Set(evidence.map(e => e.id));

  // Validate every Observation references Evidence in scope
  for (const obs of observations) {
    if (!evidenceIds.has(obs.evidenceId)) {
      reject('HYPOTHESIS_INPUT_OBSERVATION_OUT_OF_SCOPE', `Observation ${obs.id} references Evidence ${obs.evidenceId} which is not in the supplied scope`, 'evidenceId', 'in-scope', 'out-of-scope');
    }
  }
}

export function validateHypothesisReasoningResult(
  result: unknown,
  suppliedEvidenceIds: Set<string>,
  evidenceMetadata?: Map<string, EvidenceInput>,
  scope: HypothesisReasoningScope = ALL_DOMAINS_SCOPE
): HypothesisReasoningResult {
  if (!result || typeof result !== 'object') {
    reject('HYPOTHESIS_RESULT_NOT_OBJECT', 'Result must be an object', null, 'object', result === null ? 'null' : typeof result);
  }

  const r = result as Record<string, unknown>;

  // Top-level structure
  if (!Array.isArray(r.hypotheses)) {
    reject('HYPOTHESIS_LIST_NOT_ARRAY', 'hypotheses must be an array', 'hypotheses', 'array', typeof r.hypotheses);
  }

  if (typeof r.generatedAt !== 'string') {
    reject('HYPOTHESIS_GENERATED_AT_NOT_STRING', 'generatedAt must be a string', 'generatedAt', 'string', typeof r.generatedAt);
  }

  const hypotheses = r.hypotheses as unknown[];

  const expectedCount = scope.mode === 'specific_domain' ? 1 : 7;
  if (hypotheses.length !== expectedCount) {
    reject('HYPOTHESIS_COUNT_MISMATCH', `Expected exactly ${expectedCount} ${expectedCount === 1 ? 'hypothesis' : 'hypotheses'}, got ${hypotheses.length}`,
      'hypotheses', `count:${expectedCount}`, `count:${hypotheses.length}`);
  }

  const seenDomains = new Set<string>();
  const validated: HypothesisReasoningOutput[] = [];

  for (let i = 0; i < hypotheses.length; i++) {
    const h = hypotheses[i];
    if (!h || typeof h !== 'object') {
      reject('HYPOTHESIS_ITEM_NOT_OBJECT', `Hypothesis ${i} is not an object`, `hypotheses[${i}]`, 'object', h === null ? 'null' : typeof h);
    }

    const hypothesis = h as Record<string, unknown>;

    // Domain validation
    const domain = hypothesis.constitutionalDomain as string;
    if (!VALID_CONSTITUTIONAL_DOMAINS.includes(domain as ConstitutionalDomain)) {
      reject('HYPOTHESIS_DOMAIN_INVALID', `Hypothesis ${i}: invalid constitutional_domain`, 'constitutionalDomain', 'constitutional-domain', 'unrecognized', null);
    }

    if (seenDomains.has(domain)) {
      reject('HYPOTHESIS_DOMAIN_DUPLICATE', 'Duplicate constitutional domain', 'constitutionalDomain', 'unique', 'duplicate', domain as ConstitutionalDomain);
    }
    seenDomains.add(domain);

    if (scope.mode === 'specific_domain' && domain !== scope.constitutionalDomain) {
      reject('HYPOTHESIS_SCOPE_DOMAIN_MISMATCH', 'Constitutional domain does not match reasoning scope', 'constitutionalDomain', 'scope-domain', 'different-domain', domain as ConstitutionalDomain);
    }

    // Epistemic state validation
    const epistemicState = hypothesis.epistemicState as string;
    if (!VALID_EPISTEMIC_STATES.has(epistemicState)) {
      reject('HYPOTHESIS_EPISTEMIC_STATE_INVALID', `Hypothesis ${domain}: invalid epistemic_state`, 'epistemicState', 'recognized-state', 'unrecognized', domain as ConstitutionalDomain);
    }

    // Current belief consistency
    const currentBelief = hypothesis.currentBelief;
    if (epistemicState === 'unknown') {
      // Special case: clarificationsNeeded can have null belief even when unknown
      if (currentBelief !== null && domain !== 'clarificationsNeeded') {
        reject('HYPOTHESIS_EPISTEMIC_BELIEF_MISMATCH', `Hypothesis ${domain}: unknown epistemicState must have null currentBelief`, 'currentBelief', 'null', 'non-null', domain as ConstitutionalDomain);
      }
    } else {
      if (typeof currentBelief !== 'string' || currentBelief.trim().length === 0) {
        reject('HYPOTHESIS_EPISTEMIC_BELIEF_MISMATCH', `Hypothesis ${domain}: non-unknown epistemicState requires non-empty currentBelief`, 'currentBelief', 'non-empty-string', currentBelief === null ? 'null' : 'empty-or-non-string', domain as ConstitutionalDomain);
      }
    }

    // Confidence validation
    const confidence = hypothesis.confidence as string;
    if (!VALID_CONFIDENCE_LEVELS.has(confidence)) {
      reject('HYPOTHESIS_CONFIDENCE_INVALID', `Hypothesis ${domain}: invalid confidence`, 'confidence', 'recognized-confidence', 'unrecognized', domain as ConstitutionalDomain);
    }

    // Confidence/epistemic consistency
    if (epistemicState === 'unknown' && confidence !== 'unknown') {
      reject('HYPOTHESIS_CONFIDENCE_STATE_MISMATCH', `Hypothesis ${domain}: unknown epistemicState must have unknown confidence`, 'confidence', 'unknown', 'non-unknown', domain as ConstitutionalDomain);
    }

    // Representation risk validation
    const representationRisk = hypothesis.representationRisk as string;
    if (!VALID_RISK_LEVELS.has(representationRisk)) {
      reject('HYPOTHESIS_REPRESENTATION_RISK_INVALID', `Hypothesis ${domain}: invalid representationRisk`, 'representationRisk', 'recognized-risk', 'unrecognized', domain as ConstitutionalDomain);
    }

    if (
      scope.mode === 'specific_domain' &&
      scope.constitutionalDomain === 'authorityBoundaries' &&
      representationRisk !== 'high'
    ) {
      reject('HYPOTHESIS_AUTHORITY_RISK_MISMATCH', 'Hypothesis authorityBoundaries: specific-domain re-evaluation requires high representationRisk', 'representationRisk', 'high', 'not-high', domain as ConstitutionalDomain);
    }

    // Risk reason validation
    const riskReason = hypothesis.riskReason;
    if (representationRisk === 'high' || representationRisk === 'medium') {
      if (typeof riskReason !== 'string' || riskReason.trim().length === 0) {
        reject('HYPOTHESIS_RISK_REASON_REQUIRED', `Hypothesis ${domain}: ${representationRisk} risk requires non-empty riskReason`, 'riskReason', 'non-empty-string', riskReason === null ? 'null' : 'empty-or-non-string', domain as ConstitutionalDomain);
      }
    }

    // Source Evidence IDs validation
    if (!Array.isArray(hypothesis.sourceEvidenceIds)) {
      reject('HYPOTHESIS_EVIDENCE_LIST_NOT_ARRAY', `Hypothesis ${domain}: sourceEvidenceIds must be an array`, 'sourceEvidenceIds', 'array', typeof hypothesis.sourceEvidenceIds, domain as ConstitutionalDomain);
    }

    const sourceEvidenceIds = hypothesis.sourceEvidenceIds as unknown[];

    // Evidence requirement: non-unknown requires at least one Evidence ID
    if (epistemicState !== 'unknown' && sourceEvidenceIds.length === 0) {
      reject('HYPOTHESIS_EVIDENCE_REQUIRED', `Hypothesis ${domain}: non-unknown epistemicState requires at least one Evidence ID`, 'sourceEvidenceIds', 'non-empty-array', 'empty-array', domain as ConstitutionalDomain);
    }

    // Unknown must have zero Evidence IDs
    if (epistemicState === 'unknown' && sourceEvidenceIds.length !== 0) {
      reject('HYPOTHESIS_UNKNOWN_EVIDENCE_FORBIDDEN', `Hypothesis ${domain}: unknown epistemicState must have zero Evidence IDs`, 'sourceEvidenceIds', 'empty-array', 'non-empty-array', domain as ConstitutionalDomain);
    }

    // Validate every Evidence ID exists in supplied input
    const seenEvidenceIds = new Set<string>();
    for (const id of sourceEvidenceIds) {
      if (typeof id !== 'string') {
        reject('HYPOTHESIS_EVIDENCE_ID_NOT_STRING', `Hypothesis ${domain}: Evidence ID must be a string`, 'sourceEvidenceIds', 'string-items', typeof id, domain as ConstitutionalDomain);
      }

      if (!suppliedEvidenceIds.has(id)) {
        reject('HYPOTHESIS_EVIDENCE_OUT_OF_SCOPE', `Hypothesis ${domain}: cited Evidence ID not found in supplied input`, 'sourceEvidenceIds', 'in-scope', 'out-of-scope', domain as ConstitutionalDomain);
      }

      if (seenEvidenceIds.has(id)) {
        reject('HYPOTHESIS_DUPLICATE_EVIDENCE', `Hypothesis ${domain}: duplicate Evidence ID`, 'sourceEvidenceIds', 'unique', 'duplicate', domain as ConstitutionalDomain);
      }
      seenEvidenceIds.add(id);
    }

    // EVIDENCE INDEPENDENCE VALIDATION
    if (
      evidenceMetadata &&
      confidence === 'high' &&
      sourceEvidenceIds.length > 0 &&
      epistemicState !== 'unknown'
    ) {
      const citedEvidence = (sourceEvidenceIds as string[])
        .map(id => evidenceMetadata.get(id))
        .filter(Boolean) as EvidenceInput[];

      const publicEvidence = citedEvidence.filter(e => e.sourceType === 'public_website');
      const ownerEvidence = citedEvidence.filter(e =>
        e.sourceType === 'conversation' || e.sourceType === 'direct_hire_induction'
      );

      // High confidence from public Evidence alone requires multiple independently
      // classified authority groups. Artifact and source counts are insufficient.
      if (ownerEvidence.length === 0 && publicEvidence.length > 0) {
        const authorityKeys = new Set(publicEvidence
          .filter(e => e.authority_type === 'independent_third_party')
          .map(e => e.authority_key));

        if (authorityKeys.size < 2) {
          reject('HYPOTHESIS_HIGH_CONFIDENCE_AUTHORITY_INSUFFICIENT', `${domain}: high confidence from public Evidence alone requires 2+ independent authorities; distinct URLs or multiple artifacts from a single page are insufficient; found ${authorityKeys.size}`, 'confidence', '2+-independent-authorities', `independent-authorities:${authorityKeys.size}`, domain as ConstitutionalDomain);
        }
      }

      // Repeated artifacts or pages from one authority cannot independently
      // establish high confidence.
      if (publicEvidence.length > 0 && ownerEvidence.length === 0) {
        const uniqueAuthorities = new Set(publicEvidence.map(e => e.authority_key));
        if (uniqueAuthorities.size === 1 && publicEvidence.length > 1) {
          reject('HYPOTHESIS_HIGH_CONFIDENCE_SINGLE_AUTHORITY', `${domain}: multiple Evidence artifacts or sources from one authority cannot achieve high confidence without owner corroboration`, 'confidence', 'multiple-authorities-or-owner', 'single-public-authority', domain as ConstitutionalDomain);
        }
      }
    }

    // Verification need validation
    const verificationNeed = hypothesis.verificationNeed;
    if (verificationNeed !== null && typeof verificationNeed !== 'string') {
      reject('HYPOTHESIS_VERIFICATION_NEED_INVALID', `Hypothesis ${domain}: verificationNeed must be string or null`, 'verificationNeed', 'string-or-null', typeof verificationNeed, domain as ConstitutionalDomain);
    }

    // Evidence cutoff timestamp
    const evidenceCutoffAt = hypothesis.evidenceCutoffAt;
    if (typeof evidenceCutoffAt !== 'string') {
      reject('HYPOTHESIS_EVIDENCE_CUTOFF_NOT_STRING', `Hypothesis ${domain}: evidenceCutoffAt must be an ISO-8601 string`, 'evidenceCutoffAt', 'string', typeof evidenceCutoffAt, domain as ConstitutionalDomain);
    }

    // Validate ISO-8601 format
    try {
      new Date(evidenceCutoffAt);
    } catch {
        reject('HYPOTHESIS_EVIDENCE_CUTOFF_NOT_STRING', `Hypothesis ${domain}: invalid ISO-8601 timestamp`, 'evidenceCutoffAt', 'iso-8601-string', 'invalid-string', domain as ConstitutionalDomain);
    }

    validated.push({
      constitutionalDomain: domain as ConstitutionalDomain,
      epistemicState: epistemicState as any,
      currentBelief: (currentBelief as string) || null,
      confidence: confidence as any,
      representationRisk: representationRisk as any,
      riskReason: (riskReason as string) || '',
      verificationNeed: (verificationNeed as string) || null,
      sourceEvidenceIds: sourceEvidenceIds as string[],
      evidenceCutoffAt,
    });
  }

  if (scope.mode === 'all_domains') {
    // Verify all 7 domains are present (may be out of order)
    const domainSet = new Set(validated.map(h => h.constitutionalDomain));
    for (const domain of VALID_CONSTITUTIONAL_DOMAINS) {
      if (!domainSet.has(domain)) {
        reject('HYPOTHESIS_DOMAIN_MISSING', 'Missing constitutional domain', 'constitutionalDomain', 'all-required-domains', 'missing-domain', domain);
      }
    }
  }

  return {
    hypotheses: validated,
    generatedAt: r.generatedAt as string,
  };
}
