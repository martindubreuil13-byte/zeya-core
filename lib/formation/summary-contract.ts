import { computeSourceFingerprint } from './fingerprint';
import type { FormationSummary, FormationSummaryMetadata } from '../../types/formation';

export const FORMATION_SUMMARY_GENERATOR_VERSION = 'rf-b-v2';

export type FormationEvidenceFingerprintRow = {
  id: string;
  statement_hash: string;
};

export type FormationObservationFingerprintRow = {
  id: string;
  interpreted_meaning: string;
};

export type FormationSummaryProposalRow = {
  id: string;
  formation_session_id: string | null;
  proposed_changes: Record<string, any>;
  status: string;
  created_at: string;
};

export function computeFormationSummaryFingerprint(input: {
  formationSessionId: string;
  proposalId: string;
  generatorVersion: string;
  evidence: FormationEvidenceFingerprintRow[];
  observations: FormationObservationFingerprintRow[];
  elementUpdates?: Record<string, unknown>;
}): string {
  return computeSourceFingerprint({
    generatorVersion: input.generatorVersion,
    formationSessionId: input.formationSessionId,
    proposalId: input.proposalId,
    evidence: input.evidence,
    observations: input.observations.map((observation) => ({
      id: observation.id,
      content: observation.interpreted_meaning,
    })),
    proposedChanges: { elementUpdates: input.elementUpdates ?? {} },
    reflectionIdentity: null,
  });
}

export function projectFormationSummary(input: {
  formationSessionId: string;
  proposal: FormationSummaryProposalRow;
  evidence: FormationEvidenceFingerprintRow[];
  observations: FormationObservationFingerprintRow[];
}): FormationSummary | null {
  const metadata = input.proposal.proposed_changes?._metadata as
    | FormationSummaryMetadata
    | undefined;
  const review = input.proposal.proposed_changes?._review as
    | { sections?: FormationSummary['sections'] }
    | undefined;

  if (
    !metadata
    || metadata.formationSessionId !== input.formationSessionId
    || input.proposal.formation_session_id !== input.formationSessionId
    || !Array.isArray(review?.sections)
  ) {
    return null;
  }

  const currentFingerprint = computeFormationSummaryFingerprint({
    formationSessionId: input.formationSessionId,
    proposalId: input.proposal.id,
    generatorVersion: metadata.generatorVersion,
    evidence: input.evidence,
    observations: input.observations,
    elementUpdates: input.proposal.proposed_changes?.elementUpdates ?? {},
  });

  return {
    proposalId: input.proposal.id,
    formationSessionId: input.formationSessionId,
    sourceFingerprint: metadata.sourceFingerprint,
    generatorVersion: metadata.generatorVersion,
    isCurrent:
      input.proposal.status === 'draft'
      && currentFingerprint === metadata.sourceFingerprint,
    createdAt: input.proposal.created_at,
    correctionState: input.proposal.status === 'superseded' ? 'superseded' : 'none',
    sections: review.sections,
  };
}
