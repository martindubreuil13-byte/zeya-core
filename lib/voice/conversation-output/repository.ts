import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONVERSATION_EXTRACTION_SCHEMA_VERSION,
  CONVERSATION_OUTPUT_SCHEMA_VERSION,
  type ConversationCandidate,
  type ConversationOutputCapture,
} from "./types";

export async function captureConversationOutput(db: SupabaseClient, input: ConversationOutputCapture): Promise<string> {
  const result = await db.rpc("zeya_capture_voice_conversation_output", {
    p_voice_context_id: input.voiceContextId,
    p_conversation_id: input.conversationId,
    p_provider_call_id: input.providerCallId ?? null,
    p_provider: input.provider,
    p_channel: input.channel,
    p_capture_source: input.captureSource,
    p_transcript_trust_level: input.transcriptTrustLevel,
    p_provider_attested: input.providerAttested,
    p_submitted_by: input.submittedBy ?? null,
    p_started_at: input.startedAt ?? null,
    p_completed_at: input.completedAt ?? null,
    p_transcript: input.transcript,
    p_transcript_status: input.transcriptStatus,
    p_transcript_schema_version: CONVERSATION_OUTPUT_SCHEMA_VERSION,
    p_conversation_status: input.conversationStatus,
    p_completion_reason: input.completionReason ?? null,
    p_extraction_schema_version: CONVERSATION_EXTRACTION_SCHEMA_VERSION,
    p_safe_metadata: input.safeMetadata ?? {},
  });
  if (result.error || typeof result.data !== "string") {
    if (result.error?.code === "23505") throw new Error("Conversation capture conflict");
    throw new Error(`Conversation capture failed: ${result.error?.code ?? "invalid_result"}`);
  }
  return result.data;
}

export async function finalizeConversationTranscript(
  db: SupabaseClient,
  input: Pick<ConversationOutputCapture, "voiceContextId" | "transcript" | "completedAt" | "conversationStatus" | "completionReason">,
): Promise<string> {
  const result = await db.rpc("zeya_finalize_voice_conversation_transcript", {
    p_voice_context_id: input.voiceContextId,
    p_transcript: input.transcript,
    p_completed_at: input.completedAt ?? null,
    p_conversation_status: input.conversationStatus,
    p_completion_reason: input.completionReason ?? null,
  });
  if (result.error || typeof result.data !== "string") {
    throw new Error(`Conversation transcript finalization failed: ${result.error?.code ?? "invalid_result"}`);
  }
  return result.data;
}

export async function storeConversationCandidates(
  db: SupabaseClient,
  conversationOutputId: string,
  candidates: ConversationCandidate[],
): Promise<number> {
  const result = await db.rpc("zeya_store_voice_conversation_candidates", {
    p_conversation_output_id: conversationOutputId,
    p_extraction_schema_version: CONVERSATION_EXTRACTION_SCHEMA_VERSION,
    p_candidates: candidates,
  });
  if (result.error || typeof result.data !== "number") {
    throw new Error(`Conversation candidate persistence failed: ${result.error?.code ?? "invalid_result"}`);
  }
  return result.data;
}
