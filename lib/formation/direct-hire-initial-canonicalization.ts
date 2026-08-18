export type InitialCanonicalizationDecision = 'approve' | 'reject' | 'correct';

export function isInitialCanonicalizationDecision(value: unknown): value is InitialCanonicalizationDecision {
  return value === 'approve' || value === 'reject' || value === 'correct';
}

export function ownerSafeInitialCanonicalization(row: Record<string, unknown>) {
  const representation = row.representation && typeof row.representation === 'object'
    ? Object.entries(row.representation as Record<string, unknown>).map(([domain, value]) => ({
        domain,
        value: value && typeof value === 'object' && 'value' in value ? (value as { value: unknown }).value : value,
      }))
    : [];
  return {
    approved: row.approved === true,
    replayed: row.replayed === true,
    versionId: typeof row.version_id === 'string' ? row.version_id : null,
    status: row.proposal_status,
    representation,
  };
}
