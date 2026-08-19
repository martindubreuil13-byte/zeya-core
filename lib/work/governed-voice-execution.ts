import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { dispatchWorkerBrief } from '@/lib/workers/worker-dispatcher';
import type { WorkerBrief } from '@/lib/workers/worker-brief-types';

type ExecuteInput={db:SupabaseClient;ownerId:string;dispatchId:string;authorizationId:string;operationId:string;qaPhone:string};
const text=(value:unknown)=>typeof value==='string'?value:'';
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

export async function executeGovernedVoice(input:ExecuteInput){
  // At-most-once execution boundary: claim commits authorization=consumed and attempt=claimed
  // before provider invocation. If process crashes after claim but before completion,
  // the attempt remains in claimed state (uncertain). No automatic retry/timeout; operator review required.
  const claim=await input.db.rpc('zeya_claim_governed_execution',{
    p_owner_id:input.ownerId,p_dispatch_id:input.dispatchId,p_authorization_id:input.authorizationId,p_operation_id:input.operationId,
    p_target_fingerprint:createHash('sha256').update(input.qaPhone).digest('hex'),
  });
  if(claim.error)throw new Error(`execution_claim_failed:${claim.error.code??'unknown'}`);
  const row=claim.data?.[0];if(!row)throw new Error('execution_claim_failed:empty');
  if(!row.claimed){const stored=await input.db.from('governed_execution_attempts').select('provider_call_id,conversation_id').eq('id',row.attempt_id).eq('owner_id',input.ownerId).single();
    return {attemptId:row.attempt_id,status:row.status,replayed:true,providerCallId:stored.data?.provider_call_id??null,conversationId:stored.data?.conversation_id??null};}

  const dispatch=await input.db.from('dispatches').select('worker_brief_id,mission_id,business_id,business_representation_id,representation_version_id').eq('dispatch_id',input.dispatchId).eq('owner_id',input.ownerId).single();
  const brief=dispatch.data&&await input.db.from('worker_briefs').select('id,brief_payload,objective,desired_outcome,company_context,lead_context').eq('id',dispatch.data.worker_brief_id).eq('owner_id',input.ownerId).single();
  if(dispatch.error||!dispatch.data||!brief||brief.error||!brief.data)throw new Error('execution_source_unavailable');
  const payload=object(brief.data.brief_payload),who=object(payload.who),what=object(payload.what),why=object(payload.why),authority=object(payload.authority);
  const authoritySummary=Object.fromEntries(Object.entries(authority).map(([key,value])=>[key,text(object(value).disposition)||'unresolved']));
  const now=new Date().toISOString();
  const workerBrief:WorkerBrief={
    id:brief.data.id,missionId:String(dispatch.data.mission_id),workerType:'CALLER',workerName:'Veya',status:'READY',
    companyContext:text(what.offer),leadContext:`Audience: ${text(what.audience)}. Target: ${text(who.companyName)||text(who.contactName)}.`,
    objective:text(why.objective)||brief.data.objective,desiredOutcome:text(payload.desiredNextStep)||brief.data.desired_outcome,
    keyQuestions:[],objectionGuidance:[],escalationRules:['Follow the governed authority dispositions; unresolved means no permission.'],
    successCriteria:'Apply the qualification threshold and pursue only the governed meeting objective.',
    toneGuidance:'Professional, warm, concise, and truthful.',
    dynamicVariables:{target:text(who.contactName)||text(who.companyName),company:text(who.companyName),offer:text(what.offer),audience:text(what.audience),
      missionObjective:text(why.objective),qualificationGoal:text(why.qualificationGoal),desiredNextStep:text(payload.desiredNextStep),authority:JSON.stringify(authoritySummary)},
    createdAt:now,updatedAt:now,
  };
  const result=await dispatchWorkerBrief(workerBrief,'ELEVENLABS',String(dispatch.data.business_id),{
    transientTargetPhone:input.qaPhone,governedExecutionClaim:{authorizationId:input.authorizationId,attemptId:row.attempt_id},
    representationSnapshot:{tenantUserId:input.ownerId,businessRepresentationId:String(dispatch.data.business_representation_id),canonicalVersionId:String(dispatch.data.representation_version_id)},
  });
  const dispatched=result.status==='DISPATCHED';
  const completed=await input.db.rpc('zeya_complete_governed_execution',{
    p_owner_id:input.ownerId,p_attempt_id:row.attempt_id,p_status:dispatched?'dispatched':'failed',
    p_provider_call_id:result.providerCallId??null,p_conversation_id:result.conversationId??null,p_error_code:dispatched?null:'provider_failed',
  });
  if(completed.error)throw new Error(`execution_completion_failed:${completed.error.code??'unknown'}`);
  return {attemptId:row.attempt_id,status:dispatched?'dispatched':'failed',replayed:false,providerCallId:result.providerCallId??null,conversationId:result.conversationId??null};
}
