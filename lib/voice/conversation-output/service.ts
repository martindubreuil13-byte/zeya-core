import type { SupabaseClient } from "@supabase/supabase-js";
import { extractConversationCandidates, type ConversationExtractionModel } from "./extractor";
import { captureConversationOutput, finalizeConversationTranscript, storeConversationCandidates } from "./repository";
import type { ConversationOutputCapture } from "./types";

export class ConversationOutputProcessingError extends Error {
  public readonly code: string;

  constructor(public readonly stage: "extraction" | "candidate_storage", cause: unknown) {
    super(stage === "extraction" ? "Conversation extraction failed" : "Conversation candidate storage failed", { cause });
    this.name = "ConversationOutputProcessingError";
    this.code = classifyConversationOutputFailure(stage, cause);
  }
}

function classifyConversationOutputFailure(stage: "extraction" | "candidate_storage", cause: unknown): string {
  if (stage === "candidate_storage") return "candidate_storage_failed";
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("unavailable")) return "extraction_model_unavailable";
  if (message.includes("no result")) return "extraction_empty_response";
  if (message.includes("response must be an array") || message.includes("Invalid candidate")) return "extraction_schema_invalid";
  if (message.includes("unauthorized Representation element")) return "extraction_element_key_unauthorized";
  if (message.includes("source reference is invalid")) return "extraction_source_turn_invalid";
  if (message.includes("Unattested transcript")) return "extraction_evidence_not_authorized";
  if (message.includes("Agent statements")) return "extraction_agent_evidence_invalid";
  if (message.includes("summary")) return "extraction_summary_invalid";
  if (message.includes("rationale")) return "extraction_rationale_invalid";
  if (cause instanceof SyntaxError) return "extraction_json_invalid";
  return "conversation_extraction_failed";
}

export async function captureAndExtractConversationOutput(input: {
  db: SupabaseClient;
  capture: ConversationOutputCapture;
  extractionModel?: ConversationExtractionModel;
}): Promise<{ conversationOutputId: string; candidateCount: number }> {
  const lineage = await input.db.from("voice_representation_lineage")
    .select("canonical_version_id,representation_context_mode,authorized_element_keys,agent_type")
    .eq("voice_context_id", input.capture.voiceContextId).single();
  if (lineage.error || !lineage.data) throw new Error("Conversation lineage is unavailable");
  if (
    (lineage.data.representation_context_mode === "canonical" &&
      lineage.data.canonical_version_id === null) ||
    (lineage.data.representation_context_mode === "pre_canonical" &&
      lineage.data.canonical_version_id !== null)
  ) {
    throw new Error("Conversation lineage Representation context is invalid");
  }

  const existing = await input.db.from("voice_conversation_outputs")
    .select("id,transcript_status,transcript,processing_status,extracted_candidate_count")
    .eq("voice_context_id", input.capture.voiceContextId)
    .maybeSingle();
  if (existing.error) throw new Error("Conversation output lookup failed");
  let conversationOutputId: string;
  if (existing.data?.transcript_status === "finalized") {
    // The capture RPC owns the complete immutable identity comparison. Calling it
    // again distinguishes an exact replay from conflicts in completion metadata,
    // provenance, extraction version, or safe metadata as well as transcript data.
    conversationOutputId = await captureConversationOutput(input.db, input.capture);
    if (existing.data.processing_status === "completed"
      && typeof existing.data.extracted_candidate_count === "number") {
      return {
        conversationOutputId,
        candidateCount: existing.data.extracted_candidate_count,
      };
    }
  } else if (existing.data && input.capture.transcript.length > 0) {
    conversationOutputId = await finalizeConversationTranscript(input.db, input.capture);
  } else {
    conversationOutputId = await captureConversationOutput(input.db, input.capture);
  }
  if (input.capture.transcript.length === 0) {
    return { conversationOutputId, candidateCount: 0 };
  }
  let candidates;
  try {
    candidates = await extractConversationCandidates({
      transcript: input.capture.transcript,
      channel: input.capture.channel,
      agentType: lineage.data.agent_type,
      canonicalVersionId: lineage.data.canonical_version_id,
      authorizedElementKeys: lineage.data.authorized_element_keys,
      transcriptTrustLevel: input.capture.transcriptTrustLevel,
    }, input.extractionModel);
  } catch (error) {
    throw new ConversationOutputProcessingError("extraction", error);
  }
  let candidateCount: number;
  try {
    candidateCount = await storeConversationCandidates(input.db, conversationOutputId, candidates);
  } catch (error) {
    throw new ConversationOutputProcessingError("candidate_storage", error);
  }
  return { conversationOutputId, candidateCount };
}
