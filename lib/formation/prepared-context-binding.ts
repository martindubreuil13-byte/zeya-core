export const IMMUTABLE_SNAPSHOT_V6_MODE = 'immutable_snapshot_v6' as const;
export type PreparedContextIdentity = {
  formationSessionId: string;
  businessRepresentationId: string;
  preparationBriefId: string;
  hypothesisSnapshotIds: string[];
  preparationContractVersion: string;
  reasoningContractVersion: string;
};

function sortedIds(ids: string[]): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export function preparedContextIdentitiesMatch(expected: PreparedContextIdentity, actual: PreparedContextIdentity): boolean {
  const expectedIds = sortedIds(expected.hypothesisSnapshotIds);
  const actualIds = sortedIds(actual.hypothesisSnapshotIds);
  return expected.formationSessionId === actual.formationSessionId
    && expected.businessRepresentationId === actual.businessRepresentationId
    && expected.preparationBriefId === actual.preparationBriefId
    && expected.preparationContractVersion === actual.preparationContractVersion
    && expected.reasoningContractVersion === actual.reasoningContractVersion
    && expectedIds.length === actualIds.length
    && expectedIds.every((id, index) => id === actualIds[index]);
}

export class SnapshotBindingConflictError extends Error {
  constructor() {
    super('snapshot_binding_conflict');
    this.name = 'SnapshotBindingConflictError';
  }
}

export async function ensureImmutablePreparedContext(input: {
  expected: PreparedContextIdentity;
  load: () => Promise<PreparedContextIdentity | null>;
  create: () => Promise<'created' | 'already_bound'>;
}): Promise<'created' | 'existing' | 'reconciled'> {
  const existing = await input.load();
  if (existing) {
    if (!preparedContextIdentitiesMatch(input.expected, existing)) throw new SnapshotBindingConflictError();
    return 'existing';
  }
  const createResult = await input.create();
  if (createResult === 'created') return 'created';
  const concurrentlyCreated = await input.load();
  if (!concurrentlyCreated || !preparedContextIdentitiesMatch(input.expected, concurrentlyCreated)) {
    throw new SnapshotBindingConflictError();
  }
  return 'reconciled';
}
