import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
const migration='supabase/migrations/20260821000000_p26_governed_execution_authorization.sql';

describe('P2.6 governed execution',()=>{
  it('adds immutable authorization and minimal execution-attempt entities with exact lineage',async()=>{
    const sql=await readFile(migration,'utf8');
    expect(sql).toContain('CREATE TABLE public.governed_execution_authorizations');
    expect(sql).toContain('CREATE TABLE public.governed_execution_attempts');
    for(const field of ['owner_id','dispatch_id','worker_brief_id','mission_id','execution_context_id','representation_version_id','mandate_outcome_package_id','lead_id','source_fingerprint'])expect(sql).toContain(field);
    expect(sql).toContain('governed_execution_authorization_preserve');
    expect(sql).toContain('governed_execution_attempt_preserve');
  });
  it('makes authorization explicit, service-only, idempotent, and provider-free',async()=>{
    const sql=await readFile(migration,'utf8');
    const authorize=sql.slice(sql.indexOf('CREATE FUNCTION public.zeya_authorize_governed_execution'),sql.indexOf('CREATE FUNCTION public.zeya_claim_governed_execution'));
    expect(authorize).toContain("p_purpose<>'controlled_preview_voice_qa'");
    expect(sql).toContain('UNIQUE(owner_id,authorization_operation_id)');
    expect(authorize).toContain("aid:=a.id; astat:=a.status; RETURN QUERY SELECT aid,true,astat");
    expect(authorize).not.toMatch(/elevenlabs|provider_call|fetch\(|voice_conversation_outputs.*INSERT/i);
    expect(sql).toContain("auth.role()<>'service_role'");
  });
  it('revalidates P2.5 lineage, current sources, fingerprints, and zero downstream artifacts',async()=>{
    const sql=await readFile(migration,'utf8');
    for(const marker of ["d.status<>'draft'","d.execution_allowed IS DISTINCT FROM false",'b.source_fingerprint=d.source_fingerprint',"m.status='ready'",
      'r.current_version_id=d.representation_version_id','m.lead_fingerprint=public.zeya_p24_lead_fingerprint(l)',
      'o.outcome_fingerprint=m.mandate_fingerprint','zeya_direct_hire_formation_outcome_is_current',
      "extensions.digest(convert_to(c.context::text,'UTF8'),'sha256')",'public.voice_conversation_outputs','public.dispatch_events','public.brief_conversation_mappings'])expect(sql).toContain(marker);
  });
  it('fails unresolved or over-broad authority closed',async()=>{
    const sql=await readFile(migration,'utf8');
    for(const rule of ["pricing,disposition}','')='owner_approval_required'","discounts,disposition}','')='owner_approval_required'",
      "negotiation,disposition}','')='prohibited'","commitments,disposition}','')='prohibited'",
      "meetingBooking,disposition}','')='allowed_within_bounds'","escalation,disposition}','')='owner_approval_required'"])expect(sql).toContain(rule);
    expect(sql).toContain("qualificationThreshold}");expect(sql).toContain("meetingObjective}");
  });
  it('claims once under a lock and makes concurrent/exact replay provider-safe',async()=>{
    const sql=await readFile(migration,'utf8');
    const claim=sql.slice(sql.indexOf('CREATE FUNCTION public.zeya_claim_governed_execution'),sql.indexOf('CREATE FUNCTION public.zeya_complete_governed_execution'));
    expect(claim).toContain('FOR UPDATE');
    expect(sql).toContain('authorization_id uuid NOT NULL UNIQUE');
    expect(sql).toContain('UNIQUE(owner_id,execution_operation_id)');
    expect(claim).toContain('target_fingerprint<>p_target_fingerprint');
    expect(claim).toContain('eid:=e.id; estat:=e.status; RETURN QUERY SELECT eid,false,true,estat');
    expect(claim).toContain("SET status='consumed'");
  });
  it('keeps the QA phone transient and stores only its fingerprint',async()=>{
    const [sql,service,route]=await Promise.all([readFile(migration,'utf8'),readFile('lib/work/governed-voice-execution.ts','utf8'),readFile('app/api/work/dispatches/[dispatchId]/execute/route.ts','utf8')]);
    expect(sql).toContain('target_fingerprint');expect(sql).not.toMatch(/target_phone|qa_phone|phone_number/);
    expect(service).toContain("createHash('sha256').update(input.qaPhone)");
    expect(service).toContain('transientTargetPhone:input.qaPhone');
    expect(route).toContain("const E164=/^\\+[1-9]\\d{7,14}$/");
  });
  it('requires a valid claim at worker and token provider boundaries',async()=>{
    const [guard,dispatcher,token]=await Promise.all([readFile('lib/work/governed-execution.ts','utf8'),readFile('lib/workers/worker-dispatcher.ts','utf8'),readFile('app/api/elevenlabs/conversation-token/route.ts','utf8')]);
    expect(guard).toContain("rpc('zeya_validate_governed_execution_claim'");
    expect(dispatcher.indexOf('governedWorkerBriefExecutionProhibited')).toBeLessThan(dispatcher.indexOf('const provider = getProvider'));
    expect(token).toContain('authorizationId');expect(token).toContain('attemptId');
    expect(token.indexOf('governedWorkerBriefExecutionProhibited')).toBeLessThan(token.indexOf('fetch(`${CONVERSATION_TOKEN_ENDPOINT}'));
  });
  it('builds speech-safe variables without raw Formation internals',async()=>{
    const service=await readFile('lib/work/governed-voice-execution.ts','utf8');
    for(const key of ['offer','audience','missionObjective','qualificationGoal','desiredNextStep','authority'])expect(service).toContain(key);
    expect(service).not.toMatch(/hypothes|evidence|formation.*turn|chain.of.thought|reasoning/i);
  });
  it('does not mutate mission, dispatch, lead, mandate, or canonical state',async()=>{
    const sql=await readFile(migration,'utf8');
    expect(sql).not.toMatch(/UPDATE public\.(?:dispatches|operating_missions|mission_leads|business_representations|representation_versions|direct_hire_formation_outcome_packages)/);
    expect(sql).not.toMatch(/INSERT INTO public\.(?:mission_execution_outcomes|voice_conversation_outputs|call_outcomes)/);
  });
  it('conversation-token route blocks p25_brief_* even when authorization/attempt supplied',async()=>{
    const route=await readFile('app/api/elevenlabs/conversation-token/route.ts','utf8');
    expect(route).toContain('p25_brief_');
    expect(route).toContain('status: 409');
    expect(route).toContain('server-side execution');
    expect(route.indexOf('p25_brief_')).toBeLessThan(route.indexOf('authorizationId'));
  });
  it('conversation-token non-governed briefs pass through unchanged',async()=>{
    const route=await readFile('app/api/elevenlabs/conversation-token/route.ts','utf8');
    expect(route).toContain('NEXT_PUBLIC_ELEVENLABS_AGENT_ID');
    expect(route).toContain('fetch');
    expect(route).toContain('CONVERSATION_TOKEN_ENDPOINT');
    expect(route).toContain('Governed briefs never use this public token route');
  });
  it('authorization alone cannot create attempts or voice artifacts',async()=>{
    const [service,sql]=await Promise.all([readFile('app/api/work/dispatches/[dispatchId]/authorize/route.ts','utf8'),readFile(migration,'utf8')]);
    expect(service).toContain('zeya_authorize_governed_execution');
    expect(service).not.toContain('zeya_claim_governed_execution');
    expect(service).not.toContain('dispatchWorkerBrief');
    expect(service).not.toContain('voice_conversation_outputs');
    const authorize=sql.slice(sql.indexOf('CREATE FUNCTION public.zeya_authorize_governed_execution'),sql.indexOf('CREATE FUNCTION public.zeya_claim_governed_execution'));
    expect(authorize).toContain('INSERT INTO public.governed_execution_authorizations');
    expect(authorize).not.toContain('INSERT INTO public.governed_execution_attempts');
  });
  it('consumed authorization cannot be claimed by different execution operation',async()=>{
    const sql=await readFile(migration,'utf8');
    const claim=sql.slice(sql.indexOf('CREATE FUNCTION public.zeya_claim_governed_execution'),sql.indexOf('CREATE FUNCTION public.zeya_complete_governed_execution'));
    expect(sql).toContain("UPDATE public.governed_execution_authorizations x SET status='consumed'");
    expect(claim).toContain("IF a.status<>'authorized'");
    expect(claim).toContain('authorization is not usable');
  });
  it('replay of claimed attempt never invokes provider again',async()=>{
    const service=await readFile('lib/work/governed-voice-execution.ts','utf8');
    expect(service).toContain('if(!row.claimed)');
    expect(service).toContain('replayed:true');
    expect(service).toContain('return {attemptId');
    const replaySection=service.slice(service.indexOf('if(!row.claimed)'),service.indexOf('const dispatch='));
    expect(replaySection).toContain('return');
    expect(replaySection).not.toContain('dispatchWorkerBrief');
  });
  it('at-most-once claim boundary documented',async()=>{
    const service=await readFile('lib/work/governed-voice-execution.ts','utf8');
    expect(service).toContain('At-most-once');
    expect(service).toContain('claim commits');
    expect(service).toContain('claimed state');
    expect(service).toContain('operator review');
  });
  it('governed execution fetches business_id from worker_briefs not dispatches',async()=>{
    const service=await readFile('lib/work/governed-voice-execution.ts','utf8');
    expect(service).toContain("from('dispatches').select('worker_brief_id,mission_id,business_representation_id,representation_version_id,execution_context_id,mandate_outcome_package_id')");
    expect(service).not.toMatch(/from\('dispatches'\)\.select\([^)]*business_id/);
    expect(service).toContain("from('worker_briefs').select('id,business_id");
  });
  it('governed execution validates complete brief/dispatch lineage',async()=>{
    const service=await readFile('lib/work/governed-voice-execution.ts','utf8');
    expect(service).toContain('operating_mission_id');
    expect(service).toContain('business_representation_id');
    expect(service).toContain('representation_version_id');
    expect(service).toContain('execution_context_id');
    expect(service).toContain('mandate_outcome_package_id');
    expect(service).toContain('execution_lineage_mismatch');
  });
  it('governed execution requires brief.business_id',async()=>{
    const service=await readFile('lib/work/governed-voice-execution.ts','utf8');
    expect(service).toContain('!brief.data.business_id');
    expect(service).toContain('execution_source_unavailable');
  });
  it('dispatchWorkerBrief receives business_id from brief not dispatch',async()=>{
    const service=await readFile('lib/work/governed-voice-execution.ts','utf8');
    expect(service).toContain('String(brief.data.business_id),{');
    expect(service).not.toContain('String(dispatch.data.business_id)');
  });
  it('worker dispatcher has diagnostic stages for all pre-provider branches',async()=>{
    const dispatcher=await readFile('lib/workers/worker-dispatcher.ts','utf8');
    expect(dispatcher).toContain('stage: governed_guard_start');
    expect(dispatcher).toContain('stage: governed_guard_passed');
    expect(dispatcher).toContain('stage: governed_guard_rejected');
    expect(dispatcher).toContain('stage: service_client_ready');
    expect(dispatcher).toContain('stage: business_owner_lookup_start');
    expect(dispatcher).toContain('stage: business_owner_lookup_failed');
    expect(dispatcher).toContain('stage: business_owner_lookup_passed');
    expect(dispatcher).toContain('stage: voice_context_start');
    expect(dispatcher).toContain('stage: voice_context_ready');
    expect(dispatcher).toContain('stage: voice_context_failed');
    expect(dispatcher).toContain('stage: mapping_start');
    expect(dispatcher).toContain('stage: mapping_ready');
    expect(dispatcher).toContain('stage: mapping_failed');
    expect(dispatcher).toContain('stage: lineage_start');
    expect(dispatcher).toContain('stage: lineage_ready');
    expect(dispatcher).toContain('stage: lineage_failed');
    expect(dispatcher).toContain('stage: provider_boundary');
  });
  it('governed claim validation uses correct PostgREST scalar return pattern',async()=>{
    const guard=await readFile('lib/work/governed-execution.ts','utf8');
    expect(guard).toContain('validation.data===true');
    expect(guard).not.toContain('validation.data!==true');
  });
  it('diagnostics never log QA phone or credentials',async()=>{
    const [dispatcher,execute,governance]=await Promise.all([readFile('lib/workers/worker-dispatcher.ts','utf8'),readFile('app/api/work/dispatches/[dispatchId]/execute/route.ts','utf8'),readFile('lib/work/governed-voice-execution.ts','utf8')]);
    for(const file of[dispatcher,execute,governance]){
      expect(file).not.toMatch(/console\.log\([^)]*qaPhone/);
      expect(file).not.toMatch(/console\.log\([^)]*phone[^)]*\).*update/);
      expect(file).not.toMatch(/ELEVENLABS_API_KEY.*console\.log/);
      expect(file).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY.*console\.log/);
    }
  });
});
