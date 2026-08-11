import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Preparation intelligence real-journey wiring', () => {
  it('runs the existing hypothesis orchestration after durable finalization', async () => {
    const route = await readFile('app/api/onboarding/direct-hire/preparation/route.ts', 'utf8');
    const helper = await readFile('lib/onboarding/preparation-intelligence.ts', 'utf8');
    expect(route.indexOf('zeya_finalize_direct_hire_preparation')).toBeLessThan(route.lastIndexOf('completeIntelligentPreparation(row)'));
    expect(helper).toContain('persistReasonedHypothesesForPreparation');
    expect(helper).toContain("result.status !== 'complete'");
    expect(helper).toContain('result.readbackVerified');
  });

  it('requires exactly seven deterministic current domains and validates predecessor lineage', async () => {
    const helper = await readFile('lib/onboarding/preparation-intelligence.ts', 'utf8');
    for (const domain of ['whatYouSell', 'whoItIsFor', 'problemOrAspiration', 'whyCustomersShouldCare', 'proposedDescription', 'authorityBoundaries', 'clarificationsNeeded']) {
      expect(helper).toContain(`'${domain}'`);
    }
    expect(helper).toContain(".order('hypothesis_version', { ascending: false })");
    expect(helper).toContain('predecessor.hypothesis_version !== row.hypothesis_version - 1');
  });

  it('reuses immutable next-version persistence for an all-domain stale snapshot refresh', async () => {
    const orchestration = await readFile('lib/onboarding/persist-hypotheses-orchestration.ts', 'utf8');
    const migration = await readFile('supabase/migrations/20260808000003_hypotheses_persist_fix_42702_fully_qualify_columns.sql', 'utf8');
    expect(orchestration).toContain("scope: { mode: 'all_domains' }");
    expect(orchestration).toContain('p_request_trace_id: reasoningRunId');
    expect(migration).toContain('MAX(h.hypothesis_version), 0) + 1');
    expect(migration).toContain('previous_hypothesis_id');
    expect(migration).toContain('v_predecessor_id');
    expect(migration).not.toContain('UPDATE public.hypotheses');
  });

  it('makes retry resumable and prevents a false intelligent-ready response', async () => {
    const route = await readFile('app/api/onboarding/direct-hire/preparation/route.ts', 'utf8');
    const summary = await readFile('app/api/onboarding/direct-hire/preparation/summary/route.ts', 'utf8');
    const helper = await readFile('lib/onboarding/preparation-intelligence.ts', 'utf8');
    expect(route).toContain("failure('preparation_intelligence_pending', 503)");
    expect(route).toContain("if (!row.claimed || row.preparation_status === \"ready\")");
    expect(helper).toContain('if (existing.length === PREPARATION_DOMAINS.length) return existing');
    expect(helper).toContain('loadFreshCurrentPreparationHypotheses');
    expect(helper).toContain('hypothesis.requestTraceId === reasoningRunId');
    expect(summary).toContain('ensurePreparationIntelligence(createDirectHireServiceClient(), scope)');
    expect(summary.indexOf('await ensurePreparationIntelligence')).toBeLessThan(
      summary.indexOf('buildPrivatePreparationProjection(auth.supabase'),
    );
    expect(summary).toContain("throw new PreparationIntelligenceIncompleteError('Preparation intelligence refresh failed')");
    expect(summary).toContain("return failure('preparation_intelligence_pending', 409)");
  });

  it('logs refresh diagnostics server-side without exposing them through Summary', async () => {
    const summary = await readFile('app/api/onboarding/direct-hire/preparation/summary/route.ts', 'utf8');
    expect(summary).toContain('preparation_intelligence_refresh_failed');
    expect(summary).toContain('errorClass:');
    expect(summary).toContain('message:');
    expect(summary).not.toContain('details:');
    expect(summary).not.toContain('hint:');
    expect(summary).not.toContain('raw_statement');
  });

  it('scopes hypotheses and their Evidence to exact owner lineage', async () => {
    const helper = await readFile('lib/onboarding/preparation-intelligence.ts', 'utf8');
    for (const predicate of [
      ".eq('owner_id', scope.ownerId)",
      ".eq('business_id', scope.businessId)",
      ".eq('business_representation_id', scope.businessRepresentationId)",
      ".eq('direct_hire_onboarding_session_id', scope.onboardingSessionId)",
    ]) expect(helper).toContain(predicate);
    expect(helper).toContain('Hypothesis cites Evidence outside the exact preparation scope');
  });

  it('uses one projection in Summary and Formation without browser-facing internal IDs', async () => {
    const summary = await readFile('app/api/onboarding/direct-hire/preparation/summary/route.ts', 'utf8');
    const formation = await readFile('app/api/formation/sessions/[sessionId]/prepared-context/route.ts', 'utf8');
    expect(summary).toContain('buildPrivatePreparationProjection');
    expect(formation).toContain('buildPrivatePreparationProjection');
    expect(summary).toContain('toOwnerPreparationProjection');
    expect(formation).toContain('toOwnerPreparationProjection');
    expect(formation).not.toContain('raw_statement');
    expect(formation).not.toContain('website_url');
  });

  it('keeps unknown, partial, and contradicted epistemic states visible', async () => {
    const owner = await readFile('components/onboarding/DirectHirePreparationSummary.tsx', 'utf8');
    expect(owner).toContain("domain.epistemicState === 'unknown'");
    expect(owner).toContain("domain.epistemicState === 'partial'");
    expect(owner).toContain("domain.epistemicState === 'contradicted'");
    expect(owner).toContain('Unknown — I need your clarification');
    expect(owner).toContain('only partially supported');
  });

  it('does not create canonical or approval artifacts', async () => {
    const route = await readFile('app/api/onboarding/direct-hire/preparation/route.ts', 'utf8');
    const helper = await readFile('lib/onboarding/preparation-intelligence.ts', 'utf8');
    const implementation = `${route}\n${helper}`;
    expect(implementation).not.toContain(".from('representation_versions')");
    expect(implementation).not.toContain(".from('approval_decisions')");
    expect(implementation).not.toContain(".from('proposals')");
  });

  it('blocks Formation initiation until intelligence is complete', async () => {
    const route = await readFile('app/api/onboarding/direct-hire/formation/route.ts', 'utf8');
    expect(route).toContain('loadFreshCurrentPreparationHypotheses');
    expect(route).toContain("failure('preparation_intelligence_pending', 409)");
  });
});
