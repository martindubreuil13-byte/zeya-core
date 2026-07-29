// Formation Summary Source Fingerprint
// Deterministic SHA-256 hash of canonical governed inputs
// Used to detect summary staleness and validate owner review integrity

import { createHash } from 'crypto';

export interface FingerprintInput {
  generatorVersion: string;
  formationSessionId: string;
  proposalId: string;
  evidence: Array<{
    id: string;
    statement_hash: string;
  }>;
  observations: Array<{
    id: string;
    content: string;
  }>;
  proposedChanges: {
    elementUpdates: Record<string, any>;
  };
  reflectionIdentity: string | null;
}

/**
 * Compute deterministic source fingerprint for Formation review
 * Same inputs → same fingerprint (detection of input staleness)
 * Different inputs → different fingerprint (invalidates review)
 */
export function computeSourceFingerprint(input: FingerprintInput): string {
  const canonical = buildCanonicalFingerprintInput(input);
  const canonicalJson = JSON.stringify(canonical, null, 0);
  const hash = createHash('sha256').update(canonicalJson).digest('hex');
  return hash;
}

/**
 * Build canonical representation for deterministic hashing
 * - Strict key order (generatorVersion, formationSessionId, proposalId, evidence, observations, proposedChanges, reflectionIdentity)
 * - Evidence array sorted by id (UUID ascending)
 * - Observations array sorted by id (UUID ascending)
 * - Proposed changes: only elementUpdates, recursively sorted keys
 * - No whitespace, no timestamps
 */
function buildCanonicalFingerprintInput(
  input: FingerprintInput
): Record<string, any> {
  const sortedEvidence = [...input.evidence].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  const sortedObservations = [...input.observations].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  const sortedElementUpdates = sortObjectKeysRecursively(
    input.proposedChanges.elementUpdates || {}
  );

  return {
    generatorVersion: input.generatorVersion,
    formationSessionId: input.formationSessionId,
    proposalId: input.proposalId,
    evidence: sortedEvidence.map((e) => ({
      id: e.id,
      statement_hash: e.statement_hash,
    })),
    observations: sortedObservations.map((o) => ({
      id: o.id,
      content: o.content,
    })),
    proposedChanges: {
      elementUpdates: sortedElementUpdates,
    },
    reflectionIdentity: input.reflectionIdentity,
  };
}

/**
 * Recursively sort all object keys alphabetically
 * Arrays remain in original order; objects have keys sorted
 */
function sortObjectKeysRecursively(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sortObjectKeysRecursively(item));
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const sorted: Record<string, any> = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    sorted[key] = sortObjectKeysRecursively(obj[key]);
  }

  return sorted;
}

/**
 * Verify fingerprint matches expected value
 * Used during approval to ensure owner reviewed current state
 */
export function verifySourceFingerprint(
  submittedFingerprint: string,
  input: FingerprintInput
): boolean {
  const recomputedFingerprint = computeSourceFingerprint(input);
  return submittedFingerprint === recomputedFingerprint;
}
