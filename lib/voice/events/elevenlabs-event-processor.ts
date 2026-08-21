import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { captureAndExtractConversationOutput } from "../conversation-output/service";
import type { NormalizedElevenLabsEvent, NormalizedElevenLabsOutcome } from "./elevenlabs-event-types";
import { normalizeElevenLabsWebhook } from "./elevenlabs-event-validator";

export interface ProcessedWebhookResult {
  success: boolean;
  type: string;
  duplicate?: boolean;
  pending?: boolean;
  message: string;
  conversationId?: string;
  error?: {code:string;message:string};
}

type ReceiptAcquisition = { status: "acquired" | "in_progress" | "completed"; attempt: number };

function receiptAcquisition(value: unknown): ReceiptAcquisition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!["acquired", "in_progress", "completed"].includes(String(candidate.status))
      || typeof candidate.attempt !== "number" || !Number.isInteger(candidate.attempt)
      || candidate.attempt < 1) return null;
  return candidate as ReceiptAcquisition;
}

function trustedDb(): SupabaseClient | null {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url&&key?createClient(url,key,{auth:{persistSession:false}}):null;
}

type GovernedOutcomeDecision="capture"|"verify_capture_replay"|"record_failure"|"duplicate_failure"|"conflict";
type ProviderOutcomeClass="success_with_transcript"|"success_without_transcript"|"non_success";
function classifyProviderOutcome(outcome:NormalizedElevenLabsOutcome):ProviderOutcomeClass{
  if(outcome==="completed")return"success_with_transcript";
  if(outcome==="completed_without_transcript")return"success_without_transcript";
  return"non_success";
}
export function decideGovernedOutcome(input:{
  attemptStatus:string;attemptProviderCallId:string|null;attemptConversationId:string|null;
  eventOutcome:NormalizedElevenLabsOutcome;eventProviderCallId:string;eventConversationId:string;
  existingOutput:{provider_call_id:string|null;conversation_id:string;transcript_status:string}|null;
}):GovernedOutcomeDecision{
  const outcomeClass=classifyProviderOutcome(input.eventOutcome);
  if(input.attemptProviderCallId!==input.eventProviderCallId
    ||(input.attemptConversationId!==null&&input.attemptConversationId!==input.eventConversationId))return"conflict";
  if(input.existingOutput){
    if(outcomeClass==="non_success"||!(["claimed","dispatched"].includes(input.attemptStatus))
      ||input.existingOutput.provider_call_id!==input.eventProviderCallId
      ||input.existingOutput.conversation_id!==input.eventConversationId)return"conflict";
    const finalized=input.existingOutput.transcript_status==="finalized";
    if(outcomeClass==="success_with_transcript")return finalized?"verify_capture_replay":"capture";
    return finalized?"conflict":"verify_capture_replay";
  }
  if(outcomeClass!=="non_success")return input.attemptStatus==="claimed"||input.attemptStatus==="dispatched"?"capture":"conflict";
  if(input.attemptStatus==="claimed")return"record_failure";
  if(input.attemptStatus==="failed")return"duplicate_failure";
  return"conflict";
}

