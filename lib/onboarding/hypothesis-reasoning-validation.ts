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

export function resolveHypothesisReasoningScope(
  req: HypothesisReasoningRequest
): HypothesisReasoningScope {
  return req.scope ?? ALL_DOMAINS_SCOPE;
}

export class HypothesisReasoningValidationError extends Error {
  constructor(message: string) {
    super(`Hypothesis Reasoning Validation: ${message}`);
    this.name = 'HypothesisReasoningValidationError';
  }
}

// Validate input request before provider call
export function validateHypothesisReasoningInput(
  req: HypothesisReasoningRequest,
  evidence: EvidenceInput[],
  observations: ObservationInput[]
): void {
  if (!req.onboardingSessionId || !req.businessRepresentationId || !req.businessId) {
    throw new HypothesisReasoningValidationError(
      'Request must include onboardingSessionId, businessRepresentationId, and businessId'
    );
  }

  const scope = resolveHypothesisReasoningScope(req);
  if (scope.mode === 'specific_domain' && !VALID_CONSTITUTIONAL_DOMAINS.includes(scope.constitutionalDomain)) {
    throw new HypothesisReasoningValidationError('specific_domain requires a valid constitutionalDomain');
  }

  const evidenceIds = new Set(evidence.map(e => e.id));

  // Validate every Observation references Evidence in scope
  for (const obs of observations) {
    if (!evidenceIds.has(obs.evidenceId)) {
      throw new HypothesisReasoningValidationError(
        `Observation ${obs.id} references Evidence ${obs.evidenceId} which is not in the supplied scope`
      );
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
    throw new HypothesisReasoningValidationError('Result must be an object');
  }

  const r = result as Record<string, unknown>;

  // Top-level structure
  if (!Array.isArray(r.hypotheses)) {
    throw new HypothesisReasoningValidationError('hypotheses must be an array');
  }

  if (typeof r.generatedAt !== 'string') {
    throw new HypothesisReasoningValidationError('generatedAt must be a string');
  }

  const hypotheses = r.hypotheses as unknown[];

  const expectedCount = scope.mode === 'specific_domain' ? 1 : 7;
  if (hypotheses.length !== expectedCount) {
    throw new HypothesisReasoningValidationError(
      `Expected exactly ${expectedCount} ${expectedCount === 1 ? 'hypothesis' : 'hypotheses'}, got ${hypotheses.length}`
    );
  }

  const seenDomains = new Set<string>();
  const validated: HypothesisReasoningOutput[] = [];

  for (let i = 0; i < hypotheses.length; i++) {
    const h = hypotheses[i];
    if (!h || typeof h !== 'object') {
      throw new HypothesisReasoningValidationError(`Hypothesis ${i} is not an object`);
    }

    const hypothesis = h as Record<string, unknown>;

    // Domain validation
    const domain = hypothesis.constitutionalDomain as string;
    if (!VALID_CONSTITUTIONAL_DOMAINS.includes(domain as ConstitutionalDomain)) {
      throw new HypothesisReasoningValidationError(
        `Hypothesis ${i}: invalid constitutional_domain "${domain}"`
      );
    }

    if (seenDomains.has(domain)) {
      throw new HypothesisReasoningValidationError(`Duplicate constitutional domain: "${domain}"`);
    }
    seenDomains.add(domain);

    if (scope.mode === 'specific_domain' && domain !== scope.constitutionalDomain) {
      throw new HypothesisReasoningValidationError(
        `Expected constitutional domain "${scope.constitutionalDomain}", got "${domain}"`
      );
    }

    // Epistemic state validation
    const epistemicState = hypothesis.epistemicState as string;
    if (!VALID_EPISTEMIC_STATES.has(epistemicState)) {
      throw new HypothesisReasoningValidationError(
        `Hypothesis ${domain}: invalid epistemic_state "${epistemicState}"`
      );
    }

    // Current belief consistency
    const currentBelief = hypothesis.currentBelief;
    if (epistemicState === 'unknown') {
      // Special case: clarificationsNeeded can have null belief even when unknown
      if (currentBelief !== null && domain !== 'clarificationsNeeded') {
        throw new HypothesisReasoningValidationError(
          `Hypothesis ${domain}: unknown epistemicState must have null currentBelief`
        );
      }
    } else {
      if (typeof currentBelief !== 'string' || currentBelief.trim().length === 0) {
        throw new HypothesisReasoningValidationError(
          `Hypothesis ${domain}: non-unknown epistemicState requires non-empty currentBelief`
        );
      }
    }

    // Confidence validation
    const confidence = hypothesis.confidence as string;
    if (!VALID_CONFIDENCE_LEVELS.has(confidence)) {
      throw new HypothesisReasoningValidationError(`Hypothesis ${domain}: invalid confidence "${confidence}"`);
    }

    // Confidence/epistemic consistency
    if (epistemicState === 'unknown' && confidence !== 'unknown') {
      throw new HypothesisReasoningValidationError(
        `Hypothesis ${domain}: unknown epistemicState must have unknown confidence`
      );
    }

    // Representation risk validation
    const representationRisk = hypothesis.representationRisk as string;
    if (!VALID_RISK_LEVELS.has(representationRisk)) {
      throw new HypothesisReasoningValidationError(`Hypothesis ${domain}: invalid representationRisk "${representationRisk}"`);
    }

    if (
      scope.mode === 'specific_domain' &&
      scope.constitutionalDomain === 'authorityBoundaries' &&
      representationRisk !== 'high'
    ) {
      throw new HypothesisReasoningValidationError(
        'Hypothesis authorityBoundaries: specific-domain re-evaluation requires high representationRisk'
      );
    }

    // Risk reason validation
    const riskReason = hypothesis.riskReason;
    if (representationRisk === 'high' || representationRisk === 'medium') {
      if (typeof riskReason !== 'string' || riskReason.trim().length === 0) {
        throw new HypothesisReasoningValidationError(
          `Hypothesis ${domain}: ${representationRisk} risk requires non-empty riskReason`
        );
      }
    }

    // Source Evidence IDs validation
    if (!Array.isArray(hypothesis.sourceEvidenceIds)) {
      throw new HypothesisReasoningValidationError(`Hypothesis ${domain}: sourceEvidenceIds must be an array`);
    }

    const sourceEvidenceIds = hypothesis.sourceEvidenceIds as unknown[];

    // Evidence requirement: non-unknown requires at least one Evidence ID
    if (epistemicState !== 'unknown' && sourceEvidenceIds.length === 0) {
      throw new HypothesisReasoningValidationError(
        `Hypothesis ${domain}: non-unknown epistemicState requires at least one Evidence ID`
      );
    }

    // Unknown must have zero Evidence IDs
    if (epistemicState === 'unknown' && sourceEvidenceIds.length !== 0) {
      throw new HypothesisReasoningValidationError(`Hypothesis ${domain}: unknown epistemicState must have zero Evidence IDs`);
    }

    // Validate every Evidence ID exists in supplied input
    const seenEvidenceIds = new Set<string>();
    for (const id of sourceEvidenceIds) {
      if (typeof id !== 'string') {
        throw new HypothesisReasoningValidationError(`Hypothesis ${domain}: Evidence ID must be a string`);
      }

      if (!suppliedEvidenceIds.has(id)) {
        throw new HypothesisReasoningValidationError(
          `Hypothesis ${domain}: cited Evidence ID "${id}" not found in supplied input`
        );
      }

      if (seenEvidenceIds.has(id)) {
        throw new HypothesisReasoningValidationError(`Hypothesis ${domain}: duplicate Evidence ID "${id}"`);
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
          throw new HypothesisReasoningValidationError(
            `${domain}: high confidence from public Evidence alone requires 2+ independent authorities; distinct URLs or multiple artifacts from a single page are insufficient; found ${authorityKeys.size}`
          );
        }
      }

      // Repeated artifacts or pages from one authority cannot independently
      // establish high confidence.
      if (publicEvidence.length > 0 && ownerEvidence.length === 0) {
        const uniqueAuthorities = new Set(publicEvidence.map(e => e.authority_key));
        if (uniqueAuthorities.size === 1 && publicEvidence.length > 1) {
          throw new HypothesisReasoningValidationError(
            `${domain}: multiple Evidence artifacts or sources from one authority cannot achieve high confidence without owner corroboration`
          );
        }
      }
    }

    // Verification need validation
    const verificationNeed = hypothesis.verificationNeed;
    if (verificationNeed !== null && typeof verificationNeed !== 'string') {
      throw new HypothesisReasoningValidationError(`Hypothesis ${domain}: verificationNeed must be string or null`);
    }

    // Evidence cutoff timestamp
    const evidenceCutoffAt = hypothesis.evidenceCutoffAt;
    if (typeof evidenceCutoffAt !== 'string') {
      throw new HypothesisReasoningValidationError(`Hypothesis ${domain}: evidenceCutoffAt must be an ISO-8601 string`);
    }

    // Validate ISO-8601 format
    try {
      new Date(evidenceCutoffAt);
    } catch {
      throw new HypothesisReasoningValidationError(
        `Hypothesis ${domain}: invalid ISO-8601 timestamp "${evidenceCutoffAt}"`
      );
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
        throw new HypothesisReasoningValidationError(`Missing constitutional domain: "${domain}"`);
      }
    }
  }

  return {
    hypotheses: validated,
    generatedAt: r.generatedAt as string,
  };
}
