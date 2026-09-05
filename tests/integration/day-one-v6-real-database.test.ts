// Opt-in only: dedicated local stack, no application environment files loaded.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ensureImmutablePreparedContext, type PreparedContextIdentity } from '../../lib/formation/prepared-context-binding';
import { generateReasoningRunFingerprint } from '../../lib/onboarding/persist-hypotheses-orchestration';
import { buildFirstWorkingSessionHypothesisTraceFingerprint } from '../../lib/onboarding/first-working-session-brief';
import { loadFreshCurrentPreparationHypotheses, PREPARATION_DOMAINS } from '../../lib/onboarding/preparation-intelligence';

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient, owner: '' }));
vi.mock('../../lib/representation/api-auth', () => ({ createAuthenticatedRepresentationContext: async () => ({ user: { id: state.owner }, supabase: state.client }) }));
vi.mock('../../lib/onboarding/direct-hire-service-client', () => ({ createDirectHireServiceClient: () => state.client }));
import { POST } from '../../app/api/onboarding/direct-hire/formation/route';

const container = 'supabase_db_zeya_day_one_v6_verify';
const enabled = process.env.ZEYA_V6_REAL_DB === '1';
function sql(source: string): string {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-XAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function asyncSql(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-XAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']);
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('error', reject); child.on('close', code => code ? reject(new Error(err)) : resolve(out)); child.stdin.end(source);
  });
}
const table = 'direct_hire_formation_prepared_context';
async function fixture() {
  const owner = randomUUID(), business = randomUUID(), representation = randomUUID(), onboarding = randomUUID(), working = randomUUID(), evidence = randomUUID(), briefId = randomUUID();
  let source = readFileSync('tests/fixtures/day-one-v6-core.sql', 'utf8').split('INSERT INTO public.hypotheses')[0];
  const replacements: Record<string,string> = { '10000000-0000-0000-0000-000000000001': owner, '20000000-0000-0000-0000-000000000001': business, '20000000-0000-0000-0000-000000000002': randomUUID(), '30000000-0000-0000-0000-000000000001': representation, '30000000-0000-0000-0000-000000000002': randomUUID(), '40000000-0000-0000-0000-000000000001': onboarding, '50000000-0000-0000-0000-000000000001': working };
  for (const [a,b] of Object.entries(replacements)) source = source.replaceAll(a,b);
  source = source.replace('v6@example.test', `${owner}@example.test`);
  sql(source);
  const check = async (operation: PromiseLike<{ error: unknown }>) => { expect((await operation).error).toBeNull(); };
  await check(state.client.from('evidence').insert({ id: evidence, business_representation_id: representation, direct_hire_onboarding_session_id: onboarding, source_type: 'direct_hire_induction', raw_statement: 'Owner supplied business context', statement_hash: evidence, captured_by_actor: 'local-test' }));
  const trace = generateReasoningRunFingerprint(onboarding, representation, [evidence], []);
  await check(state.client.from('hypotheses').insert(PREPARATION_DOMAINS.map(domain => ({ id: randomUUID(), owner_id: owner, business_id: business, business_representation_id: representation, direct_hire_onboarding_session_id: onboarding, constitutional_domain: domain, hypothesis_version: 1, epistemic_state: 'unknown', confidence: 'unknown', representation_risk: 'low', evidence_cutoff_at: new Date().toISOString(), created_by_actor: 'local-test', request_trace_id: trace }))));
  const hypotheses = await loadFreshCurrentPreparationHypotheses(state.client, { ownerId: owner, businessId: business, businessRepresentationId: representation, onboardingSessionId: onboarding });
  expect(hypotheses).toHaveLength(7);
  const fingerprint = buildFirstWorkingSessionHypothesisTraceFingerprint(hypotheses);
  await check(state.client.from('direct_hire_first_working_session_briefs').insert({ id: briefId, owner_id: owner, business_id: business, business_representation_id: representation, direct_hire_onboarding_session_id: onboarding, direct_hire_working_session_id: working, source_snapshot_fingerprint: 'snapshot-v6', hypothesis_trace_fingerprint: fingerprint, preparation_contract_version: 'first-working-session-preparation-v6', brief: { authorityGaps: [], contradictions: [], formationPriorities: [], unknowns: [], questions: [], workingOpinions: [] }, source_hypothesis_ids: hypotheses.map(h => h.id) }));
  return { owner, business, representation, onboarding, working, briefId, hypotheses, fingerprint };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function start(f: Fixture) {
  state.owner = f.owner;
  return POST(new NextRequest('http://127.0.0.1:55321/api/onboarding/direct-hire/formation', { method: 'POST', body: JSON.stringify({ workingSessionId: f.working }) }));
}
function formation(f: Fixture) { return sql(`SELECT formation_session_id FROM public.direct_hire_working_sessions WHERE id='${f.working}'`); }
function count(id: string) { return Number(sql(`SELECT count(*) FROM public.${table} WHERE formation_session_id='${id}'`)); }
function mode(id: string) { return sql(`SELECT prepared_context_mode FROM public.representation_formation_sessions WHERE id='${id}'`); }
async function load(id: string): Promise<PreparedContextIdentity | null> {
  const {data,error} = await state.client.from(table).select('*').eq('formation_session_id',id).maybeSingle(); expect(error).toBeNull();
  return data ? { formationSessionId: data.formation_session_id, businessRepresentationId: data.business_representation_id, preparationBriefId: data.preparation_brief_id, hypothesisSnapshotIds: data.hypothesis_snapshot_ids, preparationContractVersion: data.preparation_contract_version, reasoningContractVersion: data.reasoning_contract_version } : null;
}
function rpcSql(f: Fixture, id: string, reasoning = 'test-reasoning') { return `SELECT * FROM public.zeya_create_formation_prepared_context_snapshot('${id}','${f.working}','${f.representation}','${f.briefId}',ARRAY[${f.hypotheses.map(h => `'${h.id}'::uuid`).join(',')}],'first-working-session-preparation-v6','${reasoning}');`; }

describe.skipIf(!enabled)('Day-One V6 real disposable PostgreSQL matrix', () => {
  beforeAll(() => {
    const env = Object.fromEntries(readFileSync('/private/tmp/zeya-v6-local.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=> { const i=l.indexOf('='); return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')]; }));
    expect(env.API_URL).toMatch(/^http:\/\/127\.0\.0\.1:55321$/);
    expect(sql('SELECT count(*) FROM supabase_migrations.schema_migrations')).toBe('122');
    state.client = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
  });
  it('real Start fails closed on database rejection, retains V6 Formation, and retries the same ID exactly once', async () => {
    const f = await fixture();
    sql(`CREATE FUNCTION public.v6_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.direct_hire_working_session_id='${f.working}' THEN RAISE EXCEPTION 'induced_snapshot_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER v6_test_failure BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.v6_test_failure();`);
    let id = '';
    try { const first = await start(f); expect(first.status).toBe(500); expect((await first.json()).error).toBe('induced_snapshot_failure'); id=formation(f); expect(id).toMatch(/^[0-9a-f-]{36}$/); expect(mode(id)).toBe('immutable_snapshot_v6'); expect(count(id)).toBe(0); }
    finally { sql(`DROP TRIGGER v6_test_failure ON public.${table}; DROP FUNCTION public.v6_test_failure();`); }
    const second = await start(f); expect(second.status).toBe(200); expect((await second.json()).data.formationSessionId).toBe(id); expect(formation(f)).toBe(id); expect(mode(id)).toBe('immutable_snapshot_v6'); expect(count(id)).toBe(1);
    expect(sql(`SELECT count(*) FROM public.representation_formation_sessions WHERE business_representation_id='${f.representation}'`)).toBe('1');
    for (const role of ['postgres','service_role']) for (const verb of ['UPDATE','DELETE']) {
      const mutation = verb==='UPDATE' ? `UPDATE public.${table} SET reasoning_contract_version='changed'` : `DELETE FROM public.${table}`;
      expect(()=>sql(`SET ROLE ${role}; ${mutation} WHERE formation_session_id='${id}';`)).toThrow(/formation_prepared_context_immutable/);
    }
    expect(()=>sql(`INSERT INTO public.${table} SELECT * FROM public.${table} WHERE formation_session_id='${id}'`)).toThrow(/duplicate key/);
    const actual=(await load(id))!;
    await expect(ensureImmutablePreparedContext({expected:{...actual,hypothesisSnapshotIds:[...actual.hypothesisSnapshotIds].reverse()},load:()=>load(id),create:async()=>{throw new Error('unexpected create');}})).resolves.toBe('existing');
    for (const field of ['formationSessionId','businessRepresentationId','preparationBriefId','hypothesisSnapshotIds','preparationContractVersion','reasoningContractVersion'] as const) {
      const expected={...actual,[field]:field==='hypothesisSnapshotIds'?[randomUUID()]:randomUUID()};
      await expect(ensureImmutablePreparedContext({expected,load:()=>load(id),create:async()=>{throw new Error('unexpected create');}})).rejects.toThrow('snapshot_binding_conflict');
    }
  },30000);
  it('canonical fingerprint matches; real route rejects mismatch with zero snapshots', async () => {
    const f=await fixture();
    // Replace only fixture brief fingerprint before any snapshot exists; brief rows permit this update.
    const result=await state.client.from('direct_hire_first_working_session_briefs').update({hypothesis_trace_fingerprint:'mismatch'}).eq('id',f.briefId); expect(result.error).toBeNull();
    const response=await start(f); expect(response.status).toBe(409); expect((await response.json()).error).toBe('hypothesis_lineage_mismatch');
    expect(sql(`SELECT count(*) FROM public.${table} WHERE direct_hire_working_session_id='${f.working}'`)).toBe('0');
  },30000);
  it('separate overlapping connections produce created/reconciled, and conflicting duplicate fails closed', async () => {
    const f=await fixture();
    // Create Formation through the real Start route, failing only snapshot insertion.
    sql(`CREATE FUNCTION public.v6_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'induced_snapshot_failure'; END $$; CREATE TRIGGER v6_test_failure BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.v6_test_failure();`);
    try { expect((await start(f)).status).toBe(500); } finally { sql(`DROP TRIGGER v6_test_failure ON public.${table}; DROP FUNCTION public.v6_test_failure();`); }
    const id=formation(f);
    const expected:PreparedContextIdentity={formationSessionId:id,businessRepresentationId:f.representation,preparationBriefId:f.briefId,hypothesisSnapshotIds:f.hypotheses.map(h=>h.id),preparationContractVersion:'first-working-session-preparation-v6',reasoningContractVersion:'test-reasoning'};
    let arrivals=0; let release!:()=>void; const gate=new Promise<void>(r=>{release=r;});
    const outcomes:string[]=[];
    const operation=(label:string)=>ensureImmutablePreparedContext({expected,load:()=>load(id),create:async()=>{
      if(++arrivals===2) release(); await gate;
      try { await asyncSql(`SET application_name='v6_race_${label}'; BEGIN; ${rpcSql(f,id)} SELECT pg_sleep(2); COMMIT;`); outcomes.push('created'); return 'created'; }
      catch(e) { expect(String(e)).toContain('formation_prepared_context_already_bound'); expect(String(e)).not.toContain('23505'); outcomes.push('already_bound'); return 'already_bound'; }
    }});
    const running=Promise.all([operation('a'),operation('b')]);
    let overlap=false;
    for(let attempt=0;attempt<40;attempt++) {
      await new Promise(r=>setTimeout(r,50));
      const active=sql("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'v6_race_%' AND state='active'");
      const blocked=sql("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'v6_race_%' AND wait_event_type='Lock'");
      if(active==='2' && Number(blocked)>0){overlap=true;break;}
    }
    expect(await running).toEqual(expect.arrayContaining(['created','reconciled'])); expect(overlap).toBe(true); expect(outcomes.sort()).toEqual(['already_bound','created']); expect(count(id)).toBe(1);
    expect(sql(`SELECT count(*) FROM public.representation_formation_sessions WHERE business_representation_id='${f.representation}'`)).toBe('1');
    await expect(ensureImmutablePreparedContext({expected:{...expected,reasoningContractVersion:'conflict'},load:()=>load(id),create:async()=>{throw new Error('unexpected');}})).rejects.toThrow('snapshot_binding_conflict');
  },30000);
});
