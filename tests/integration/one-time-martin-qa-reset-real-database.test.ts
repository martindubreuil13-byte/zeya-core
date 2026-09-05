// Opt-in only: dedicated local stack, no application environment files loaded.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const container = 'supabase_db_zeya_day_one_v6_verify';
const enabled = process.env.ZEYA_V6_REAL_DB === '1';
const RPC = 'zeya_one_time_reset_martin_direct_hire_v6_qa_20260905';

const OWNER = '332d2299-0657-4d90-b43b-bda03bff6175';
const BUSINESS = '049d1a9c-c0dc-4113-ab31-44633e5a4141';
const REPRESENTATION = '886b773d-5c26-42e1-8089-17ae3c28fa96';
const EMAIL = 'martin@mindrasolutions.com';

function sql(source: string): string {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-XAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function sqlAsService(source: string): string {
  const raw = sql(`SET request.jwt.claim.role = 'service_role'; ${source}`);
  // psql prints a "SET" completion tag on its own line even with -t; strip
  // it so callers see only the actual statement's output.
  return raw.replace(/^SET\n/, '');
}

let client: SupabaseClient;

// Test-only cleanup: bypasses all triggers via session_replication_role so
// the pinned graph can be wiped instantly between scenarios without a full
// migration replay. Only ever run as the postgres superuser in this local
// disposable stack — never how the app or the reset RPC itself operates.
function cleanupPinnedGraph() {
  sql(`
    SET session_replication_role = replica;
    DELETE FROM public.direct_hire_formation_conversation_turns WHERE run_id IN (SELECT id FROM public.direct_hire_formation_conversation_runs WHERE business_representation_id='${REPRESENTATION}');
    DELETE FROM public.direct_hire_formation_conversation_runs WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.direct_hire_formation_prepared_context WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.direct_hire_first_working_session_formation_agenda_items WHERE formation_session_id IN (SELECT id FROM public.representation_formation_sessions WHERE business_representation_id='${REPRESENTATION}');
    DELETE FROM public.direct_hire_first_working_session_formation_handoffs WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.direct_hire_first_working_session_v6_one_attempt_recoveries WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.direct_hire_first_working_session_preparation_regenerations WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.direct_hire_first_working_session_preparation_recoveries WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.representation_formation_sessions WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.direct_hire_first_working_session_briefs WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.hypothesis_owner_operations WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.hypothesis_verifications WHERE hypothesis_id IN (SELECT id FROM public.hypotheses WHERE business_representation_id='${REPRESENTATION}');
    DELETE FROM public.hypotheses WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.direct_hire_public_sources WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.observations WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.evidence WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.audit_events WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.direct_hire_working_sessions WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.direct_hire_onboarding_sessions WHERE business_representation_id='${REPRESENTATION}';
    DELETE FROM public.business_representations WHERE id='${REPRESENTATION}';
    DELETE FROM public.businesses WHERE id='${BUSINESS}';
    UPDATE auth.users SET email='${EMAIL}' WHERE id='${OWNER}';
    SET session_replication_role = DEFAULT;
  `);
}

function seedFixture() {
  const source = readFileSync('tests/fixtures/one-time-martin-qa-reset-core.sql', 'utf8');
  const result = sql(source);
  expect(result).toContain('ONE_TIME_MARTIN_QA_RESET_FIXTURE_PASS');
}

function callReset(): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const raw = sqlAsService(`SELECT public.${RPC}();`);
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

function count(table: string, where: string): number {
  return Number(sql(`SELECT count(*) FROM public.${table} WHERE ${where}`));
}

describe.skipIf(!enabled)('One-time Martin QA app-data reset (real database)', () => {
  beforeAll(() => {
    const env = Object.fromEntries(readFileSync('/private/tmp/zeya-v6-local.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
    expect(env.API_URL).toMatch(/^http:\/\/127\.0\.0\.1:55321$/);
    expect(sql('SELECT count(*) FROM supabase_migrations.schema_migrations')).toBe('122');
    client = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    cleanupPinnedGraph();
  });

  it('happy path: reset succeeds once, removes the exact pinned graph, preserves Auth, re-arms all bypassed triggers, leaves unrelated tenant untouched', () => {
    seedFixture();

    // Unrelated tenant, created before reset, must remain untouched.
    const otherOwner = randomUUID(), otherBusiness = randomUUID(), otherRep = randomUUID();
    sql(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password) VALUES ('${otherOwner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${otherOwner}@example.test','x');
      INSERT INTO public.businesses (id,user_id,business_name) VALUES ('${otherBusiness}','${otherOwner}','Unrelated Tenant');
      INSERT INTO public.business_representations (id,business_id,user_id) VALUES ('${otherRep}','${otherBusiness}','${otherOwner}');
    `);

    const result = callReset();
    if (!result.ok) throw new Error('reset failed: ' + result.message);
    const deleted = result.data.deleted as Record<string, number>;

    // Exact rows removed, per category.
    expect(deleted.representation_formation_sessions).toBe(1);
    expect(deleted.direct_hire_first_working_session_formation_handoffs).toBe(1);
    expect(deleted.direct_hire_first_working_session_formation_agenda_items).toBe(1);
    expect(deleted.direct_hire_formation_conversation_runs).toBe(1);
    expect(deleted.direct_hire_formation_conversation_turns).toBe(1);
    expect(deleted.direct_hire_formation_prepared_context).toBe(1);
    expect(deleted.direct_hire_first_working_session_briefs).toBe(1);
    expect(deleted.hypotheses).toBe(7);
    expect(deleted.evidence).toBe(1);
    expect(deleted.observations).toBe(1);
    expect(deleted.direct_hire_working_sessions).toBe(1);
    expect(deleted.direct_hire_onboarding_sessions).toBe(1);
    expect(deleted.business_representations).toBe(1);
    expect(deleted.businesses).toBe(1);

    // Auth preserved exactly.
    expect(sql(`SELECT id,email FROM auth.users WHERE id='${OWNER}'`)).toBe(`${OWNER}|${EMAIL}`);

    // Target graph completely removed.
    expect(count('businesses', `id='${BUSINESS}'`)).toBe(0);
    expect(count('business_representations', `id='${REPRESENTATION}'`)).toBe(0);
    expect(count('direct_hire_onboarding_sessions', `business_representation_id='${REPRESENTATION}'`)).toBe(0);
    expect(count('representation_formation_sessions', `business_representation_id='${REPRESENTATION}'`)).toBe(0);
    expect(count('hypotheses', `business_representation_id='${REPRESENTATION}'`)).toBe(0);

    // Unrelated tenant untouched.
    expect(count('businesses', `id='${otherBusiness}'`)).toBe(1);
    expect(count('business_representations', `id='${otherRep}'`)).toBe(1);
    expect(sql(`SELECT count(*) FROM auth.users WHERE id='${otherOwner}'`)).toBe('1');

    // Data integrity enforcement still active generally (onboarding sessions
    // require a genuinely valid business/representation lineage — rejected
    // either by the FK itself or by the lineage-validation trigger that
    // fires first; either is proof enforcement remains intact).
    expect(() => sql(`INSERT INTO public.direct_hire_onboarding_sessions (id,owner_id,business_id,business_representation_id,owner_relationship_name,website_url,phone_e164,growth_priority,onboarding_state,preparation_status,profile_business_name,induction_state) VALUES ('${randomUUID()}','${otherOwner}','${randomUUID()}','${otherRep}','Owner','https://x.test','+66800000099','Growth','employment_accepted','ready','X','preparation_pending')`))
      .toThrow(/violates foreign key constraint|lineage mismatch|lineage invalid/);

    // All temporarily bypassed immutability triggers re-armed: rebuild a
    // fresh minimal Formation graph and confirm direct DELETE/UPDATE on the
    // previously-bypassed tables is rejected again as a normal client would
    // experience it (no qa_app_data_reset GUC set here).
    seedFixture();
    expect(() => sql(`DELETE FROM public.direct_hire_first_working_session_formation_handoffs WHERE business_representation_id='${REPRESENTATION}'`))
      .toThrow(/Direct Hire Formation handoff snapshot is immutable/);
    expect(() => sql(`DELETE FROM public.direct_hire_formation_conversation_turns WHERE run_id IN (SELECT id FROM public.direct_hire_formation_conversation_runs WHERE business_representation_id='${REPRESENTATION}')`))
      .toThrow(/Formation conversation history is append-only/);
    expect(() => sql(`DELETE FROM public.direct_hire_formation_prepared_context WHERE business_representation_id='${REPRESENTATION}'`))
      .toThrow(/formation_prepared_context_immutable/);
    cleanupPinnedGraph();
  }, 60000);

  it('second run fails: graph already gone', () => {
    seedFixture();
    const first = callReset();
    expect(first.ok).toBe(true);
    const second = callReset();
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.message).toMatch(/pinned QA graph not found/);
    cleanupPinnedGraph();
  }, 30000);

  it('wrong Auth identity fails and deletes nothing', () => {
    seedFixture();
    sql(`UPDATE auth.users SET email='someone-else@example.test' WHERE id='${OWNER}'`);
    const result = callReset();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toMatch(/QA reset auth identity mismatch/);
    expect(count('businesses', `id='${BUSINESS}'`)).toBe(1);
    expect(count('representation_formation_sessions', `business_representation_id='${REPRESENTATION}'`)).toBe(1);
    cleanupPinnedGraph();
  }, 30000);

  it('wrong business / representation / Formation (graph never seeded) fails closed', () => {
    // Only the Auth user exists; no business/representation/onboarding/Formation.
    sql(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password) VALUES ('${OWNER}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${EMAIL}','x') ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email;`);
    const result = callReset();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toMatch(/pinned QA graph not found/);
    cleanupPinnedGraph();
  }, 30000);

  it('structural confirmation: multiple RESTRICT-constrained execution/prospect tables reference business_representation_id and are intentionally outside the reset RPC delete list', () => {
    const restrictTables = sql(`
      SELECT string_agg(DISTINCT tc.table_name, ',' ORDER BY tc.table_name)
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
      WHERE tc.constraint_type='FOREIGN KEY' AND kcu.column_name='business_representation_id' AND rc.delete_rule='RESTRICT';
    `);
    const migration = readFileSync('supabase/migrations/20260905020000_one_time_martin_qa_app_data_reset.sql', 'utf8');
    const restricted = restrictTables.split(',');
    expect(restricted.length).toBeGreaterThan(5);
    for (const table of restricted) {
      if (table === 'direct_hire_first_working_session_formation_handoffs'
        || table === 'direct_hire_first_working_session_v6_one_attempt_recoveries'
        || table === 'hypotheses'
        || table === 'hypothesis_owner_operations'
        || table === 'direct_hire_formation_conversation_runs') continue; // explicitly handled
      expect(migration, `${table} should remain outside the delete list (fails closed via RESTRICT)`).not.toContain(`DELETE FROM public.${table}`);
    }
  }, 15000);

  it('induced mid-reset failure rolls back everything: zero partial deletion', () => {
    seedFixture();
    sql(`CREATE FUNCTION public.qa_reset_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'induced_qa_reset_failure'; END $$; CREATE TRIGGER qa_reset_test_failure BEFORE DELETE ON public.hypotheses FOR EACH ROW EXECUTE FUNCTION public.qa_reset_test_failure();`);
    try {
      const result = callReset();
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.message).toMatch(/induced_qa_reset_failure/);
    } finally {
      sql(`DROP TRIGGER qa_reset_test_failure ON public.hypotheses; DROP FUNCTION public.qa_reset_test_failure();`);
    }
    // Everything, including rows deleted earlier in the same transaction
    // (conversation turns/runs, prepared context, handoff, agenda, Formation,
    // briefs), must be back — the whole transaction rolled back.
    expect(count('businesses', `id='${BUSINESS}'`)).toBe(1);
    expect(count('representation_formation_sessions', `business_representation_id='${REPRESENTATION}'`)).toBe(1);
    expect(count('direct_hire_first_working_session_formation_handoffs', `business_representation_id='${REPRESENTATION}'`)).toBe(1);
    expect(count('direct_hire_formation_prepared_context', `business_representation_id='${REPRESENTATION}'`)).toBe(1);
    expect(count('direct_hire_formation_conversation_runs', `business_representation_id='${REPRESENTATION}'`)).toBe(1);
    expect(count('hypotheses', `business_representation_id='${REPRESENTATION}'`)).toBe(7);
    // GUC bypass flags must not be left dangling 'on' after a rolled-back failure.
    expect(sql(`SELECT coalesce(current_setting('zeya.qa_app_data_reset', true), 'unset')`)).toMatch(/unset|off/);
    cleanupPinnedGraph();
  }, 30000);

  it('no generic reusable purge capability was introduced: function takes zero parameters and is pinned to constants', () => {
    expect(sql(`SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='${RPC}'`)).toBe('');
    const definition = sql(`SELECT prosrc FROM pg_proc WHERE proname='${RPC}'`);
    expect(definition).toContain(OWNER);
    expect(definition).toContain(BUSINESS);
    expect(definition).toContain(REPRESENTATION);
  }, 15000);

  it('fresh customer path afterward: same owner creates a new business/representation/onboarding with no stale Formation block and a normal fresh Preparation budget', async () => {
    seedFixture();
    const result = callReset();
    expect(result.ok).toBe(true);

    const newBusiness = randomUUID(), newRep = randomUUID(), newOnboarding = randomUUID();
    sql(`
      INSERT INTO public.businesses (id,user_id,business_name) VALUES ('${newBusiness}','${OWNER}','Fresh Business');
      INSERT INTO public.business_representations (id,business_id,user_id) VALUES ('${newRep}','${newBusiness}','${OWNER}');
      INSERT INTO public.direct_hire_onboarding_sessions
        (id,owner_id,business_id,business_representation_id,owner_relationship_name,website_url,phone_e164,growth_priority,onboarding_state,preparation_status,profile_business_name,induction_state)
      VALUES ('${newOnboarding}','${OWNER}','${newBusiness}','${newRep}','Owner','https://fresh.example.test','+66800000010','Growth','employment_accepted','ready','Fresh Business','preparation_pending');
    `);
    // No stale Formation blocks a fresh Formation from ever being created for
    // this representation: the uniqueness slot is genuinely free.
    expect(count('representation_formation_sessions', `business_representation_id='${newRep}'`)).toBe(0);
    sql(`INSERT INTO public.representation_formation_sessions (business_id,business_representation_id,owner_id,status,initiated_from,initiated_from_id,prepared_context_mode) VALUES ('${newBusiness}','${newRep}','${OWNER}','initiated','direct_hire_onboarding','${newOnboarding}','immutable_snapshot_v6')`);
    expect(count('representation_formation_sessions', `business_representation_id='${newRep}'`)).toBe(1);

    // Fresh Preparation lineage: a new working session starts with attempt_count=0,
    // no legacy/v6 recovery table participates in it at all.
    const newWorking = randomUUID();
    sql(`INSERT INTO public.direct_hire_working_sessions (id,owner_id,business_id,business_representation_id,direct_hire_onboarding_session_id,scheduled_at,scheduling_timezone) VALUES ('${newWorking}','${OWNER}','${newBusiness}','${newRep}','${newOnboarding}',now()+interval '1 day','Asia/Bangkok')`);
    expect(sql(`SELECT preparation_attempt_count,preparation_status FROM public.direct_hire_working_sessions WHERE id='${newWorking}'`)).toBe('0|pending');
    expect(count('direct_hire_first_working_session_v6_one_attempt_recoveries', `direct_hire_onboarding_session_id='${newOnboarding}'`)).toBe(0);
    expect(count('direct_hire_first_working_session_preparation_recoveries', `direct_hire_onboarding_session_id='${newOnboarding}'`)).toBe(0);
    expect(count('direct_hire_first_working_session_preparation_regenerations', `direct_hire_onboarding_session_id='${newOnboarding}'`)).toBe(0);

    sql(`SET session_replication_role = replica; DELETE FROM public.business_representations WHERE id='${newRep}'; DELETE FROM public.businesses WHERE id='${newBusiness}'; SET session_replication_role = DEFAULT;`);
    cleanupPinnedGraph();
  }, 30000);
});
