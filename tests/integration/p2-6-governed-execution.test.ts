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
  it('governed frozen voice context mode exists and is registered',async()=>{
    const voiceContext=await readFile('lib/voice/representation-context.ts','utf8');
    expect(voiceContext).toContain('representationContextMode: "canonical" | "pre_canonical" | "governed_frozen"');
    expect(voiceContext).toContain('assembleGovernedFrozenVoiceContext');
    expect(voiceContext).toContain('GOVERNED_VOICE_ALLOWLIST');
  });
  it('worker dispatcher imports and uses governed frozen context',async()=>{
    const dispatcher=await readFile('lib/workers/worker-dispatcher.ts','utf8');
    expect(dispatcher).toContain('assembleGovernedFrozenVoiceContext');
    expect(dispatcher).toContain('options.governedExecutionClaim && options.representationSnapshot?.canonicalVersionId');
  });
  it('governed frozen context exposes only speech-safe fields',async()=>{
    const voiceContext=await readFile('lib/voice/representation-context.ts','utf8');
    expect(voiceContext).toContain('GOVERNED_VOICE_ALLOWLIST');
    expect(voiceContext).toContain('whatYouSell');
    expect(voiceContext).toContain('whoItIsFor');
    const governedFunc=voiceContext.slice(voiceContext.indexOf('assembleGovernedFrozenVoiceContext'));
    expect(governedFunc).not.toMatch(/claims\[key\].*hypothesis|claims\[key\].*evidence/i);
  });
  it('governed frozen context verifies Version currentness',async()=>{
    const voiceContext=await readFile('lib/voice/representation-context.ts','utf8');
    const governedFunc=voiceContext.slice(voiceContext.indexOf('assembleGovernedFrozenVoiceContext'));
    expect(governedFunc).toContain('current_version_id !== input.canonicalVersionId');
  });
  it('governed voice allowlist is MVP narrow (whatYouSell, whoItIsFor only)',async()=>{
    const voiceContext=await readFile('lib/voice/representation-context.ts','utf8');
    expect(voiceContext).toContain('GOVERNED_VOICE_ALLOWLIST = ["whatYouSell", "whoItIsFor"]');
    expect(voiceContext).not.toContain('worksHowSteps');
    expect(voiceContext).not.toContain('whatSuccess');
  });
  it('P2.6 governed execution explicitly selects governed_frozen mode',async()=>{
    const service=await readFile('lib/work/governed-voice-execution.ts','utf8');
    expect(service).toContain("representationContextMode:'governed_frozen'");
  });
  it('error categories distinguish governance/voice/mapping/lineage from provider',async()=>{
    const types=await readFile('lib/workers/worker-brief-types.ts','utf8');
    expect(types).toContain('governance_rejected');
    expect(types).toContain('voice_context_failed');
    expect(types).toContain('mapping_failed');
    expect(types).toContain('lineage_failed');
    expect(types).toContain('provider_failed');
  });
  it('QA harness exists with Stage A and Stage B',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    expect(harness).toContain('stage: \'a\' | \'b\'');
    expect(harness).toContain('stageA');
    expect(harness).toContain('stageB');
    expect(harness).toContain('SYNTHETIC_LEAD_ID');
    expect(harness).not.toMatch(/console\.log\([^)]*qaPhone/);
  });
  it('failure categories are typed not string-matched',async()=>{
    const types=await readFile('lib/workers/worker-brief-types.ts','utf8');
    expect(types).toContain('WorkerDispatchFailureCategory');
    expect(types).toContain('governance_rejected');
    expect(types).toContain('voice_context_failed');
    expect(types).toContain('mapping_failed');
    expect(types).toContain('lineage_failed');
    expect(types).toContain('provider_failed');
  });
  it('worker-dispatcher sets explicit failure categories',async()=>{
    const dispatcher=await readFile('lib/workers/worker-dispatcher.ts','utf8');
    expect(dispatcher).toContain('failureResult(brief,');
    expect(dispatcher).toContain('"governance_rejected"');
    expect(dispatcher).toContain('"voice_context_failed"');
    expect(dispatcher).toContain('"mapping_failed"');
    expect(dispatcher).toContain('"lineage_failed"');
    expect(dispatcher).not.toMatch(/result\.message\.includes/);
  });
  it('executeGovernedVoice uses typed failureCategory not message inspection',async()=>{
    const service=await readFile('lib/work/governed-voice-execution.ts','utf8');
    expect(service).toContain('result.failureCategory');
    expect(service.match(/result\.message\.includes/)).toBe(null);
  });
  it('QA harness uses explicit --stage-a and --stage-b arguments',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    expect(harness).toContain('--stage-a');
    expect(harness).toContain('--stage-b');
  });
  it('QA harness validates Preview URL strictly (Vercel pattern only)',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    expect(harness).toContain('validatePreviewUrlStrict');
    // Verify the strict regex pattern is present (escaped dots literal check)
    expect(harness).toContain('zeya-core-wh6u-[a-z0-9-]+-martindubreuil13-bytes-projects\\.vercel\\.app');
    // Verify it rejects unsafe hosts
    expect(harness).toContain('Unsafe Preview host');
  });
  it('provider_failed only appears after provider boundary',async()=>{
    const dispatcher=await readFile('lib/workers/worker-dispatcher.ts','utf8');
    const providerBoundary=dispatcher.indexOf('provider_boundary');
    expect(providerBoundary).toBeGreaterThan(-1);
    const providerFailedBefore=dispatcher.substring(0,providerBoundary).includes('provider_failed');
    expect(providerFailedBefore).toBe(false);
  });
  it('QA harness uses Supabase signInWithPassword authentication',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    expect(harness).toContain('signInWithPassword');
    expect(harness).toContain('Bearer');
    expect(harness).not.toContain('/api/auth/callback/credentials');
  });
  it('QA harness uses correct API response field names',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    // Mission response uses .id not .missionId
    expect(harness).toContain('missionData.data?.id');
    // Dispatch response uses .dispatchId
    expect(harness).toContain('dispatchData.data?.dispatchId');
    // Authorization response uses .authorizationId
    expect(harness).toContain('authData.data?.authorizationId');
  });
  it('QA harness includes full mission request payload',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    expect(harness).toContain('objective:');
    expect(harness).toContain('qualificationGoal:');
    expect(harness).toContain('desiredNextStep:');
    expect(harness).toContain('channel:');
    expect(harness).toContain('constraints:');
  });
  it('QA harness implements Stage A verification',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    expect(harness).toContain('STAGE A: Authorization-Only Verification');
    expect(harness).toContain('Authorization-only verification');
  });
  it('QA harness implements Stage B durable postcheck',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    expect(harness).toContain('STAGE B: Full Execution with Durable Postcheck');
    expect(harness).toContain('Durable State Postcheck');
    expect(harness).toContain('Sanitized result:');
  });
  it('QA harness never prints QA_PHONE in output',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    // Check that error messages don't contain the phone variable
    expect(harness).toContain('Invalid QA phone format');
    // Verify no console.log of config.qaPhone
    const phoneLogsMatch=harness.match(/console\.log\([^)]*qaPhone/g);
    expect(phoneLogsMatch).toBe(null);
    // Verify no error throwing with phone in message
    const errorWithPhone=harness.match(/throw new Error\(`.*\$\{.*qaPhone/g);
    expect(errorWithPhone).toBe(null);
  });
  it('QA harness uses npx tsx runtime',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    expect(harness).toContain('#!/usr/bin/env npx tsx');
  });
  it('QA harness uses --stage-a and --stage-b CLI arguments',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    expect(harness).toContain('--stage-a');
    expect(harness).toContain('--stage-b');
  });
  it('mission response maps .id to missionId correctly',async()=>{
    const harness=await readFile('scripts/p26-controlled-qa.ts','utf8');
    expect(harness).toContain('.id');
    // Verify the pattern for extracting missionId from response
    expect(harness).toMatch(/missionData\.data\?.id/);
  });

  // P2.7 — Governed Conversation Outcome Capture Tests
  it('P2.7: webhook processor recognizes P2.6 governed execution',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    expect(processor).toContain('processGovernedExecutionOutcome');
    expect(processor).toContain('isGovernedExecution');
    expect(processor).toContain('governed_execution_attempts');
  });
  it('P2.7: P2.6 route routes through captureAndExtractConversationOutput',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    expect(processor).toContain('captureAndExtractConversationOutput');
    // Verify function exists in P2.7 path
    const beforeP27=processor.indexOf('processGovernedExecutionOutcome');
    const endP27=processor.indexOf('async function',beforeP27+100);
    const p27Code=processor.substring(beforeP27,endP27);
    expect(p27Code).toContain('captureAndExtractConversationOutput');
  });
  it('P2.7: no canonical mutation path exists in P2.6 outcome processing',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    // Verify P2.7 function exists and does NOT call representation/canonical mutations
    expect(processor).toContain('processGovernedExecutionOutcome');
    // These mutations should NOT appear anywhere in the P2.7 path
    const beforeP27=processor.indexOf('processGovernedExecutionOutcome');
    const afterP27=processor.lastIndexOf('}',beforeP27+5000);
    const p27Code=processor.substring(beforeP27,afterP27);
    expect(p27Code).not.toContain('representation_versions');
    expect(p27Code).not.toContain('current_version_id');
    expect(p27Code).not.toContain('zeya_complete_public_experience_call');
  });
  it('P2.7: uses typed outcome status not string inference',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    expect(processor).toContain('zeya_complete_governed_execution');
    expect(processor).toContain('p_status');
  });
  it('P2.7: conversation output capture uses existing immutable service',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    expect(processor).toContain('captureAndExtractConversationOutput');
    expect(processor).toContain('finalized');
    expect(processor).toContain('provider_callback');
  });
  it('P2.7: idempotency based on attempt status not receipt',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    expect(processor).toContain('attempt.data.status');
    expect(processor).toContain('"claimed"');
  });
  it('P2.7: non-completed outcomes recorded as failed',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    expect(processor).toContain('event.outcome');
    expect(processor).toContain('"completed"');
  });
  it('P2.7: public experience regression prevention',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    expect(processor).toContain('if(isGovernedExecution)');
    expect(processor).toContain('return await processGovernedExecutionOutcome');
    // Verify public experience path still exists
    expect(processor).toContain('public_experience_sessions');
    expect(processor).toContain('zeya_complete_public_experience_call');
  });
  it('P2.7: lineage resolution exact before routing',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    expect(processor).toContain('voice_representation_lineage');
    expect(processor).toContain('provider_call_id');
    expect(processor).toContain('conversation_id');
  });
  it('P2.7: ASR confidence preserved without fabrication',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    expect(processor).toContain('event.transcript');
    // P2.7 section should NOT fabricate confidence scores
    const beforeP27=processor.indexOf('processGovernedExecutionOutcome');
    const endP27=processor.indexOf('async function',beforeP27+100);
    const p27Code=processor.substring(beforeP27,endP27);
    expect(p27Code).not.toContain('confidence:');
  });
  it('P2.7: provider metadata sanitized for safe storage',async()=>{
    const processor=await readFile('lib/voice/events/elevenlabs-event-processor.ts','utf8');
    expect(processor).toContain('safeMetadata');
    expect(processor).toContain('providerCredits');
    expect(processor).toContain('providerEvaluation');
  });
});
