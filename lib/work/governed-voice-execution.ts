import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { dispatchWorkerBrief } from '@/lib/workers/worker-dispatcher';
import type { WorkerBrief } from '@/lib/workers/worker-brief-types';
import { buildSpeechSafeProspectContext,type ProspectContextV1 } from '@/lib/work/prospect-memory';
import { buildGovernedCommercialOpening,buildSpeechSafeAuthorityGuidance,commercialConversationPolicyGuidance,dispatchedWorkerIdentityMatches,GOVERNED_PROSPECT_CONVERSATION_MODE,parseDispatchedWorkerIdentity,resolveDispatchedWorkerIdentity } from '@/lib/work/commercial-conversation-policy';

type ExecuteInput={db:SupabaseClient;ownerId:string;dispatchId:string;authorizationId:string;operationId:string;qaPhone:string};
const text=(value:unknown)=>typeof value==='string'?value:'';
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

export async function executeGovernedVoice(input:ExecuteInput){
  // Resolve and verify every frozen source before consuming authorization. A
  // provider configuration drift is therefore a safe pre-provider rejection.
  console.log('[p26-execute] stage: dispatch_load_start', { dispatchId: input.dispatchId });
  const dispatchSource=await input.db.from('dispatches').select('worker_brief_id,mission_id,business_representation_id,representation_version_id,execution_context_id,mandate_outcome_package_id').eq('dispatch_id',input.dispatchId).eq('owner_id',input.ownerId).single();
  if(dispatchSource.error)throw new Error(`dispatch_load_failed:${dispatchSource.error.code??'unknown'}`);
  console.log('[p26-execute] stage: brief_load_start', { workerBriefId: dispatchSource.data?.worker_brief_id });
  const brief=dispatchSource.data&&await input.db.from('worker_briefs').select('id,business_id,brief_payload,objective,desired_outcome,company_context,lead_context,operating_mission_id,business_representation_id,representation_version_id,execution_context_id,mandate_outcome_package_id').eq('id',dispatchSource.data.worker_brief_id).eq('owner_id',input.ownerId).single();
  if(!dispatchSource.data||!brief||brief.error||!brief.data||!brief.data.business_id)throw new Error('execution_source_unavailable');
  if(brief.data.operating_mission_id!==dispatchSource.data.mission_id||brief.data.business_representation_id!==dispatchSource.data.business_representation_id||brief.data.representation_version_id!==dispatchSource.data.representation_version_id||brief.data.execution_context_id!==dispatchSource.data.execution_context_id||brief.data.mandate_outcome_package_id!==dispatchSource.data.mandate_outcome_package_id)throw new Error('execution_lineage_mismatch');
  const payload=object(brief.data.brief_payload);
  const frozenWorker=parseDispatchedWorkerIdentity(payload.worker);
  if(payload.contractVersion==='governed-worker-brief-v3'&&(!frozenWorker||!dispatchedWorkerIdentityMatches(frozenWorker,resolveDispatchedWorkerIdentity())))throw new Error('execution_worker_configuration_stale');

  // At-most-once execution boundary: claim commits authorization=consumed and attempt=claimed
  // before provider invocation. If process crashes after claim but before completion,
  // the attempt remains in claimed state (uncertain). No automatic retry/timeout; operator review required.
  console.log('[p26-execute] stage: claim_requested', { dispatchId: input.dispatchId, operationId: input.operationId });
  const claim=await input.db.rpc('zeya_claim_governed_execution',{
    p_owner_id:input.ownerId,p_dispatch_id:input.dispatchId,p_authorization_id:input.authorizationId,p_operation_id:input.operationId,
    p_target_fingerprint:createHash('sha256').update(input.qaPhone).digest('hex'),
  });
  if(claim.error)throw new Error(`execution_claim_failed:${claim.error.code??'unknown'}`);
  const row=claim.data?.[0];if(!row)throw new Error('execution_claim_failed:empty');
  console.log('[p26-execute] stage: claim_complete', { attemptId: row.attempt_id, claimed: row.claimed });
  if(!row.claimed){const stored=await input.db.from('governed_execution_attempts').select('provider_call_id,conversation_id').eq('id',row.attempt_id).eq('owner_id',input.ownerId).single();
    return {attemptId:row.attempt_id,status:row.status,replayed:true,providerCallId:stored.data?.provider_call_id??null,conversationId:stored.data?.conversation_id??null};}

  const dispatch=dispatchSource;
  console.log('[p26-execute] stage: payload_projection_start', { briefId: brief.data.id, businessId: brief.data.business_id });
  const prospect=object(payload.prospect),who=Object.keys(prospect).length?object(prospect.identity):object(payload.who),business=object(payload.business),representation=object(business.representation),what=Object.keys(representation).length?representation:object(payload.what),mission=object(payload.mission),why=Object.keys(mission).length?mission:object(payload.why),authority=object(payload.authority);
  const frozenProspectContext=object(prospect.context) as ProspectContextV1;
  const prospectGuidance=frozenProspectContext.schemaVersion==='prospect-context-v1'?buildSpeechSafeProspectContext(frozenProspectContext):'';
  const capabilities=object(payload.capabilities);
  const currentFacts=Array.isArray(frozenProspectContext.currentFacts)?frozenProspectContext.currentFacts:[];
  const obligations=Array.isArray(frozenProspectContext.obligations)?frozenProspectContext.obligations:[];
  const priorPain=currentFacts.find(fact=>fact&&typeof fact==='object'&&text(object(fact).slot).includes('pain'));
  const opening=frozenWorker?buildGovernedCommercialOpening({
    spokenName:frozenWorker.spokenName,prospectName:text(who.contactName)||text(who.companyName),offer:text(what.offer),audience:text(what.audience),
    relationshipState:frozenProspectContext.relationshipState??'first_contact',priorPain:priorPain?text(object(priorPain).summary):null,
    callbackRequested:obligations.some(obligation=>text(object(obligation).kind)==='callback'&&object(obligation).requestedByProspect===true),
  }):text(why.objective);
  const now=new Date().toISOString();
  const workerBrief:WorkerBrief={
    id:brief.data.id,missionId:String(dispatch.data.mission_id),workerType:'CALLER',workerName:frozenWorker?.spokenName??'Caller',status:'READY',
    companyContext:text(what.offer),leadContext:`Audience: ${text(what.audience)}. Target: ${text(who.companyName)||text(who.contactName)}.`,
    objective:text(why.objective)||brief.data.objective,desiredOutcome:text(payload.desiredNextStep)||brief.data.desired_outcome,
    keyQuestions:[],objectionGuidance:[],escalationRules:['Follow the governed authority dispositions; unresolved means no permission.'],
    successCriteria:'Apply the qualification threshold and pursue only the governed meeting objective.',
    toneGuidance:'Professional, warm, concise, and truthful.',
    dynamicVariables:{target:text(who.contactName)||text(who.companyName),company:text(who.companyName),offer:text(what.offer),audience:text(what.audience),
      missionObjective:text(why.objective),qualificationGoal:text(why.qualificationGoal),desiredNextStep:text(mission.desiredNextStep)||text(payload.desiredNextStep),authority:buildSpeechSafeAuthorityGuidance(authority),
      relationshipState:frozenProspectContext.relationshipState??'first_contact',prospectContext:prospectGuidance,
      spokenWorkerIdentity:frozenWorker?.spokenName??'Caller',conversationMode:GOVERNED_PROSPECT_CONVERSATION_MODE,opening,
      capabilities:JSON.stringify({scheduling:capabilities.scheduling===true,email:capabilities.email===true,reminders:capabilities.reminders===true}),
      conversationPolicy:commercialConversationPolicyGuidance()},
    createdAt:now,updatedAt:now,
  };
  console.log('[p26-execute] stage: worker_dispatch_start', { briefId: workerBrief.id, businessId: brief.data.business_id });
  const result=await dispatchWorkerBrief(workerBrief,'ELEVENLABS',String(brief.data.business_id),{
    transientTargetPhone:input.qaPhone,governedExecutionClaim:{authorizationId:input.authorizationId,attemptId:row.attempt_id},
    representationSnapshot:{tenantUserId:input.ownerId,businessRepresentationId:String(dispatch.data.business_representation_id),canonicalVersionId:String(dispatch.data.representation_version_id),representationContextMode:'governed_frozen'},
  });
  console.log('[p26-execute] stage: worker_dispatch_complete', { dispatchStatus: result.status, dispatchOutcome: result.providerOutcome });
  const dispatched=result.status==='DISPATCHED';
  console.log('[p26-execute] stage: completion_rpc_start', { attemptId: row.attempt_id, markAs: dispatched?'dispatched':'failed' });
  // Use typed failureCategory from dispatchWorkerBrief (not message inspection)
  const errorCode=dispatched?null:(result.failureCategory??'provider_failed');
  const completed=await input.db.rpc('zeya_complete_governed_execution',{
    p_owner_id:input.ownerId,p_attempt_id:row.attempt_id,p_status:dispatched?'dispatched':'failed',
    p_provider_call_id:result.providerCallId??null,p_conversation_id:result.conversationId??null,p_error_code:errorCode,
  });
  if(completed.error){console.error('[p26-execute] stage: completion_rpc_failed', { code: completed.error.code, message: completed.error.message });throw new Error(`execution_completion_failed:${completed.error.code??'unknown'}`);}
  console.log('[p26-execute] stage: completion_rpc_complete', { attemptId: row.attempt_id });
  return {attemptId:row.attempt_id,status:dispatched?'dispatched':'failed',replayed:false,providerCallId:result.providerCallId??null,conversationId:result.conversationId??null};
}
