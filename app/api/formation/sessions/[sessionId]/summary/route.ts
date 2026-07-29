// POST /api/formation/sessions/[sessionId]/summary
// Create or resume Formation Summary (write operation)
// Generates summary, creates Proposal with _metadata and _review
// Returns existing current Proposal idempotently
//
// GET /api/formation/sessions/[sessionId]/summary
// Retrieve currently persisted Formation Summary (read-only, no side effects)
// Returns pending/not-found state if no current review exists

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { computeSourceFingerprint } from '@/lib/formation/fingerprint';
import type { FormationSummary, FormationSummaryMetadata } from '@/types/formation';

interface Evidence {
  id: string;
  statement_hash: string;
}

interface Observation {
  id: string;
  relevant_content: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse<any>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const sessionId = (await params).sessionId;
    const ownerId = auth.user.id;

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 1: VERIFY FORMATION SESSION EXISTS AND OWNER OWNS IT
    // ─────────────────────────────────────────────────────────────────────────────
    const { data: formationSession, error: sessError } = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, business_representation_id, status, first_working_conversation_id')
      .eq('id', sessionId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (sessError || !formationSession) {
      return NextResponse.json(
        { success: false, error: 'Formation session not found' },
        { status: 404 }
      );
    }

    if (formationSession.status !== 'working_conversation_linked') {
      return NextResponse.json(
        {
          success: false,
          error: `Formation not ready for summary. Current status: ${formationSession.status}`,
        },
        { status: 409 }
      );
    }

    const repId = formationSession.business_representation_id;

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 2: CHECK IF SUMMARY PROPOSAL ALREADY EXISTS
    // ─────────────────────────────────────────────────────────────────────────────
    // CONCURRENCY BOUNDARY:
    // This endpoint uses application-level read-before-insert (non-atomic).
    // Two concurrent requests could both find no Proposal and both insert,
    // creating duplicate Formation Summaries.
    // MITIGATION: Approval validation ensures only one Proposal is used
    // (queries maybeSingle on Formation + draft status).
    // TODO: Add unique constraint on (business_representation_id, formation_session_id, status='draft')
    // to enforce atomically at database level (future database enhancement).
    const { data: existingProposal, error: propError } = await auth.supabase
      .from('representation_proposals')
      .select('id, proposed_changes, status')
      .eq('business_representation_id', repId)
      .filter('proposed_changes->_metadata->>formationSessionId', 'eq', sessionId)
      .eq('status', 'draft')
      .maybeSingle();

    if (propError && propError.code !== 'PGRST116') {
      return NextResponse.json(
        { success: false, error: 'Failed to check existing proposal' },
        { status: 500 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 3: IF EXISTS, VERIFY FINGERPRINT AND RETURN
    // ─────────────────────────────────────────────────────────────────────────────
    if (existingProposal && existingProposal.proposed_changes._metadata) {
      const metadata = existingProposal.proposed_changes._metadata as FormationSummaryMetadata;
      const review = existingProposal.proposed_changes._review;

      // Verify fingerprint still matches (inputs unchanged)
      const currentFingerprint = await computeCurrentFingerprint(repId, auth.supabase as any);
      const isCurrent = currentFingerprint === metadata.sourceFingerprint;

      return NextResponse.json(
        {
          success: true,
          data: {
            proposalId: existingProposal.id,
            sourceFingerprint: metadata.sourceFingerprint,
            generatorVersion: metadata.generatorVersion,
            isCurrent,
            sections: review?.sections || [],
            message: isCurrent
              ? 'Summary ready for review'
              : 'Summary is stale (inputs changed); generating updated summary',
          } as FormationSummary,
        },
        { status: 200 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 4: GENERATE NEW SUMMARY (FIRST TIME)
    // ─────────────────────────────────────────────────────────────────────────────
    // Load Evidence, Observations, Voice Conversation
    const [evidenceResult, observationsResult, conversationResult] = await Promise.all([
      auth.supabase
        .from('evidence')
        .select('id, statement_hash')
        .eq('business_representation_id', repId),
      auth.supabase
        .from('observations')
        .select('id, relevant_content')
        .eq('business_representation_id', repId),
      auth.supabase
        .from('voice_conversation_outputs')
        .select('id, transcript_entries')
        .eq('id', formationSession.first_working_conversation_id)
        .maybeSingle(),
    ]);

    if (evidenceResult.error || observationsResult.error || conversationResult.error) {
      return NextResponse.json(
        { success: false, error: 'Failed to load formation data' },
        { status: 500 }
      );
    }

    const evidence: Evidence[] = evidenceResult.data || [];
    const observations: Observation[] = observationsResult.data || [];
    const conversation = conversationResult.data;

    // Generate review sections (from conversation + evidence + observations)
    const sections = generateReviewSections(
      conversation?.transcript_entries || [],
      evidence,
      observations
    );

    // Create Proposal FIRST (without final fingerprint)
    const supabaseServiceRole = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    // Create with placeholder metadata (fingerprint will be recomputed after ID is known)
    const tempMetadata: FormationSummaryMetadata = {
      formationSessionId: sessionId,
      reviewType: 'formation_initial_review',
      sourceFingerprint: '', // Will be computed with actual Proposal ID
      generatorVersion: 'rf-b-v1',
      reviewedAt: new Date().toISOString(),
      reviewedByOwnerId: ownerId,
    };

    const tempProposedChangesPayload = {
      _metadata: tempMetadata,
      _review: { sections },
      elementUpdates: {},
    };

    const { data: newProposal, error: createPropError } = await supabaseServiceRole
      .from('representation_proposals')
      .insert({
        business_representation_id: repId,
        affected_element_ids: [],
        proposed_changes: tempProposedChangesPayload,
        supporting_observation_ids: observations.map((o) => o.id),
        supporting_evidence_ids: evidence.map((e) => e.id),
        status: 'draft',
        proposed_by_actor: `owner:${ownerId}`,
      })
      .select('id')
      .single();

    if (createPropError || !newProposal) {
      console.error('[formation] failed to create summary proposal:', createPropError);
      return NextResponse.json(
        { success: false, error: 'Failed to create summary proposal' },
        { status: 500 }
      );
    }

    // NOW compute fingerprint with actual Proposal ID
    const sourceFingerprint = computeSourceFingerprint({
      generatorVersion: 'rf-b-v1',
      formationSessionId: sessionId,
      proposalId: newProposal.id,
      evidence: evidence.map((e) => ({ id: e.id, statement_hash: e.statement_hash })),
      observations: observations.map((o) => ({ id: o.id, content: o.relevant_content })),
      proposedChanges: { elementUpdates: {} },
      reflectionIdentity: null,
    });

    // Update Proposal with computed fingerprint
    const finalMetadata: FormationSummaryMetadata = {
      formationSessionId: sessionId,
      reviewType: 'formation_initial_review',
      sourceFingerprint,
      generatorVersion: 'rf-b-v1',
      reviewedAt: new Date().toISOString(),
      reviewedByOwnerId: ownerId,
    };

    const finalProposedChangesPayload = {
      _metadata: finalMetadata,
      _review: { sections },
      elementUpdates: {},
    };

    const { error: updatePropError } = await supabaseServiceRole
      .from('representation_proposals')
      .update({ proposed_changes: finalProposedChangesPayload })
      .eq('id', newProposal.id);

    if (updatePropError) {
      console.error('[formation] failed to update summary proposal with fingerprint:', updatePropError);
      return NextResponse.json(
        { success: false, error: 'Failed to finalize summary proposal' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          proposalId: newProposal.id,
          sourceFingerprint,
          generatorVersion: 'rf-b-v1',
          isCurrent: true,
          sections,
          message: 'Formation Summary generated. Review and approve to create Version 0.1.',
        } as FormationSummary,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[formation] GET /api/formation/sessions/[sessionId]/summary failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}

/**
 * Generate review sections from conversation, evidence, and observations
 * Returns deterministic sections based on owned data
 */
function generateReviewSections(
  transcriptEntries: any[],
  evidence: Evidence[],
  observations: Observation[]
): Array<{ title: string; content: string }> {
  // Extract insights from conversation
  const conversationSummary = transcriptEntries
    .filter((e) => e.role === 'user')
    .map((e) => e.text)
    .join(' ')
    .substring(0, 500);

  // Build evidence summary
  const evidenceSummary =
    evidence.length > 0
      ? `Based on ${evidence.length} evidence statements from your conversation.`
      : 'No evidence collected yet.';

  // Build observations summary
  const observationsSummary =
    observations.length > 0
      ? `Key observations: ${observations.map((o) => o.relevant_content).join('; ')}`
      : 'No observations recorded yet.';

  return [
    {
      title: 'What Zeya Understands',
      content: conversationSummary || 'Zeya is still learning about your business.',
    },
    {
      title: 'Evidence Collected',
      content: evidenceSummary,
    },
    {
      title: 'Key Observations',
      content: observationsSummary,
    },
    {
      title: "What's Missing",
      content:
        'More detail about your target customer, unique value proposition, and how you measure success.',
    },
  ];
}

/**
 * Recompute source fingerprint from current Evidence, Observations, Proposal state
 * Used to detect if summary is stale (inputs changed)
 */
/**
 * GET /api/formation/sessions/[sessionId]/summary
 * Retrieve currently persisted Formation Summary (read-only, no side effects)
 * Returns pending/not-found state if no current review exists
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse<any>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const sessionId = (await params).sessionId;
    const ownerId = auth.user.id;

    // Verify Formation Session ownership
    const { data: formationSession, error: sessError } = await auth.supabase
      .from('representation_formation_sessions')
      .select('id, business_representation_id, status')
      .eq('id', sessionId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (sessError || !formationSession) {
      return NextResponse.json(
        { success: false, error: 'Formation session not found' },
        { status: 404 }
      );
    }

    // GET should not create; check if summary exists
    const { data: existingProposal, error: propError } = await auth.supabase
      .from('representation_proposals')
      .select('id, proposed_changes, status')
      .eq('business_representation_id', formationSession.business_representation_id)
      .filter('proposed_changes->_metadata->>formationSessionId', 'eq', sessionId)
      .eq('status', 'draft')
      .maybeSingle();

    if (propError && propError.code !== 'PGRST116') {
      return NextResponse.json(
        { success: false, error: 'Failed to check proposal' },
        { status: 500 }
      );
    }

    if (!existingProposal || !existingProposal.proposed_changes._metadata) {
      // No summary exists - return pending state, do NOT create
      return NextResponse.json(
        {
          success: true,
          data: {
            proposalId: null,
            sourceFingerprint: null,
            generatorVersion: 'rf-b-v1',
            isCurrent: false,
            sections: [],
            status: 'pending',
            message: 'Summary not yet generated. Use POST to create.',
          },
        },
        { status: 200 }
      );
    }

    // Summary exists - return it
    const metadata = existingProposal.proposed_changes._metadata as FormationSummaryMetadata;
    const review = existingProposal.proposed_changes._review;

    // Verify fingerprint still matches (inputs unchanged)
    const currentFingerprint = await computeCurrentFingerprint(
      formationSession.business_representation_id,
      auth.supabase as any
    );
    const isCurrent = currentFingerprint === metadata.sourceFingerprint;

    return NextResponse.json(
      {
        success: true,
        data: {
          proposalId: existingProposal.id,
          sourceFingerprint: metadata.sourceFingerprint,
          generatorVersion: metadata.generatorVersion,
          isCurrent,
          sections: review?.sections || [],
          status: isCurrent ? 'current' : 'stale',
          message: isCurrent
            ? 'Summary ready for review'
            : 'Summary is stale (inputs changed); regenerate with POST',
        } as FormationSummary,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[formation] GET /api/formation/sessions/[sessionId]/summary failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}

async function computeCurrentFingerprint(
  repId: string,
  supabase: any
): Promise<string> {
  const [evidenceResult, observationsResult] = await Promise.all([
    supabase.from('evidence').select('id, statement_hash').eq('business_representation_id', repId),
    supabase
      .from('observations')
      .select('id, relevant_content')
      .eq('business_representation_id', repId),
  ]);

  const evidence: Evidence[] = evidenceResult.data || [];
  const observations: Observation[] = observationsResult.data || [];

  return computeSourceFingerprint({
    generatorVersion: 'rf-b-v1',
    formationSessionId: '', // Will be matched in caller
    proposalId: '', // Will be matched in caller
    evidence: evidence.map((e) => ({ id: e.id, statement_hash: e.statement_hash })),
    observations: observations.map((o) => ({ id: o.id, content: o.relevant_content })),
    proposedChanges: { elementUpdates: {} },
    reflectionIdentity: null,
  });
}
