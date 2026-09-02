import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(
  `${root}/supabase/migrations/20260901000000_p2_12d_1m_formation_aware_persistence.sql`,
  'utf8',
);
const component = readFileSync(
  `${root}/components/onboarding/DirectHireWorkingSession.tsx`,
  'utf8',
);

describe('P2.12D.1m formation-aware website persistence', () => {
  it('replaces only the current first-working-session persistence RPC', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.zeya_persist_first_working_session_website_research(',
    );
    expect(migration).not.toContain('zeya_finalize_direct_hire_preparation');
    expect(migration).not.toContain('representation_formation_sessions');
  });

  it('preserves worker authorization, lease, schedule, and lifecycle governance', () => {
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain("v_session.status <> 'scheduled'");
    expect(migration).toContain("v_session.preparation_status <> 'running'");
    expect(migration).toContain('v_session.preparation_lease_id <> p_lease_id');
    expect(migration).toContain('v_session.preparation_lease_expires_at <= now()');
    expect(migration).toContain("onboarding.onboarding_state='employment_accepted'");
    expect(migration).toContain("onboarding.induction_state='preparation_pending'");
  });

  it('preserves tenant lineage and the canonical Representation boundary', () => {
    expect(migration).toContain('onboarding.owner_id=v_session.owner_id');
    expect(migration).toContain('onboarding.business_id=v_session.business_id');
    expect(migration).toContain(
      'onboarding.business_representation_id=v_session.business_representation_id',
    );
    expect(migration).toContain('business.user_id=v_session.owner_id');
    expect(migration).toContain('representation.business_id=v_session.business_id');
    expect(migration).toContain('representation.user_id=v_session.owner_id');
    expect(migration).toContain('representation.current_version_id IS NULL');
  });

  it('keeps payload and evidence/observation lineage validation', () => {
    expect(migration).toContain("MESSAGE='invalid preparation result'");
    expect(migration).toContain("MESSAGE='invalid website evidence'");
    expect(migration).toContain("MESSAGE='invalid website observation'");
    expect(migration).toContain("MESSAGE='observation evidence missing'");
    expect(migration).toContain(
      'evidence.business_representation_id=v_session.business_representation_id',
    );
  });

  it('does not mutate Formation, handoff, or canonical artifacts', () => {
    expect(migration).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.representation_formation_sessions\b/i);
    expect(migration).not.toMatch(/formation_handoff|prepared_opening|current_version_id\s*=/i);
  });

  it('retains security-definer ownership and service-only grants', () => {
    expect(migration).toContain("SECURITY DEFINER SET search_path = ''");
    expect(migration).toContain('OWNER TO postgres');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });
});

describe('P2.12D.1m failed-state UI wiring', () => {
  it('uses separate automatic and explicit retry policies', () => {
    expect(component).toContain('const shouldTrigger = isExplicitRetry');
    expect(component).toContain('? shouldAllowExplicitPreparationRetry(');
    expect(component).toContain(': shouldAutoTriggerPreparation(');
    expect(component).toContain('preparationRequestGuard.current.tryStart');
    expect(component).toContain('triggerPreparationIfNeeded(workingSession, session, true)');
  });

  it('renders the retry button only when explicit retry is governed as safe', () => {
    expect(component).toContain('{canRetryFailedPreparation && (');
    expect(component.match(/Try preparation again/g)).toHaveLength(1);
  });
});
