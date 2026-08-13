import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Direct Hire to Formation Handoff (Corrected)', () => {
  describe('Migration: 20260807000000 (Enum)', () => {
    it('has unique migration timestamp for enum', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807000000_direct_hire_formation_source.sql',
        'utf8',
      );
      expect(migration).toContain('Direct Hire Formation Initiation Source');
      expect(migration).toContain('formation_initiation_source');
    });

    it('adds direct_hire_onboarding to formation_initiation_source enum', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807000000_direct_hire_formation_source.sql',
        'utf8',
      );
      expect(migration).toContain("'direct_hire_onboarding'");
      expect(migration).toContain('formation_initiation_source');
    });

    it('enum migration contains only enum addition (no RPC or schema)', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807000000_direct_hire_formation_source.sql',
        'utf8',
      );
      expect(migration).not.toContain('CREATE OR REPLACE FUNCTION');
      expect(migration).not.toContain('ALTER TABLE');
    });
  });

  describe('Migration: 20260807010000 (Handoff)', () => {
    it('has later migration timestamp (after enum)', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('Direct Hire to Formation Handoff');
      // Verify it uses preparation_status, not preparation_state
      expect(migration).not.toContain("preparation_state TEXT CHECK");
      // Verify it adds correct fields
      expect(migration).toContain('formation_session_id UUID');
      expect(migration).toContain('formation_initiated_at TIMESTAMP WITH TIME ZONE');
    });

    it('uses existing preparation_status, not new preparation_state field', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).not.toContain("ADD COLUMN IF NOT EXISTS preparation_state");
      expect(migration).toContain("preparation_status NOT IN ('ready', 'partial')");
      expect(migration).toContain("preparation_status IN ('queued', 'running')");
    });

    it('verifies public_website Evidence (not direct_hire_website_research)', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain("source_type = 'public_website'");
      expect(migration).not.toContain('direct_hire_website_research');
    });
  });

  describe('RPC: zeya_initiate_direct_hire_formation', () => {
    it('validates using preparation_status (not preparation_state)', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('v_onboarding_session.preparation_status');
      expect(migration).not.toContain('v_onboarding_session.preparation_state');
    });

    it('validates public_website Evidence link', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      const websiteCheck = migration.includes("source_type = 'public_website'");
      const directHireCheck = migration.includes('direct_hire_onboarding_session_id');
      expect(websiteCheck && directHireCheck).toBe(true);
    });

    it('accepts partial_acknowledged parameter for partial states', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('p_partial_acknowledged BOOLEAN');
      expect(migration).toContain('partial_not_acknowledged');
    });

    it('is idempotent on duplicate calls', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('formation_session_id IS NOT NULL');
      expect(migration).toContain(', FALSE');
    });

    it('has explicit ACL: REVOKE from PUBLIC', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(UUID, BOOLEAN) FROM PUBLIC;');
    });

    it('has explicit ACL: REVOKE from anon', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(UUID, BOOLEAN) FROM anon;');
    });

    it('has explicit ACL: REVOKE from authenticated', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(UUID, BOOLEAN) FROM authenticated;');
    });

    it('has explicit ACL: REVOKE from service_role initially', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(UUID, BOOLEAN) FROM service_role;');
    });

    it('has explicit ACL: GRANT to service_role only', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.zeya_initiate_direct_hire_formation(UUID, BOOLEAN) TO service_role;');
    });

    it('uses empty search_path (SECURITY DEFINER requirement)', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('SECURITY DEFINER');
      expect(migration).toContain("SET search_path = ''");
    });

    it('schema-qualifies all %ROWTYPE declarations in RPC', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('public.direct_hire_onboarding_sessions%ROWTYPE');
      expect(migration).toContain('public.business_representations%ROWTYPE');
      expect(migration).toContain('public.evidence%ROWTYPE');
      expect(migration).not.toMatch(/v_\w+\s+\w+%ROWTYPE/);
    });

    it('schema-qualifies enum casts in RPC', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain("'direct_hire_onboarding'::public.formation_initiation_source");
      expect(migration).toContain("'initiated'::public.formation_session_status");
    });

    it('schema-qualifies all table references in RPC', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('FROM public.direct_hire_onboarding_sessions');
      expect(migration).toContain('FROM public.business_representations');
      expect(migration).toContain('FROM public.representation_formation_sessions');
      expect(migration).toContain('FROM public.evidence');
      expect(migration).toContain('INSERT INTO public.representation_formation_sessions');
      expect(migration).toContain('UPDATE public.direct_hire_onboarding_sessions');
    });
  });

  describe('API: POST /api/onboarding/direct-hire/formation', () => {
    it('exists at correct path (not formation-initiate)', async () => {
      const route = await readFile(
        'app/api/onboarding/direct-hire/formation/route.ts',
        'utf8',
      );
      expect(route).toContain('export async function POST');
    });

    it('authenticates user from request', async () => {
      const route = await readFile(
        'app/api/onboarding/direct-hire/formation/route.ts',
        'utf8',
      );
      expect(route).toContain('createAuthenticatedRepresentationContext');
    });

    it('does not accept owner_id, business, or representation from body', async () => {
      const route = await readFile(
        'app/api/onboarding/direct-hire/formation/route.ts',
        'utf8',
      );
      // Should only accept partialAcknowledged
      expect(route).toContain('partialAcknowledged');
      expect(route).not.toContain('(body as any)?.owner');
      expect(route).not.toContain('(body as any)?.business');
      expect(route).not.toContain('(body as any)?.representation');
      expect(route).toContain('auth.user.id');
    });

    it('calls RPC with correct parameters', async () => {
      const route = await readFile(
        'app/api/onboarding/direct-hire/formation/route.ts',
        'utf8',
      );
      expect(route).toContain('zeya_initiate_direct_hire_formation');
      expect(route).toContain('p_authenticated_user_id');
      expect(route).toContain('p_partial_acknowledged');
    });

    it('returns formationSessionId and isNew on success', async () => {
      const route = await readFile(
        'app/api/onboarding/direct-hire/formation/route.ts',
        'utf8',
      );
      expect(route).toContain('formationSessionId');
      expect(route).toContain('isNew');
    });
  });

  describe('Preparation Summary API: GET /api/onboarding/direct-hire/preparation/summary', () => {
    it('exists and authenticates', async () => {
      const route = await readFile(
        'app/api/onboarding/direct-hire/preparation/summary/route.ts',
        'utf8',
      );
      expect(route).toContain('export async function GET');
      expect(route).toContain('createAuthenticatedRepresentationContext');
    });

    it('loads Direct Hire session with correct fields', async () => {
      const route = await readFile(
        'app/api/onboarding/direct-hire/preparation/summary/route.ts',
        'utf8',
      );
      expect(route).toContain('preparation_status');
      expect(route).toContain('onboarding_state');
    });

    it('uses only exact-session scoped Evidence through the shared projection', async () => {
      const projection = await readFile(
        'lib/onboarding/preparation-intelligence.ts',
        'utf8',
      );
      expect(projection).toContain(".from('evidence')");
      expect(projection).toContain(".eq('direct_hire_onboarding_session_id', scope.onboardingSessionId)");
      expect(projection).toContain(".eq('business_representation_id', scope.businessRepresentationId)");
    });

    it('delegates interpretation to the shared seven-domain projection', async () => {
      const route = await readFile('app/api/onboarding/direct-hire/preparation/summary/route.ts', 'utf8');
      const component = await readFile(
        'components/onboarding/DirectHirePreparationSummary.tsx',
        'utf8',
      );
      expect(route).toContain('buildPrivatePreparationProjection');
      expect(component).toContain('whatYouSell');
      expect(component).toContain('whoItIsFor');
      expect(component).toContain('problemOrAspiration');
      expect(component).toContain('whyCustomersShouldCare');
      expect(component).toContain('proposedDescription');
      expect(component).toContain('authorityBoundaries');
      expect(component).toContain('clarificationsNeeded');
    });

    it('includes unknowns and genuine contradictions explicitly', async () => {
      const projection = await readFile(
        'lib/onboarding/preparation-intelligence.ts',
        'utf8',
      );
      expect(projection).toContain('majorUnknowns');
      expect(projection).toContain("hypothesis.epistemicState === 'contradicted'");
    });

    it('does NOT include phone number', async () => {
      const route = await readFile(
        'app/api/onboarding/direct-hire/preparation/summary/route.ts',
        'utf8',
      );
      expect(route).not.toContain('phone_e164');
    });
  });

  describe('Preparation Summary Component: Always Shows Seven Sections', () => {
    it('has all seven sections always rendered (not conditional)', async () => {
      const component = await readFile(
        'components/onboarding/DirectHirePreparationSummary.tsx',
        'utf8',
      );
      // Each section should be rendered even if empty
      expect(component).toContain('What I understand you sell');
      expect(component).toContain('Who I understand it is for');
      expect(component).toContain('The problem or aspiration');
      expect(component).toContain('Why I believe customers');
      expect(component).toContain('How I propose to describe');
      expect(component).toContain('What I must never claim');
      expect(component).toContain('What I still need you to clarify');
    });

    it('shows explicit unknowns when data missing (not omit section)', async () => {
      const component = await readFile(
        'components/onboarding/DirectHirePreparationSummary.tsx',
        'utf8',
      );
      expect(component).toContain('Still learning');
      expect(component).toContain('italic');
      expect(component).toContain('Unknown');
      expect(component).toContain('clarification');
    });

    it('calls correct endpoint (formation not formation-initiate)', async () => {
      const component = await readFile(
        'components/onboarding/DirectHirePreparationSummary.tsx',
        'utf8',
      );
      expect(component).toContain('/api/onboarding/direct-hire/formation');
      expect(component).not.toContain('formation-initiate');
    });

    it('accepts partialAcknowledged in request body', async () => {
      const component = await readFile(
        'components/onboarding/DirectHirePreparationSummary.tsx',
        'utf8',
      );
      expect(component).toContain('partialAcknowledged');
    });
  });

  describe('Preparation Page Integration', () => {
    it('does not expose the internal Preparation Summary in the P2.1 owner journey', async () => {
      const page = await readFile(
        'app/onboarding/preparation/page.tsx',
        'utf8',
      );
      expect(page).not.toContain('/api/onboarding/direct-hire/preparation/summary');
      expect(page).toContain('DirectHireWorkingSessionScheduler');
    });

    it('keeps the summary component out of the normal owner-facing page', async () => {
      const page = await readFile(
        'app/onboarding/preparation/page.tsx',
        'utf8',
      );
      expect(page).not.toContain('DirectHirePreparationSummary');
    });
  });

  describe('Formation Session Response', () => {
    it('recognizes direct_hire_onboarding in linkedContextSummary', async () => {
      const route = await readFile(
        'app/api/formation/sessions/[sessionId]/route.ts',
        'utf8',
      );
      expect(route).toContain("session.initiated_from === 'direct_hire_onboarding'");
    });
  });

  describe('Types Update', () => {
    it('adds fromDirectHireOnboarding to linkedContextSummary', async () => {
      const types = await readFile(
        'types/formation.ts',
        'utf8',
      );
      expect(types).toContain('fromDirectHireOnboarding');
    });
  });

  describe('Durable Lineage (No Audit Trigger)', () => {
    it('adds formation_session_id column to direct_hire_onboarding_sessions', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('formation_session_id UUID REFERENCES public.representation_formation_sessions(id)');
    });

    it('adds formation_initiated_at column to direct_hire_onboarding_sessions', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('formation_initiated_at TIMESTAMP WITH TIME ZONE');
    });

    it('sets formation_session_id when RPC creates Formation', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('formation_session_id = v_formation_id');
    });

    it('sets formation_initiated_at to NOW() when RPC creates Formation', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('formation_initiated_at = NOW()');
    });

    it('sets initiated_from to direct_hire_onboarding in Formation creation', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain("'direct_hire_onboarding'::public.formation_initiation_source");
    });

    it('sets initiated_from_id to onboarding session ID in Formation creation', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('initiated_from_id,');
      expect(migration).toContain('v_onboarding_session.id,');
    });

    it('does not create audit function or trigger', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).not.toContain('zeya_audit_direct_hire_formation_initiation');
      expect(migration).not.toContain('trigger_audit_direct_hire_formation_initiation');
      expect(migration).not.toContain('public.audit_log');
    });

    it('does not depend on audit_events table for handoff', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).not.toContain('audit_events');
      expect(migration).not.toContain('INSERT INTO public.audit_log');
      expect(migration).not.toContain('INSERT INTO public.audit_events');
    });
  });

  describe('No Leakage', () => {
    it('does not create Proposal, Version, Approval, or pointer at handoff', async () => {
      const route = await readFile(
        'app/api/onboarding/direct-hire/formation/route.ts',
        'utf8',
      );
      expect(route).not.toContain('representation_proposals');
      expect(route).not.toContain('representation_versions');
      expect(route).not.toContain('current_version_id');
    });

    it('does not create Public Experience artifacts', async () => {
      const route = await readFile(
        'app/api/onboarding/direct-hire/formation/route.ts',
        'utf8',
      );
      expect(route).not.toContain('public_experience');
    });

    it('uses direct_hire_onboarding lineage source', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain("'direct_hire_onboarding'::public.formation_initiation_source");
    });
  });

  describe('Validation', () => {
    it('blocks if no public_website Evidence', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('no_website_evidence');
    });

    it('blocks if preparation not ready/partial', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('preparation_not_ready');
    });

    it('blocks if preparation queued/running', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('preparation_in_progress');
    });

    it('blocks if partial not acknowledged', async () => {
      const migration = await readFile(
        'supabase/migrations/20260807010000_direct_hire_formation_handoff.sql',
        'utf8',
      );
      expect(migration).toContain('partial_not_acknowledged');
    });
  });
});
