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
const advanceFunction = correction.slice(
  correction.indexOf('CREATE OR REPLACE FUNCTION public.zeya_advance_formation_status'),
  correction.indexOf(
    'CREATE OR REPLACE FUNCTION public.zeya_link_formation_conversation'
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
assert(
  linkFunction.includes(
    "p_conversation_type IS DISTINCT FROM 'voice_conversation_output'"
  ),
  'voice-output link discriminator missing'
);

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
  /WHERE formation_session\.id = p_session_id\s+AND formation_session\.business_representation_id = p_business_representation_id\s+FOR UPDATE/.test(
    linkFunction
  ),
  'conversation-link lookup must be representation-scoped'
);
assert(
  correction.indexOf('IF v_existing.id IS NOT NULL THEN') <
    correction.indexOf('IF p_initiated_from IS NULL THEN'),
  'existing authorized initiation must replay before validating creation-only source'
);
assert(
  /p_expected_current_status\s*=\s*'initiated'/.test(advanceFunction) &&
    /p_new_status\s*=\s*'getting_familiar'/.test(advanceFunction) &&
    /p_expected_current_status\s*=\s*'getting_familiar'/.test(advanceFunction) &&
    /p_new_status\s*=\s*'working_conversation_pending'/.test(advanceFunction),
  'ordered transition allow-list missing'
);
assert.match(
  advanceFunction,
  /RETURNS TABLE\s*\(\s*session_id UUID,\s*business_representation_id UUID,\s*status public\.formation_session_status,\s*transitioned_at TIMESTAMPTZ\s*\)/,
  'advance RPC must preserve the deployed representation-aware return contract'
);
assert(
  advanceFunction.includes('IF v_session.status = p_new_status THEN') &&
    advanceFunction.includes('v_session.business_representation_id') &&
    advanceFunction.includes('v_session.updated_at'),
  'advance RPC idempotent retry contract missing'
);
assert(
  advanceFunction.includes("ERRCODE = 'PZ409'") &&
    advanceFunction.includes("MESSAGE = 'formation session state changed'"),
  'advance RPC state-change conflict contract missing'
);
assert(
  advanceFunction.includes('v_transitioned_at := pg_catalog.clock_timestamp()') &&
    advanceFunction.includes('updated_at = v_transitioned_at'),
  'advance RPC transition timestamp contract missing'
);
assert(
  advanceFunction.includes(
    'AND formation_session.business_representation_id =\n      p_business_representation_id'
  ),
  'advance RPC update must retain representation identity'
);
assert(
  !advanceFunction.includes('RETURNS TABLE (\n  session_id UUID,\n  status'),
  'advance RPC regressed to the incompatible three-column return shape'
);
assert(
  /RETURNS TABLE\s*\(\s*session_id UUID,\s*business_representation_id UUID,\s*status public\.formation_session_status,\s*linked_at TIMESTAMPTZ\s*\)/.test(
    linkFunction
  ),
  'link RPC must preserve the deployed enum-typed four-column return contract'
);
assert(
  !/RETURNS TABLE\s*\([^)]*status TEXT/.test(linkFunction) &&
    !linkFunction.includes('v_session.status::TEXT'),
  'link RPC regressed to the incompatible text status contract'
);
assert(
  linkFunction.includes('IF p_session_id IS NULL') &&
    linkFunction.includes('OR p_business_representation_id IS NULL') &&
    linkFunction.includes('OR p_conversation_id IS NULL'),
  'link RPC null parameter validation missing'
);
assert(
  linkFunction.includes(
    "p_conversation_type IS DISTINCT FROM 'voice_conversation_output'"
  ),
  'link RPC null-safe conversation type validation missing'
);
assert(
  /v_session\.status\s*=\s*'working_conversation_linked'::public\.formation_session_status\s+AND v_session\.first_working_conversation_id = p_conversation_id/.test(
    linkFunction
  ) &&
    linkFunction.includes('v_session.updated_at'),
  'link RPC idempotent retry contract missing'
);
assert(
  linkFunction.includes("ERRCODE = 'PZ409'") &&
    linkFunction.includes(
      "MESSAGE = 'formation session not ready for conversation linking'"
    ),
  'link RPC not-ready conflict contract missing'
);
assert(
  /conversation_output\.business_representation_id\s*=\s*p_business_representation_id/.test(
    linkFunction
  ),
  'link RPC conversation representation ownership validation missing'
);
assert(
  /WHERE formation_session\.id = p_session_id\s+AND formation_session\.business_representation_id =\s*p_business_representation_id\s+RETURNING formation_session\.\*/.test(
    linkFunction
  ),
  'link RPC update must remain representation-scoped'
);
assert(
  linkFunction.includes('v_linked_at := pg_catalog.clock_timestamp()') &&
    linkFunction.includes('updated_at = v_linked_at') &&
    linkFunction.includes('v_linked_at;'),
  'link RPC linked_at timestamp contract missing'
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
