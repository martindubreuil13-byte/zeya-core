import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { ownerSafeLead,ownerSafeMission } from '../../lib/work/operating-spine';

const migration='supabase/migrations/20260819000000_p24_operating_spine.sql';
describe('P2.4 operating spine',()=>{
  it('reuses leads and adds the minimum durable mission, context, and outcome model',async()=>{
    const sql=await readFile(migration,'utf8');
    expect(sql).toContain('ALTER TABLE public.mission_leads');
    for(const table of ['operating_missions','mission_execution_contexts','mission_execution_outcomes'])expect(sql).toContain(`CREATE TABLE public.${table}`);
    expect(sql).not.toMatch(/CREATE TABLE public\.(?:contacts|accounts|companies|opportunities|campaigns)/i);
  });
  it('binds exact current Representation and current governed mandate and fails stale preparation closed',async()=>{
    const sql=await readFile(migration,'utf8');
    for(const marker of ['representation_version_id uuid NOT NULL','mandate_outcome_package_id uuid NOT NULL','v_rep.current_version_id','zeya_direct_hire_formation_outcome_is_current','v_mission.lead_fingerprint IS DISTINCT FROM public.zeya_p24_lead_fingerprint(v_lead)','v_mission.mandate_fingerprint IS DISTINCT FROM v_outcome.outcome_fingerprint',"MESSAGE='mission source lineage is stale'"])expect(sql).toContain(marker);
  });
  it('revalidates every frozen source before returning an existing prepared context',async()=>{
    const sql=await readFile(migration,'utf8');
    const prepare=sql.slice(sql.indexOf('CREATE FUNCTION public.zeya_prepare_operating_mission'),sql.indexOf('CREATE FUNCTION public.zeya_p24_immutable_execution_context'));
    const replay=prepare.indexOf("RETURN QUERY SELECT v_mission.id,v_stored.id,true,'ready'::text,v_stored.context");
    expect(replay).toBeGreaterThan(prepare.indexOf('v_rep.current_version_id IS DISTINCT FROM v_mission.representation_version_id'));
    expect(replay).toBeGreaterThan(prepare.indexOf('v_mission.lead_fingerprint IS DISTINCT FROM public.zeya_p24_lead_fingerprint(v_lead)'));
    expect(replay).toBeGreaterThan(prepare.indexOf('v_mission.mandate_fingerprint IS DISTINCT FROM v_outcome.outcome_fingerprint'));
    expect(replay).toBeGreaterThan(prepare.indexOf("v_outcome.readiness_result->>'ready'<>'true'"));
    expect(replay).toBeGreaterThan(prepare.indexOf('NOT public.zeya_direct_hire_formation_outcome_is_current(p_owner_id,v_outcome.id)'));
    expect(prepare.indexOf('SELECT * INTO v_stored')).toBeGreaterThan(prepare.indexOf("MESSAGE='mission source lineage is stale'"));
  });
  it('replays only the same immutable context with complete frozen lineage',async()=>{
    const sql=await readFile(migration,'utf8');
    const prepare=sql.slice(sql.indexOf('CREATE FUNCTION public.zeya_prepare_operating_mission'),sql.indexOf('CREATE FUNCTION public.zeya_p24_immutable_execution_context'));
    for(const marker of ["v_mission.status<>'ready'",'v_stored.owner_id<>p_owner_id','v_stored.business_representation_id<>v_mission.business_representation_id','v_stored.representation_version_id<>v_mission.representation_version_id','v_stored.mandate_outcome_package_id<>v_mission.mandate_outcome_package_id',"MESSAGE='prepared context lineage is incomplete'"])expect(prepare).toContain(marker);
    expect(prepare).not.toMatch(/(?:UPDATE|DELETE FROM) public\.mission_execution_contexts/);
    expect(prepare.match(/INSERT INTO public\.mission_execution_contexts/g)).toHaveLength(1);
  });
  it('creates a deterministic owner-safe execution projection without raw internals',async()=>{
    const sql=await readFile(migration,'utf8');
    for(const section of ["'target'","'representation'","'mission'","'mandate'","'constraints'"])expect(sql).toContain(section);
    expect(sql).toContain("'versionId',v_version.id,'values',v_version.element_values");
    expect(sql).not.toMatch(/'sourceDecisionId'|'sourceEvidenceIds'|'sourceHypothesisIds'|'decisions'/);
    expect(sql).toContain("'disposition',v_outcome.outcome#>>'{authority,authority_pricing,disposition}'");
    expect(sql).toContain("extensions.digest(convert_to(v_context::text,'UTF8'),'sha256')");
  });
  it('keeps the descriptive Representation separate from operational mandate',async()=>{
    const sql=await readFile(migration,'utf8');
    const representation=sql.slice(sql.indexOf("'representation',jsonb_build_object"),sql.indexOf("'mission',jsonb_build_object"));
    expect(representation).toContain('v_version.element_values');
    expect(representation).not.toMatch(/authority|qualification|meeting|pricing|objective/i);
  });
  it('is tenant isolated, idempotent, immutable where required, and never dispatches work',async()=>{
    const sql=await readFile(migration,'utf8');
    expect(sql).toContain("auth.role()<>'service_role'");
    expect(sql).toContain('owner_id=auth.uid()');
    expect(sql).toContain('FOREIGN KEY (lead_id,business_representation_id)');
    expect(sql).toContain('FOREIGN KEY (representation_version_id,business_representation_id)');
    expect(sql).toContain('FOREIGN KEY (mandate_outcome_package_id,owner_id,business_representation_id)');
    expect(sql).toContain('UNIQUE(owner_id,creation_operation_id)');
    expect(sql).toContain("MESSAGE='lead operation conflicts'");
    expect(sql).toContain("MESSAGE='mission operation conflicts'");
    expect(sql).toContain('mission_execution_contexts_immutable');
    expect(sql).toContain('operating_missions_source_immutable');
    expect(sql).not.toMatch(/INSERT INTO public\.(?:dispatches|worker_briefs|voice_|call_jobs)|telnyx|elevenlabs/i);
    expect(sql).not.toMatch(/UPDATE public\.representation_formation_sessions/i);
  });
  it('makes mission itself the minimal work item and defines the future result boundary',async()=>{
    const sql=await readFile(migration,'utf8');
    for(const state of ['draft','ready','in_progress','completed','failed','deferred','cancelled'])expect(sql).toContain(`'${state}'`);
    for(const field of ['contact_result','qualification_result','meeting_result','owner_escalation_required','follow_up_required','summary','next_action','source_conversation_id','source_job_id'])expect(sql).toContain(field);
    expect(sql).toContain("UPDATE public.operating_missions SET status='ready'");
    expect(sql.match(/UPDATE public\.operating_missions SET status=/g)).toHaveLength(1);
    expect(sql).not.toMatch(/INSERT INTO public\.mission_execution_outcomes/);
  });
  it('exposes only authenticated owner-safe APIs',async()=>{
    const paths=['app/api/work/leads/route.ts','app/api/work/missions/route.ts','app/api/work/missions/[missionId]/route.ts','app/api/work/missions/[missionId]/prepare/route.ts'];
    for(const path of paths)expect(await readFile(path,'utf8')).toContain('createAuthenticatedRepresentationContext');
    expect(ownerSafeLead({id:'l',company_name:'Acme',contact_name:'A',phone:'1',email:null,source:'manual',status:'new',notes:null,created_at:'now'})).not.toHaveProperty('business_representation_id');
    expect(ownerSafeMission({id:'m',lead_id:'l',representation_version_id:'v',objective:'Qualify',qualification_goal:'Need',desired_next_step:'Meeting',allowed_channel:'phone',constraints:{},notes:null,priority:'normal',status:'draft',created_at:'now'})).not.toHaveProperty('mandate_outcome_package_id');
  });
});