// P2.7: Process P2.6 governed execution outcome
async function processGovernedExecutionOutcome(
  db: SupabaseClient,
  event: NormalizedElevenLabsEvent,
  lineage: Record<string,unknown>,
  _payloadHash: string
): Promise<ProcessedWebhookResult> {
  const voiceContextId = lineage.voice_context_id as string;
  const providerCallId = lineage.provider_call_id as string;
  const ownerId = lineage.tenant_user_id as string;

  // Verify governed execution attempt exists with matching provider identity
  const attempt = await db.from("governed_execution_attempts")
    .select("id,dispatch_id,status,provider_call_id,conversation_id")
    .eq("provider_call_id", providerCallId)
    .maybeSingle();
  if (attempt.error || !attempt.data) {
    throw new Error("governed_execution_not_found");
  }

  const existing=await db.from("voice_conversation_outputs").select("id,provider_call_id,conversation_id,transcript_status")
    .eq("voice_context_id",voiceContextId).maybeSingle();
  if(existing.error)throw new Error("conversation_output_lookup_failed");
  const decision=decideGovernedOutcome({attemptStatus:attempt.data.status,attemptProviderCallId:attempt.data.provider_call_id,
    attemptConversationId:attempt.data.conversation_id,eventOutcome:event.outcome,eventProviderCallId:providerCallId,
    eventConversationId:event.conversationId,existingOutput:existing.data});
  if(decision==="conflict")throw new Error("governed_provider_identity_conflict");
  if(decision==="duplicate_failure")return{
    success:true,type:event.providerEventType,duplicate:true,message:"Governed execution outcome already recorded.",
  };
  if(decision==="record_failure"){
      // Record non-completed outcome (failed call)
      const failed = await db.rpc("zeya_complete_governed_execution", {
        p_owner_id: ownerId,
        p_attempt_id: attempt.data.id,
        p_status: "failed",
        p_provider_call_id: providerCallId,
        p_conversation_id: event.conversationId,
        p_error_code: `provider_${event.outcome}`,
      });
      if (failed.error) throw new Error("outcome_persistence_failed");
      return { success: true, type: event.providerEventType, message: "Call outcome recorded." };
  }

    // Persist provider success before downstream capture/extraction. A processing
    // failure must never turn a successful provider execution into a failed one.
    if(attempt.data.status==="claimed"){
      const completed = await db.rpc("zeya_complete_governed_execution", {
        p_owner_id: ownerId,p_attempt_id: attempt.data.id,p_status: "dispatched",
        p_provider_call_id: providerCallId,p_conversation_id: event.conversationId,p_error_code: null,
      });
      if (completed.error) throw new Error("attempt_completion_failed");
    }

    // Capture completed conversation using the existing immutable service. Exact
    // replays still pass through its full payload identity check.
    const completedAt = new Date(event.eventTimestamp * 1000);
    const transcriptAvailable=event.outcome==="completed";
    await captureAndExtractConversationOutput({
      db,
      capture: {
        voiceContextId,
        conversationId: event.conversationId,
        providerCallId,
        provider: "elevenlabs",
        channel: "veya_outbound",
        captureSource: transcriptAvailable ? "provider_callback" : "status_only",
        transcriptTrustLevel: transcriptAvailable ? "provider_attested" : "status_only",
        providerAttested: transcriptAvailable,
        startedAt: event.durationSeconds !== null
          ? new Date(completedAt.getTime() - event.durationSeconds * 1000).toISOString()
          : null,
        completedAt: completedAt.toISOString(),
        transcript: event.transcript.map(turn => ({
          role: turn.role === "user" ? "customer" : "agent",
          text: turn.message,
          startedAtMs: turn.timestamp,
          metrics: turn.metrics,
        })),
        transcriptStatus: transcriptAvailable ? "finalized" : "unavailable",
        conversationStatus: "done",
        completionReason: transcriptAvailable ? "provider_completed" : "provider_completed_without_transcript",
        safeMetadata: {
          turnCount: event.transcript.length,
          durationSeconds: event.durationSeconds,
          providerCredits: event.providerCredits ?? null,
          providerLlmCredits: event.providerLlmCredits ?? null,
          providerReportedCost: event.providerReportedCost ?? null,
          providerEvaluation: event.providerEvaluation ?? null,
          ...(event.providerSummary ? { providerSummary: event.providerSummary } : {}),
        },
      },
    });

    return {
      success: true,
      type: event.providerEventType,
      ...(decision==="verify_capture_replay"?{duplicate:true}:{}),
      message: decision==="verify_capture_replay"
        ? "Governed execution outcome already recorded."
        : "Governed execution conversation captured.",
      conversationId: event.conversationId,
    };
}

