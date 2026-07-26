import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const foundation = readFileSync(
  resolve('supabase/migrations/20260724000000_representation_formation_sessions.sql'),
  'utf8'
);
const correction = readFileSync(
  resolve('supabase/migrations/20260726000000_rfa_controlled_purge_reconciliation.sql'),
  'utf8'
);
const latestPreRfAPurgeMigration = readFileSync(
  resolve('supabase/migrations/20260719120000_voice_candidate_atomic_canonicalization.sql'),
  'utf8'
);
const finalContract = `${foundation}\n${correction}`;

function purgeFunction(sql: string): string {
  const marker = 'CREATE OR REPLACE FUNCTION public.zeya_purge_business_representation';
  const start = sql.lastIndexOf(marker);
  assert(start >= 0, 'controlled purge definition missing');
  return sql.slice(start);
}

function matches(sql: string, pattern: RegExp): string[] {
  return [...sql.matchAll(pattern)].map(match => match[1]);
}

const latestPurge = purgeFunction(latestPreRfAPurgeMigration);
const correctivePurge = purgeFunction(correction);
const linkFunction = correction.slice(
  correction.indexOf('CREATE OR REPLACE FUNCTION public.zeya_link_formation_conversation'),
  correction.indexOf(
    'REVOKE ALL ON FUNCTION public.zeya_initiate_formation_session'
  )
);
const latestDeleteTables = new Set(matches(latestPurge, /DELETE FROM public\.([a-z_]+)/g));
const correctiveDeleteTables = new Set(matches(correctivePurge, /DELETE FROM public\.([a-z_]+)/g));
const latestCounters = new Set(matches(latestPurge, /jsonb_build_object\('([a-z_]+)'/g));
const correctiveCounters = new Set(matches(correctivePurge, /jsonb_build_object\('([a-z_]+)'/g));

assert.deepEqual(
  [...correctiveDeleteTables].filter(table => table !== 'representation_formation_sessions').sort(),
  [...latestDeleteTables].sort(),
  'corrective purge changed the pre-RF-A deletion inventory'
);
assert.deepEqual(
  [...correctiveCounters].filter(key => key !== 'representation_formation_sessions').sort(),
  [...latestCounters].sort(),
  'corrective purge changed the pre-RF-A deletion counters'
);
assert(correctiveDeleteTables.has('representation_formation_sessions'), 'Formation purge path missing');
assert(correctiveCounters.has('representation_formation_sessions'), 'Formation purge counter missing');
assert(correctivePurge.includes("auth.role() <> 'service_role'"), 'purge service-role authorization missing');
assert(correctivePurge.includes("SET search_path = ''"), 'purge empty search_path missing');
assert(correctivePurge.includes("set_config('zeya.controlled_purge', 'on', true)"), 'purge bypass enable missing');
assert(
  correctivePurge.match(/set_config\('zeya\.controlled_purge', 'off', true\)/g)?.length === 2,
  'purge bypass must be disabled on success and exception'
);
assert(correctivePurge.includes('v_actual_business_id <> p_expected_business_id'), 'purge Business identity guard missing');

for (const state of [
  'initiated',
  'getting_familiar',
  'working_conversation_pending',
  'working_conversation_linked',
]) {
  assert(finalContract.includes(`'${state}'`), `missing RF-A state ${state}`);
}

assert(!foundation.includes('formation_complete'), 'foundation retains forbidden Formation Complete concept');
assert(!finalContract.includes('record_formation_session_audit'), 'Formation canonical audit function must not exist');
assert(!finalContract.includes("'first_working_conversation'"), 'unsupported conversation discriminator remains');
assert(correction.includes("p_conversation_type <> 'voice_conversation_output'"), 'voice-output link discriminator missing');

for (const rpc of [
  'zeya_initiate_formation_session',
  'zeya_advance_formation_status',
  'zeya_link_formation_conversation',
]) {
  assert(
    correction.includes(`CREATE OR REPLACE FUNCTION public.${rpc}`),
    `corrective definition missing for ${rpc}`
  );
  assert(
    correction.includes(`REVOKE ALL ON FUNCTION public.${rpc}`),
    `execution revoke missing for ${rpc}`
  );
}

assert(correction.includes("SET search_path = ''"), 'empty search_path missing');
assert(
  correction.includes('REVOKE ALL ON TABLE public.representation_formation_sessions FROM PUBLIC, anon, authenticated'),
  'direct authenticated Formation writes are not revoked'
);
assert(
  correction.includes('GRANT SELECT ON TABLE public.representation_formation_sessions TO authenticated'),
  'owner read privilege missing'
);
assert(correction.includes('b.user_id = p_owner_id'), 'Business owner verification missing');
assert(correction.includes('br.user_id = p_owner_id'), 'Representation owner verification missing');
assert(
  foundation.includes('CONSTRAINT formation_session_representation_uniq') &&
    correction.includes('ON CONFLICT ON CONSTRAINT formation_session_representation_uniq'),
  'concurrency-safe initiation constraint target missing'
);
assert(
  correction.includes(
    'WHERE formation_session.business_representation_id = p_business_representation_id'
  ),
  'idempotency lookup must qualify the RETURNS TABLE output-column name'
);
assert(
  linkFunction.includes(
    'AND formation_session.business_representation_id = p_business_representation_id'
  ),
  'conversation-link lookup must qualify the RETURNS TABLE output-column name'
);
assert(
  correction.indexOf('IF v_existing.id IS NOT NULL THEN') <
    correction.indexOf('IF p_initiated_from IS NULL THEN'),
  'existing authorized initiation must replay before validating creation-only source'
);
assert(
  correction.includes("p_expected_current_status = 'initiated'") &&
    correction.includes("p_new_status = 'getting_familiar'") &&
    correction.includes("p_expected_current_status = 'getting_familiar'") &&
    correction.includes("p_new_status = 'working_conversation_pending'"),
  'ordered transition allow-list missing'
);
assert(
  correction.includes("v_session.status = 'working_conversation_linked'") &&
    correction.includes('v_session.first_working_conversation_id IS DISTINCT FROM p_conversation_id'),
  'conversation replay/replacement guard missing'
);

for (const purgeKey of [
  'representation_formation_sessions',
  'conversation_candidate_canonicalizations',
  'conversation_candidate_promotions',
  'conversation_candidate_review_decisions',
  'voice_conversation_candidates',
  'voice_conversation_outputs',
  'voice_representation_lineage',
  'audit_events',
  'confidence_assessments',
  'representation_versions',
  'approval_decisions',
  'proposal_elements',
  'proposal_evidence',
  'proposal_observations',
  'representation_proposals',
  'observations',
  'evidence',
  'representation_elements',
  'representation_domains',
  'business_representations',
]) {
  assert(correction.includes(`'${purgeKey}'`), `controlled purge key missing: ${purgeKey}`);
}

console.log('Representation Formation RF-A migration contract — PASS');
