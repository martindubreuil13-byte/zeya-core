import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildDirectHireFormationAgenda } from '../../lib/formation/direct-hire-agenda';
import type { FirstWorkingSessionBrief } from '../../lib/onboarding/first-working-session-brief';
import type { CurrentPreparationHypothesis } from '../../lib/onboarding/preparation-intelligence';

const migration = 'supabase/migrations/20260815000000_direct_hire_first_working_session_formation_handoff.sql';

const hypotheses: CurrentPreparationHypothesis[] = [
  ['whatYouSell', 'medium', 'partial'],
  ['whoItIsFor', 'high', 'unknown'],
  ['problemOrAspiration', 'low', 'supported'],
  ['whyCustomersShouldCare', 'low', 'supported'],
  ['proposedDescription', 'low', 'partial'],
  ['authorityBoundaries', 'high', 'unknown'],
  ['clarificationsNeeded', 'medium', 'unknown'],
].map(([constitutionalDomain, representationRisk, epistemicState], index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  constitutionalDomain,
  representationRisk,
  epistemicState,
  currentBelief: null,
  confidence: epistemicState === 'unknown' ? 'unknown' : 'medium',
  riskReason: null,
  verificationNeed: null,
  sourceEvidenceIds: [],
  hypothesisVersion: 5,
  previousHypothesisId: `10000000-0000-4000-8000-00000000000${index}`,
  ownerDecision: null,
  requestTraceId: 'trace',
  createdByActor: 'system',
})) as CurrentPreparationHypothesis[];

const statement = (text: string, hypothesisIds: string[], evidenceIds: string[] = []) => ({
  statement: text, kind: 'unknown' as const, hypothesisIds, evidenceIds,
});
const authorityId = hypotheses.find((item) => item.constitutionalDomain === 'authorityBoundaries')!.id;
const customerId = hypotheses.find((item) => item.constitutionalDomain === 'whoItIsFor')!.id;
const descriptionId = hypotheses.find((item) => item.constitutionalDomain === 'proposedDescription')!.id;
const base = statement('Supported business understanding.', [hypotheses[0].id]);
const brief: FirstWorkingSessionBrief = {
  businessRead: base, offerRead: base, customerRead: base,
  problemOutcomeRead: base, positioningRead: base,
  commercialSignals: [], contradictions: [],
  authorityGaps: [statement('Pricing, negotiation, promises, commitments and escalation authority remain unknown.', [authorityId])],
  formationPriorities: [
    statement('Clarify what Zeya may negotiate and when owner approval is required.', [authorityId]),
    statement('Clarify the primary target customer before outreach.', [customerId]),
    statement('Refine secondary positioning wording.', [descriptionId]),
  ],
  unknowns: [], workingOpinions: [], openingInsights: [],
  questions: [statement('What pricing or negotiation authority may Zeya exercise?', [authorityId])],
  governance: { canonical: false, containsChainOfThought: false },
};

describe('P2.3A deterministic Formation agenda', () => {
  it('is deterministic, ranks authority first, and merges redundant authority sources', () => {
    const first = buildDirectHireFormationAgenda({ brief, hypotheses, snapshotFingerprint: 'snapshot' });
    const replay = buildDirectHireFormationAgenda({ brief, hypotheses, snapshotFingerprint: 'snapshot' });
    expect(replay).toEqual(first);
    expect(first[0]).toMatchObject({
      rank: 1, category: 'authority', constitutionalDomain: 'authorityBoundaries',
      risk: 'high', blocking: true, resolutionStatus: 'unresolved',
    });
    expect(first.filter((item) => item.category === 'authority')).toHaveLength(1);
    expect(first[0].sourceBriefSections).toEqual(expect.arrayContaining([
      'authorityGaps', 'formationPriorities', 'questions',
    ]));
    expect(first[0].sourceHypothesisIds).toEqual([authorityId]);
    expect(first.map((item) => item.rank)).toEqual(first.map((_, index) => index + 1));
  });

  it('blocks severe target ambiguity but leaves descriptive refinement deferrable', () => {
    const agenda = buildDirectHireFormationAgenda({ brief, hypotheses, snapshotFingerprint: 'snapshot' });
    expect(agenda.find((item) => item.constitutionalDomain === 'whoItIsFor')).toMatchObject({
      category: 'commercial', risk: 'high', blocking: true,
    });
    expect(agenda.find((item) => item.constitutionalDomain === 'proposedDescription')).toMatchObject({
      blocking: false,
    });
  });
});

