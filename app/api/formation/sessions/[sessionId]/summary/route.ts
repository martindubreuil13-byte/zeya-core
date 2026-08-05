import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import {
  computeFormationSummaryFingerprint,
  FORMATION_SUMMARY_GENERATOR_VERSION,
  projectFormationSummary,
  type FormationEvidenceFingerprintRow,
  type FormationObservationFingerprintRow,
  type FormationSummaryProposalRow,
} from '@/lib/formation/summary-contract';
import type { FormationSummaryMetadata, FormationSummarySection } from '@/types/formation';

type FormationRow = {
  id: string;
  business_representation_id: string;
  status: string;
  first_working_conversation_id: string | null;
};

type EvidenceRow = FormationEvidenceFingerprintRow & {
  raw_statement: string;
  source_formation_session_id: string | null;
};

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

async function loadOwnedFormation(
  db: SupabaseClient,
  sessionId: string,
  ownerId: string,
): Promise<FormationRow | null> {
  const result = await db
    .from('representation_formation_sessions')
    .select('id,business_representation_id,status,first_working_conversation_id')
    .eq('id', sessionId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (result.error) throw new Error('formation_lookup_failed');
  return result.data as FormationRow | null;
}

async function loadInputs(db: SupabaseClient, representationId: string) {
  const [evidenceResult, observationsResult] = await Promise.all([
    db.from('evidence')
      .select('id,statement_hash,raw_statement,source_formation_session_id')
      .eq('business_representation_id', representationId),
    db.from('observations')
      .select('id,interpreted_meaning')
      .eq('business_representation_id', representationId),
  ]);
  if (evidenceResult.error || observationsResult.error) {
    throw new Error('formation_inputs_failed');
  }
  return {
    evidence: (evidenceResult.data ?? []) as EvidenceRow[],
    observations: (observationsResult.data ?? []) as FormationObservationFingerprintRow[],
  };
}

async function loadDraft(db: SupabaseClient, sessionId: string) {
  const result = await db
    .from('representation_proposals')
    .select('id,formation_session_id,proposed_changes,status,created_at')
    .eq('formation_session_id', sessionId)
    .eq('status', 'draft')
    .maybeSingle();
  if (result.error) throw new Error('formation_summary_lookup_failed');
  return result.data as FormationSummaryProposalRow | null;
}

function sectionsFor(
  transcriptEntries: Array<{ role?: unknown; text?: unknown }>,
  evidence: EvidenceRow[],
  observations: FormationObservationFingerprintRow[],
  sessionId: string,
): FormationSummarySection[] {
  const ownerConversation = transcriptEntries
    .filter((entry) => entry.role === 'customer' && typeof entry.text === 'string')
    .map((entry) => entry.text as string)
    .join(' ')
    .slice(0, 500);
  const corrections = evidence
    .filter((item) => item.source_formation_session_id === sessionId)
    .map((item) => item.raw_statement)
    .join(' ')
    .slice(0, 500);

  return [
    {
      title: 'What Zeya Understands',
      content: corrections || ownerConversation || 'Zeya is still learning about your business.',
    },
    {
      title: 'Evidence Collected',
      content: evidence.length > 0
        ? `${evidence.length} governed evidence statement${evidence.length === 1 ? '' : 's'} support this review.`
        : 'No evidence has been collected yet.',
    },
    {
      title: 'Provisional Observations',
      content: observations.length > 0
        ? observations.map((item) => item.interpreted_meaning).join('; ')
        : 'No provisional observations are recorded yet.',
    },
    {
      title: "What's Missing",
      content: 'Questions and gaps remain provisional until you review and approve this understanding.',
    },
  ];
}

async function currentProjection(
  db: SupabaseClient,
  formation: FormationRow,
) {
  const proposal = await loadDraft(db, formation.id);
  if (!proposal) return null;
  const inputs = await loadInputs(db, formation.business_representation_id);
  return projectFormationSummary({
    formationSessionId: formation.id,
    proposal,
    evidence: inputs.evidence,
    observations: inputs.observations,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const sessionId = (await params).sessionId;
    const formation = await loadOwnedFormation(auth.supabase, sessionId, auth.user.id);
    if (!formation) return failure('Formation session not found', 404);
    const summary = await currentProjection(auth.supabase, formation);
    return NextResponse.json({ success: true, data: summary }, { status: 200 });
  } catch {
    return failure('Failed to retrieve formation summary', 500);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const sessionId = (await params).sessionId;
    const formation = await loadOwnedFormation(auth.supabase, sessionId, auth.user.id);
    if (!formation) return failure('Formation session not found', 404);
    if (formation.status !== 'working_conversation_linked'
      || !formation.first_working_conversation_id) {
      return failure('Formation is not linked to a governed conversation', 409);
    }

    const existing = await currentProjection(auth.supabase, formation);
    if (existing?.isCurrent) {
      return NextResponse.json({ success: true, data: existing }, { status: 200 });
    }

    const service = createExperienceServiceClient();
    if (existing) {
      const supersede = await service.from('representation_proposals')
        .update({ status: 'superseded', status_updated_at: new Date().toISOString() })
        .eq('id', existing.proposalId)
        .eq('formation_session_id', sessionId)
        .eq('status', 'draft');
      if (supersede.error) return failure('Failed to supersede stale formation summary', 500);
    }
    const inputs = await loadInputs(service, formation.business_representation_id);
    const conversationResult = await service
      .from('voice_conversation_outputs')
      .select('id,transcript,business_representation_id')
      .eq('id', formation.first_working_conversation_id)
      .eq('business_representation_id', formation.business_representation_id)
      .maybeSingle();
    if (conversationResult.error || !conversationResult.data) {
      return failure('Governed conversation output not found', 409);
    }

    const sections = sectionsFor(
      Array.isArray(conversationResult.data.transcript)
        ? conversationResult.data.transcript
        : [],
      inputs.evidence,
      inputs.observations,
      sessionId,
    );
    const placeholder: FormationSummaryMetadata = {
      formationSessionId: sessionId,
      reviewType: 'formation_initial_review',
      sourceFingerprint: '',
      generatorVersion: FORMATION_SUMMARY_GENERATOR_VERSION,
      reviewedAt: new Date().toISOString(),
      reviewedByOwnerId: auth.user.id,
    };
    const insertResult = await service.from('representation_proposals').insert({
      business_representation_id: formation.business_representation_id,
      formation_session_id: sessionId,
      affected_element_ids: [],
      proposed_changes: { _metadata: placeholder, _review: { sections }, elementUpdates: {} },
      supporting_observation_ids: inputs.observations.map((item) => item.id),
      supporting_evidence_ids: inputs.evidence.map((item) => item.id),
      status: 'draft',
      proposed_by_actor: `owner:${auth.user.id}`,
    }).select('id,formation_session_id,proposed_changes,status,created_at').single();

    if (insertResult.error || !insertResult.data) {
      if (insertResult.error?.code === '23505') {
        const replay = await currentProjection(service, formation);
        if (replay) return NextResponse.json({ success: true, data: replay }, { status: 200 });
      }
      return failure('Failed to persist formation summary', 500);
    }

    const proposal = insertResult.data as FormationSummaryProposalRow;
    const sourceFingerprint = computeFormationSummaryFingerprint({
      formationSessionId: sessionId,
      proposalId: proposal.id,
      generatorVersion: FORMATION_SUMMARY_GENERATOR_VERSION,
      evidence: inputs.evidence,
      observations: inputs.observations,
    });
    const metadata = { ...placeholder, sourceFingerprint };
    const proposedChanges = { _metadata: metadata, _review: { sections }, elementUpdates: {} };
    const updateResult = await service.from('representation_proposals')
      .update({ proposed_changes: proposedChanges })
      .eq('id', proposal.id)
      .eq('formation_session_id', sessionId)
      .eq('status', 'draft');
    if (updateResult.error) return failure('Failed to finalize formation summary', 500);

    const projected = projectFormationSummary({
      formationSessionId: sessionId,
      proposal: { ...proposal, proposed_changes: proposedChanges },
      evidence: inputs.evidence,
      observations: inputs.observations,
    });
    if (!projected) return failure('Failed to validate formation summary', 500);
    return NextResponse.json({ success: true, data: projected }, { status: 201 });
  } catch {
    return failure('Formation summary request failed', 500);
  }
}