export async function processElevenLabsWebhook(input: unknown,payloadHashInput?: string|Record<string,unknown>,_workerBriefId?:string): Promise<ProcessedWebhookResult> {
  const event=(input&&typeof input==="object"&&"providerEventType" in input?input:normalizeElevenLabsWebhook(input)) as NormalizedElevenLabsEvent|null;
  if(!event)return{success:false,type:"unknown",message:"Webhook payload is invalid."};
  const payloadHash=typeof payloadHashInput==="string"?payloadHashInput:createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const db=trustedDb();
  if(!db)return{success:false,type:event.providerEventType,message:"Webhook processing is unavailable."};
  let receiptAcquired=false;
  let receiptAttempt: number | null = null;
  let correlatedVoiceContextId: string | null = null;
  let correlatedProviderCallId: string | null = null;

  try{
    // P2.7: Resolve lineage by provider identity
    let lineageQuery=db.from("voice_representation_lineage").select("voice_context_id,tenant_user_id,mission_id,conversation_id,provider_call_id,business_id,business_representation_id,canonical_version_id,representation_context_mode").eq("conversation_id",event.conversationId);
    if(event.providerCallId)lineageQuery=lineageQuery.eq("provider_call_id",event.providerCallId);
    const lineage=await lineageQuery.maybeSingle();
    if(lineage.error||!lineage.data?.provider_call_id)throw new Error("provider_lineage_unavailable");

    // P2.7: Route based on execution type (P2.6 governed vs. Public Experience)
    // Check if this is a P2.6 governed execution by looking for governed_execution_attempts
    const isGovernedExecution = event.providerCallId
      ? (await db.from("governed_execution_attempts").select("id").eq("provider_call_id",event.providerCallId).maybeSingle()).data !== null
      : false;

    if(isGovernedExecution){
      // P2.7: Route to P2.6 governed execution path
      return await processGovernedExecutionOutcome(db,event,lineage.data,payloadHash);
    }

    // Existing Public Experience path
    const session=await db.from("public_experience_sessions").select("id,state,business_id,business_representation_id,canonical_version_id,representation_context_mode,provider_conversation_id,provider_call_id")
      .or(`veya_voice_context_id.eq.${lineage.data.voice_context_id},dispatch_id.eq.${lineage.data.mission_id}`).maybeSingle();
    if(session.error||!session.data)throw new Error("public_session_unavailable");
    if(session.data.business_id!==lineage.data.business_id||session.data.business_representation_id!==lineage.data.business_representation_id||session.data.canonical_version_id!==lineage.data.canonical_version_id||session.data.representation_context_mode!==lineage.data.representation_context_mode)throw new Error("lineage_identity_mismatch");
    const repair=await db.rpc("zeya_repair_public_experience_dispatch",{p_veya_voice_context_id:lineage.data.voice_context_id,p_provider_conversation_id:event.conversationId,p_provider_call_id:lineage.data.provider_call_id});
    if(repair.error)throw new Error("dispatch_correlation_unavailable");
    const begun=await db.rpc("zeya_begin_voice_webhook_receipt",{p_event_key:event.eventKey,p_event_type:event.providerEventType,p_provider_conversation_id:event.conversationId,p_payload_hash:payloadHash,p_public_experience_session_id:session.data.id});
    if(begun.error)throw new Error("webhook_receipt_unavailable");
    const acquisition=receiptAcquisition(begun.data);
    if(!acquisition)throw new Error("webhook_receipt_unavailable");
    if(acquisition.status==="completed")return{success:true,type:event.providerEventType,duplicate:true,message:"Webhook already processed."};
    if(acquisition.status==="in_progress")return{success:true,type:event.providerEventType,pending:true,message:"Webhook processing is already in progress."};
    receiptAcquired=true;
    receiptAttempt=acquisition.attempt;
    correlatedVoiceContextId=lineage.data.voice_context_id;
    correlatedProviderCallId=lineage.data.provider_call_id;
    if(event.outcome!=="completed"){
      const failed=await db.rpc("zeya_record_public_experience_call_failure",{p_veya_voice_context_id:lineage.data.voice_context_id,p_provider_conversation_id:event.conversationId,p_provider_call_id:lineage.data.provider_call_id,p_outcome:event.outcome});
      if(failed.error)throw new Error("call_outcome_persistence_failed");
      const finished=await db.rpc("zeya_finish_voice_webhook_receipt",{p_event_key:event.eventKey,p_expected_attempt:receiptAttempt,p_succeeded:true});
      if(finished.error)throw new Error("webhook_receipt_completion_failed");
      if(finished.data==="stale_attempt")return{success:true,type:event.providerEventType,pending:true,message:"Webhook processing was superseded."};
      return{success:true,type:event.providerEventType,message:"Call outcome recorded."};
    }
    const completedAt=new Date(event.eventTimestamp*1000);
    const output=await captureAndExtractConversationOutput({db,capture:{
      voiceContextId:lineage.data.voice_context_id,conversationId:event.conversationId,providerCallId:lineage.data.provider_call_id,
      provider:"elevenlabs",channel:"veya_outbound",captureSource:"provider_callback",transcriptTrustLevel:"provider_attested",providerAttested:true,
      startedAt:event.durationSeconds!==null?new Date(completedAt.getTime()-event.durationSeconds*1000).toISOString():null,completedAt:completedAt.toISOString(),
      transcript:event.transcript.map(turn=>({role:turn.role==="user"?"customer":"agent",text:turn.message,startedAtMs:turn.timestamp,metrics:turn.metrics})),
      transcriptStatus:"finalized",conversationStatus:"done",completionReason:"provider_completed",safeMetadata:{turnCount:event.transcript.length,durationSeconds:event.durationSeconds,providerCredits:event.providerCredits??null,providerLlmCredits:event.providerLlmCredits??null,providerReportedCost:event.providerReportedCost??null,providerEvaluation:event.providerEvaluation??null,...(event.providerSummary?{providerSummary:event.providerSummary}:{})},
    },extractionModel:process.env.PUBLIC_EXPERIENCE_TEST_MODE==="true"
      ? async()=>[{candidateType:"customer_need",content:{summary:"A provider-attested customer need requires founder review."},speakerRole:"customer",statementKind:"assertion",sourceReference:{turnIndexes:[Math.max(0,event.transcript.length-1)]},relevantElementKeys:process.env.PUBLIC_EXPERIENCE_TEST_ELEMENT_KEY?[process.env.PUBLIC_EXPERIENCE_TEST_ELEMENT_KEY]:[],confidence:0.8,rationale:"Deterministic deployed integration fixture."}]
      : undefined});
    const completion=await db.rpc("zeya_complete_public_experience_call",{p_veya_voice_context_id:lineage.data.voice_context_id,p_conversation_output_id:output.conversationOutputId});
    if(completion.error||completion.data!=="reflection_ready")throw new Error("public_completion_failed");
    const finished=await db.rpc("zeya_finish_voice_webhook_receipt",{p_event_key:event.eventKey,p_expected_attempt:receiptAttempt,p_succeeded:true});
    if(finished.error)throw new Error("webhook_receipt_completion_failed");
    if(finished.data==="stale_attempt")return{success:true,type:event.providerEventType,pending:true,message:"Webhook processing was superseded."};
    return{success:true,type:event.providerEventType,message:"Webhook processed."};
  }catch(err){
    if(receiptAcquired&&receiptAttempt!==null){
      const failedReceipt=await db.rpc("zeya_finish_voice_webhook_receipt",{p_event_key:event.eventKey,p_expected_attempt:receiptAttempt,p_succeeded:false});
      if(!failedReceipt.error&&failedReceipt.data==="failed"&&correlatedVoiceContextId&&correlatedProviderCallId){
        await db.rpc("zeya_record_public_experience_call_failure",{
          p_veya_voice_context_id:correlatedVoiceContextId,
          p_provider_conversation_id:event.conversationId,
          p_provider_call_id:correlatedProviderCallId,
          p_outcome:"completion_processing_failed",
        });
      }
    }
    console.error('[p27-webhook-processor] error',{message:err instanceof Error?err.message:'unknown',conversationId:event.conversationId,providerCallId:event.providerCallId});
    return{success:false,type:event.providerEventType,message:"Webhook processing failed."};
  }
}

export function getConversation(){return null}
export function getAllConversations(){return []}
export function clearAllState():void{}