describe('P2.3A exact handoff migration', () => {
  it('requires the exact ready v4 appointment, current brief, snapshots, and seven-domain trace', async () => {
    const sql = await readFile(migration, 'utf8');
    for (const marker of [
      "v_session.status <> 'scheduled'", "v_session.preparation_status <> 'ready'",
      "v_session.preparation_contract_version IS DISTINCT FROM 'first-working-session-preparation-v4'",
      'brief.id = p_expected_brief_id', 'brief.current',
      'v_session.preparation_snapshot_fingerprint IS DISTINCT FROM p_expected_snapshot_fingerprint',
      'v_brief.source_snapshot_fingerprint IS DISTINCT FROM p_expected_snapshot_fingerprint',
      'v_brief.hypothesis_trace_fingerprint IS DISTINCT FROM p_expected_hypothesis_trace_fingerprint',
      'v_hypothesis_trace IS DISTINCT FROM p_expected_hypothesis_trace_fingerprint',
      'v_hypothesis_count <> 7', 'count(DISTINCT hypothesis.constitutional_domain)',
      "v_onboarding.onboarding_state <> 'employment_accepted'",
      "v_onboarding.induction_state <> 'preparation_pending'",
      'representation.current_version_id IS NULL',
    ]) expect(sql).toContain(marker);
  });

  it('is exact-tenant, serialized, idempotent, and fails closed on conflicting lineage', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('working_session.owner_id = p_authenticated_owner_id');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('v_existing_handoff.id IS NOT NULL');
    expect(sql).toContain("MESSAGE = 'Formation handoff lineage conflict'");
    expect(sql).toContain('RETURN QUERY SELECT v_existing_handoff.formation_session_id, false');
    expect(sql).toContain("auth.role() <> 'service_role'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.zeya_initiate_direct_hire_formation(uuid,boolean)');
  });

  it('atomically links Formation, handoff, immutable agenda, appointment, and onboarding', async () => {
    const sql = await readFile(migration, 'utf8');
    const formation = sql.indexOf('INSERT INTO public.representation_formation_sessions');
    const handoff = sql.indexOf('INSERT INTO public.direct_hire_first_working_session_formation_handoffs');
    const agenda = sql.indexOf('INSERT INTO public.direct_hire_first_working_session_formation_agenda_items');
    const appointment = sql.indexOf('UPDATE public.direct_hire_working_sessions');
    const onboarding = sql.indexOf('UPDATE public.direct_hire_onboarding_sessions');
    expect(formation).toBeLessThan(handoff);
    expect(handoff).toBeLessThan(agenda);
    expect(agenda).toBeLessThan(appointment);
    expect(appointment).toBeLessThan(onboarding);
    expect(sql.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(2);
  });

  it('does not create voice, proposals, approvals, Versions, or canonical state', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE) public\.(?:voice_conversation_outputs|representation_proposals|approval_decisions|representation_versions)/i);
    expect(sql).not.toContain('current_version_id =');
    expect(sql).toContain("'initiated', 'direct_hire_onboarding'");
  });

  it('ships service-only ACLs and private RLS without changing Public Experience', async () => {
    const sql = await readFile(migration, 'utf8');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).not.toMatch(/GRANT SELECT ON TABLE public\.direct_hire_first_working_session_formation_\w+ TO authenticated/);
    expect(sql).toContain('TO service_role');
    expect(sql).not.toContain('public_experience_session');
  });

  it('ships read-only preflight and postcheck bundles', async () => {
    const files = await Promise.all([
      readFile('supabase/manual/20260815_direct_hire_first_working_session_formation_preflight.sql', 'utf8'),
      readFile('supabase/manual/20260815_direct_hire_first_working_session_formation_postcheck.sql', 'utf8'),
    ]);
    for (const sql of files) {
      expect(sql).toContain('PASS');
      expect(sql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|MERGE|CALL|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/im);
    }
    expect(files[0]).toContain('exact_ready_v4_lineage');
    expect(files[1]).toContain('immutable_deterministic_agenda');
    expect(files[1]).toContain('no_canonical_proposal_or_voice_mutation');
  });
});

describe('P2.3A prepared context boundary', () => {
  it('returns only owner-safe context while retaining private lineage server-side', async () => {
    const route = await readFile('app/api/formation/sessions/[sessionId]/prepared-context/route.ts', 'utf8');
    const helper = await readFile('lib/formation/direct-hire-prepared-context.ts', 'utf8');
    expect(route).toContain('data: context.ownerSafe');
    expect(route).not.toContain('privateServiceContext:');
    expect(helper).toContain('privateServiceContext');
    for (const field of ['openingSynthesis', 'agendaCategories', 'agendaCount', 'blockingItemCount', 'currentSessionState']) {
      expect(helper).toContain(field);
    }
  });
});
