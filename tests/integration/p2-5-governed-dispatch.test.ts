import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';

const migration='supabase/migrations/20260820000000_p25_governed_dispatch_preparation.sql';
const route='app/api/work/missions/[missionId]/dispatch/route.ts';

describe('P2.5 governed dispatch preparation',()=>{
  it('extends the existing dispatch and worker brief architecture with frozen P2.4 lineage',async()=>{
    const sql=await readFile(migration,'utf8');
    expect(sql).toContain('ALTER TABLE public.dispatches');
    expect(sql).toContain('ALTER TABLE public.worker_briefs');
    expect(sql).not.toMatch(/CREATE TABLE public\.(?:dispatches|worker_briefs)/);
    for(const field of ['owner_id','business_representation_id','mission_id','execution_context_id','representation_version_id','mandate_outcome_package_id','lead_id','worker_role','channel','preparation_operation_id','source_fingerprint','execution_allowed'])expect(sql).toContain(`ADD COLUMN ${field}`);
    expect(sql).toContain('worker_briefs_p25_context_unique');
    expect(sql).toContain('dispatches_p25_owner_operation_unique');
  });

  it('revalidates the ready mission and every frozen source before replay or creation',async()=>{
    const sql=await readFile(migration,'utf8');
    const stale=sql.indexOf("MESSAGE='prepared mission lineage is stale'");
    const replay=sql.indexOf("RETURN QUERY SELECT v_dispatch_id,v_brief_id,true,'draft'::text,v_execution_allowed");
    for(const marker of [
      "v_mission.status<>'ready'","v_context.context_contract_version<>'operating-execution-context-v1'",
      'v_context.representation_version_id IS DISTINCT FROM v_mission.representation_version_id',
      'v_context.mandate_outcome_package_id IS DISTINCT FROM v_mission.mandate_outcome_package_id',
      'v_rep.current_version_id IS DISTINCT FROM v_mission.representation_version_id',
      'v_mission.lead_fingerprint IS DISTINCT FROM public.zeya_p24_lead_fingerprint(v_lead)',
      'v_outcome.outcome_fingerprint IS DISTINCT FROM v_mission.mandate_fingerprint',
      "v_outcome.readiness_result->>'ready'<>'true'",'zeya_direct_hire_formation_outcome_is_current',
      "extensions.digest(convert_to(v_context.context::text,'UTF8'),'sha256')",
    ])expect(sql).toContain(marker);
    expect(replay).toBeGreaterThan(stale);
  });

  it('creates exactly one draft dispatch and one immutable brief atomically and replays both',async()=>{
    const sql=await readFile(migration,'utf8');
    expect(sql.match(/INSERT INTO public\.dispatches/g)).toHaveLength(1);
    expect(sql.match(/INSERT INTO public\.worker_briefs/g)).toHaveLength(1);
    expect(sql).toContain("RETURN QUERY SELECT v_dispatch_id,v_brief_id,false,'draft'::text,v_execution_allowed");
    expect(sql).toContain("RETURN QUERY SELECT v_dispatch_id,v_brief_id,true,'draft'::text,v_execution_allowed");
    expect(sql).toContain("MESSAGE='dispatch operation conflicts'");
    expect(sql).toContain('dispatches_p25_context_unique');
    expect(sql).toContain('worker_briefs_p25_immutable');
    expect(sql).toContain('dispatches_p25_preserve');
  });

  it('builds the worker brief only from frozen context and minimal dispatch metadata',async()=>{
    const sql=await readFile(migration,'utf8');
    const brief=sql.slice(sql.indexOf("v_brief:=jsonb_build_object"),sql.indexOf('INSERT INTO public.worker_briefs'));
    for(const section of ["'who'","'what'","'why'","'desiredNextStep'","'authority'","'constraints'","'dispatch'"])expect(brief).toContain(section);
    expect(brief).toContain("v_context.context->'target'");
    expect(brief).toContain("'offer',v_offer,'audience',v_audience");
    expect(brief).not.toMatch(/whatYouSell|whoItIsFor/);
    expect(brief).not.toMatch(/hypothes|evidence|formation.*turn|reasoning|chain.of.thought/i);
  });

  it('projects the approved Representation value strings and fails missing values closed',async()=>{
    const sql=await readFile(migration,'utf8');
    expect(sql).toContain("v_context.context#>>'{representation,values,whatYouSell,value}'");
    expect(sql).toContain("v_context.context#>>'{representation,values,whoItIsFor,value}'");
    expect(sql).not.toContain("v_context.context#>>'{representation,values,whatYouSell}'");
    expect(sql).not.toContain("v_context.context#>>'{representation,values,whoItIsFor}'");
    expect(sql).not.toMatch(/Frozen Representation (?:offer|audience)/);
    expect(sql).toContain("IF v_offer IS NULL OR v_audience IS NULL THEN");
    expect(sql).toContain("MESSAGE='approved Representation values are incomplete'");
    expect(sql).toContain('v_offer,v_audience,v_brief');
    const values={whatYouSell:{value:'Business coaching and architecture services'},whoItIsFor:{value:'Our primary target is startups in English-speaking Western developed countries.'}};
    expect(values.whatYouSell.value).toBe('Business coaching and architecture services');
    expect(values.whoItIsFor.value).toBe('Our primary target is startups in English-speaking Western developed countries.');
  });

  it('preserves doNotExecute and fails every dispatch mutation closed',async()=>{
    const sql=await readFile(migration,'utf8');
    expect(sql).toContain("v_execution_allowed:=NOT coalesce((v_mission.constraints->>'doNotExecute')::boolean,false)");
    expect(sql).toContain("IF NOT OLD.execution_allowed THEN RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='dispatch execution is prohibited'");
    expect(sql).toContain("'executionAllowed',v_execution_allowed");
    expect(sql).toContain("'constraints',v_context.context->'constraints'");
    expect(sql).not.toMatch(/INSERT INTO public\.(?:dispatch_events|mission_execution_outcomes|voice_[a-z_]*|call_[a-z_]*|provider_[a-z_]*)/i);
    expect(sql).not.toMatch(/telnyx|elevenlabs/i);
    expect(sql).not.toMatch(/UPDATE public\.operating_missions/);
    expect(sql).not.toMatch(/UPDATE public\.mission_leads/);
  });

  it('blocks legacy-dispatch cloning and explicit worker/provider execution of a governed brief',async()=>{
    const [sql,dispatcher,tokenRoute,guard]=await Promise.all([
      readFile(migration,'utf8'),readFile('lib/workers/worker-dispatcher.ts','utf8'),
      readFile('app/api/elevenlabs/conversation-token/route.ts','utf8'),readFile('lib/work/governed-execution.ts','utf8'),
    ]);
    expect(sql).toContain('BEFORE INSERT OR UPDATE OR DELETE ON public.dispatches');
    expect(sql).toContain("MESSAGE='governed worker brief requires governed dispatch'");
    expect(sql).toContain("MESSAGE='governed dispatch brief lineage is incomplete'");
    expect(dispatcher.indexOf('governedWorkerBriefExecutionProhibited(brief.id)')).toBeLessThan(dispatcher.indexOf('const provider = getProvider'));
    expect(tokenRoute.indexOf('governedWorkerBriefExecutionProhibited(workerBriefId)')).toBeLessThan(tokenRoute.indexOf('fetch(`${CONVERSATION_TOKEN_ENDPOINT}'));
    expect(guard).toContain("workerBriefId.startsWith('p25_brief_')");
    expect(guard).toContain("rpc('zeya_validate_governed_execution_claim'");
  });

  it('documents static evidence that dispatch INSERT and draft rows have no automatic executor',async()=>{
    const [create,lifecycle,persistence,execution]=await Promise.all([
      readFile('supabase/migrations/20260613000000_create_dispatches.sql','utf8'),
      readFile('supabase/migrations/20260613010000_dispatch_lifecycle.sql','utf8'),
      readFile('lib/dispatch/supabase-persistence.ts','utf8'),readFile('lib/dispatch/execution.ts','utf8'),
    ]);
    const legacySql=create+'\n'+lifecycle;
    expect(legacySql).not.toMatch(/CREATE\s+(?:OR REPLACE\s+)?(?:TRIGGER|RULE)[\s\S]*?ON\s+(?:public\.)?dispatches/i);
    expect(lifecycle).toContain('update_dispatch_with_event');
    expect(persistence).toContain('export async function queueDispatchInSupabase');
    expect(execution).toContain('export async function queueDispatch');
    expect(execution).toContain('return false;');
    expect(persistence).not.toMatch(/setInterval|setTimeout|postgres_changes|subscribe\(/);
  });

  it('keeps the RPC service-role-only and the browser route owner-safe',async()=>{
    const [sql,source]=await Promise.all([readFile(migration,'utf8'),readFile(route,'utf8')]);
    expect(sql).toContain("auth.role()<>'service_role'");
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.zeya_prepare_governed_dispatch(uuid,uuid,uuid) TO service_role');
    expect(source).toContain('createAuthenticatedRepresentationContext(request)');
    expect(source).toMatch(/rpc\('zeya_prepare_governed_dispatch(?:_v[23])?'/);
    expect(source).toContain('dispatchId:row.dispatch_id,workerBriefId:row.worker_brief_id,status:row.status,executionAllowed:row.execution_allowed,replayed:row.replayed');
    expect(source).not.toMatch(/source_fingerprint|representation_version_id|mandate_outcome_package_id|lead_id/);
  });
});
