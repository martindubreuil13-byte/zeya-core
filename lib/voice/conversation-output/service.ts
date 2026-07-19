import type { SupabaseClient } from "@supabase/supabase-js";
import { extractConversationCandidates, type ConversationExtractionModel } from "./extractor";
import { captureConversationOutput, finalizeConversationTranscript, storeConversationCandidates } from "./repository";
import type { ConversationOutputCapture } from "./types";

export class ConversationOutputProcessingError extends Error {
  constructor(public readonly stage: "extraction" | "candidate_storage", cause: unknown) {
    super(stage === "extraction" ? "Conversation extraction failed" : "Conversation candidate storage failed", { cause });
    this.name = "ConversationOutputProcessingError";
  }
}

export async function captureAndExtractConversationOutput(input: {
  db: SupabaseClient;
  capture: ConversationOutputCapture;
  extractionModel?: ConversationExtractionModel;
}): Promise<{ conversationOutputId: string; candidateCount: number }> {
  const lineage = await input.db.from("voice_representation_lineage")
    .select("canonical_version_id,authorized_element_keys,agent_type")
    .eq("voice_context_id", input.capture.voiceContextId).single();
  if (lineage.error || !lineage.data) throw new Error("Conversation lineage is unavailable");

  const existing = await input.db.from("voice_conversation_outputs")
    .select("id,transcript_status")
    .eq("voice_context_id", input.capture.voiceContextId)
    .maybeSingle();
  if (existing.error) throw new Error("Conversation output lookup failed");
  const conversationOutputId = existing.data && existing.data.transcript_status !== "finalized" && input.capture.transcript.length > 0
    ? await finalizeConversationTranscript(input.db, input.capture)
    : await captureConversationOutput(input.db, input.capture);
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
