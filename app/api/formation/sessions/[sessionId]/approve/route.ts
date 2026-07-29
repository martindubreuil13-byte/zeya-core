// POST /api/formation/sessions/[sessionId]/approve
// Owner approval of Formation Summary → creates Canonical Version 0.1
// Verifies: ownership, formation lineage, fingerprint, no version exists, recomputes to match

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { computeSourceFingerprint, verifySourceFingerprint } from '@/lib/formation/fingerprint';
import type { FormationApprovalRequest, FormationApprovalResponse } from '@/types/formation';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse<any>> {
  try {
    const auth = await createAuthenticatedRepresentationContext(request);
    if (auth instanceof NextResponse) return auth;

    const sessionId = (await params).sessionId;
    const ownerId = auth.user.id;
    const body: FormationApprovalRequest = await request.json();

    if (!body.proposalId || !body.sourceFingerprint) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: proposalId, sourceFingerprint' },
        { status: 400 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // VALIDATION 1: VERIFY AUTHENTICATED OWNER
    // ─────────────────────────────────────────────────────────────────────────────
    if (!ownerId) {
      return NextResponse.json(
        { success: false, error: 'Owner not authenticated' },
        { status: 401 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // VALIDATION 2: FORMATION SESSION EXISTS AND OWNER OWNS IT
    // ─────────────────────────────────────────────────────────────────────────────
    const { data: formationSession, error: sessError } = await auth.supabase
      .from('representation_formation_sessions')
      .select(
        'id, business_id, business_representation_id, owner_id, status, public_experience_session_id'
      )
      .eq('id', sessionId)
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (sessError || !formationSession) {
      return NextResponse.json(
        { success: false, error: 'Formation session not found' },
        { status: 404 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // VALIDATION 3: VERIFY PUBLIC EXPERIENCE LINEAGE (if from public experience)
    // ─────────────────────────────────────────────────────────────────────────────
    if (formationSession.public_experience_session_id) {
      const { data: pubExpSession, error: pubExpError } = await auth.supabase
        .from('public_experience_sessions')
        .select('id, state, expires_at, business_id, business_representation_id')
        .eq('id', formationSession.public_experience_session_id)
        .maybeSingle();

      if (pubExpError || !pubExpSession) {
        return NextResponse.json(
          { success: false, error: 'Public experience session not found' },
          { status: 404 }
        );
      }

      if (pubExpSession.state !== 'reflection_ready') {
        return NextResponse.json(
          { success: false, error: 'Public experience session in invalid state for approval' },
          { status: 409 }
        );
      }

      if (new Date(pubExpSession.expires_at) <= new Date()) {
        return NextResponse.json(
          { success: false, error: 'Public experience session expired' },
          { status: 410 }
        );
      }

      if (
        pubExpSession.business_id !== formationSession.business_id ||
        pubExpSession.business_representation_id !== formationSession.business_representation_id
      ) {
        return NextResponse.json(
          { success: false, error: 'Public experience lineage mismatch' },
          { status: 409 }
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // VALIDATION 4: PROPOSAL EXISTS AND BELONGS TO SAME REPRESENTATION
    // ─────────────────────────────────────────────────────────────────────────────
    const { data: proposal, error: propError } = await auth.supabase
      .from('representation_proposals')
      .select(
        'id, business_representation_id, proposed_changes, status, supporting_evidence_ids, supporting_observation_ids, created_at'
      )
      .eq('id', body.proposalId)
      .eq('business_representation_id', formationSession.business_representation_id)
      .maybeSingle();

    if (propError || !proposal) {
      return NextResponse.json(
        { success: false, error: 'Proposal not found or does not belong to this representation' },
        { status: 404 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // VALIDATION 5: PROPOSAL CONTAINS FORMATION REVIEW METADATA
    // ─────────────────────────────────────────────────────────────────────────────
    if (!proposal.proposed_changes._metadata || !proposal.proposed_changes._review) {
      return NextResponse.json(
        { success: false, error: 'Proposal does not contain Formation review payload' },
        { status: 409 }
      );
    }

    const metadata = proposal.proposed_changes._metadata;
    if (metadata.formationSessionId !== sessionId) {
      return NextResponse.json(
        { success: false, error: 'Proposal belongs to different Formation session' },
        { status: 409 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // IDEMPOTENCY: IF PROPOSAL ALREADY APPROVED, RETURN EXISTING CANONICAL VERSION
    // ─────────────────────────────────────────────────────────────────────────────
    if (proposal.status === 'approved') {
      // Proposal was already approved; retrieve and return the canonical Version
      const { data: canonicalVersion, error: versionError } = await auth.supabase
        .from('representation_versions')
        .select('id, version_number')
        .eq('business_representation_id', formationSession.business_representation_id)
        .eq('is_canonical', true)
        .maybeSingle();

      if (!versionError && canonicalVersion) {
        return NextResponse.json(
          {
            success: true,
            data: {
              versionId: canonicalVersion.id,
              versionNumber: canonicalVersion.version_number,
              message: 'Canonical Version 0.1 already created (idempotent retry).',
            },
          },
          { status: 200 }
        );
      }
      // If we can't find the canonical Version despite approved status, fail safely
      return NextResponse.json(
        { success: false, error: 'Proposal already approved but canonical Version not found' },
        { status: 500 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // VALIDATION 6: PROPOSAL IS CURRENT AND REVIEWABLE
    // ─────────────────────────────────────────────────────────────────────────────
    if (proposal.status !== 'draft') {
      return NextResponse.json(
        { success: false, error: `Proposal status is ${proposal.status}, not draft` },
        { status: 409 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // VALIDATION 7: PROPOSAL NOT SUPERSEDED
    // ─────────────────────────────────────────────────────────────────────────────
    const { data: newerProposal, error: newerError } = await auth.supabase
      .from('representation_proposals')
      .select('id, status')
      .eq('business_representation_id', formationSession.business_representation_id)
      .filter('proposed_changes->_metadata->>formationSessionId', 'eq', sessionId)
      .gt('created_at', proposal.created_at)
      .maybeSingle();

    if (newerError && newerError.code !== 'PGRST116') {
      return NextResponse.json(
        { success: false, error: 'Failed to check for newer proposals' },
        { status: 500 }
      );
    }

    if (newerProposal) {
      return NextResponse.json(
        { success: false, error: 'A newer Formation review exists; use that instead' },
        { status: 409 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // VALIDATION 8: FINGERPRINT MATCH - SUBMITTED == PERSISTED
    // ─────────────────────────────────────────────────────────────────────────────
    if (body.sourceFingerprint !== metadata.sourceFingerprint) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Source fingerprint does not match. Review may be stale; fetch fresh summary.',
        },
        { status: 409 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // VALIDATION 9: FINGERPRINT MATCH - PERSISTED == RECOMPUTED
    // Verify that evidence/observations/proposal unchanged since review generation
    // ─────────────────────────────────────────────────────────────────────────────
    const [evidenceResult, observationsResult] = await Promise.all([
      auth.supabase
        .from('evidence')
        .select('id, statement_hash')
        .in('id', proposal.supporting_evidence_ids || []),
      auth.supabase
        .from('observations')
        .select('id, relevant_content')
        .in('id', proposal.supporting_observation_ids || []),
    ]);

    if (evidenceResult.error || observationsResult.error) {
      return NextResponse.json(
        { success: false, error: 'Failed to load evidence/observations for fingerprint verification' },
        { status: 500 }
      );
    }

    const recomputedFingerprint = computeSourceFingerprint({
      generatorVersion: metadata.generatorVersion,
      formationSessionId: sessionId,
      proposalId: body.proposalId,
      evidence: (evidenceResult.data || []).map((e) => ({ id: e.id, statement_hash: e.statement_hash })),
      observations: (observationsResult.data || []).map((o) => ({
        id: o.id,
        content: o.relevant_content,
      })),
      proposedChanges: proposal.proposed_changes.elementUpdates || { elementUpdates: {} },
      reflectionIdentity: null,
    });

    if (recomputedFingerprint !== metadata.sourceFingerprint) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Evidence or observations changed since review was generated. Please refresh and review again.',
        },
        { status: 409 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // VALIDATION 10: NO CANONICAL VERSION EXISTS FOR INITIAL VERSION 0.1
    // ─────────────────────────────────────────────────────────────────────────────
    const { data: existingVersion, error: versionError } = await auth.supabase
      .from('representation_versions')
      .select('id, version_number')
      .eq('business_representation_id', formationSession.business_representation_id)
      .eq('is_canonical', true)
      .maybeSingle();

    if (versionError && versionError.code !== 'PGRST116') {
      return NextResponse.json(
        { success: false, error: 'Failed to check existing canonical version' },
        { status: 500 }
      );
    }

    if (existingVersion) {
      return NextResponse.json(
        {
          success: false,
          error: `Representation already has canonical Version ${existingVersion.version_number}. Use normal governance for future versions.`,
        },
        { status: 409 }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 11: CREATE CANONICAL VERSION 0.1 VIA GOVERNANCE SERVICE
    // Use existing approveAndCreateCanonicalVersion() from representation service
    // This centralizes: Proposal validation, Approval Decision creation, audit,
    // confidence calculation, and atomic Version creation
    // ─────────────────────────────────────────────────────────────────────────────
    try {
      const { RepresentationStateService } = await import('@/lib/representation/representation-service');

      // Create service role client for atomic operations
      const supabaseServiceRole = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || ''
      );

      // Instantiate service with service role (required for atomic Version creation)
      const representationService = new RepresentationStateService(supabaseServiceRole);

      // GOVERNANCE CALL CHAIN:
      // 1. RepresentationService.approveAndCreateCanonicalVersion()
      //    → adapter.getProposal() - validates Proposal exists and belongs to Representation
      //    → adapter.getApprovalForProposal() - gets Approval Decision
      //    → adapter.updateProposalStatus() - marks Proposal as approved
      //    → adapter.getRepresentation() - validates Representation
      //    → adapter.createCanonicalVersion() - calls zeya_create_canonical_version_atomic RPC (ATOMIC)
      //    → calculateConfidence() - stores confidence assessment
      // 2. RPC returns created Version with version_number assigned by database
      // 3. No version_number calculation in application code

      const governanceResult = await representationService.approveAndCreateCanonicalVersion(
        formationSession.business_representation_id,
        body.proposalId,
        proposal.proposed_changes.elementUpdates || {},
        75 // Initial confidence for Version 0.1
      );

      return NextResponse.json(
        {
          success: true,
          data: {
            versionId: governanceResult.version.id,
            versionNumber: governanceResult.version.versionNumber,
            message: 'Canonical Version 0.1 created. Representation formation complete.',
          },
        },
        { status: 201 }
      );
    } catch (govError) {
      const errorMsg = govError instanceof Error ? govError.message : 'Governance approval failed';
      console.error('[formation] governance approval failed:', errorMsg);
      return NextResponse.json(
        { success: false, error: errorMsg },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[formation] POST /api/formation/sessions/[sessionId]/approve failed:', error);
    return NextResponse.json({ success: false, error: 'Request failed' }, { status: 500 });
  }
}
