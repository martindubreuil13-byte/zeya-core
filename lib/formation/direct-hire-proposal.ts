export const DIRECT_HIRE_FORMATION_PROPOSAL_CONTRACT = 'direct-hire-formation-proposal-v1';

export type DirectHireProposalRow = {
  id: string;
  status: string;
  proposed_changes: { _review?: { headline?: string }; elementUpdates?: Record<string, { after?: unknown; reason?: unknown }> };
};

export function projectDirectHireFormationProposal(row: DirectHireProposalRow) {
  const updates = Object.entries(row.proposed_changes.elementUpdates ?? {}).flatMap(([domain, value]) =>
    typeof value.after === 'string' && value.after.trim()
      ? [{ domain, proposedValue: value.after.trim(), reason: typeof value.reason === 'string' ? value.reason : 'Confirmed during Formation' }]
      : []);
  return {
    proposalId: row.id,
    status: row.status,
    requiresApproval: true,
    message: row.proposed_changes._review?.headline ?? 'Here is how I propose representing your business.',
    elementUpdates: updates,
  };
}
