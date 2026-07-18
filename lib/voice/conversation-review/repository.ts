import type { SupabaseClient } from "@supabase/supabase-js";
import type { PromotionTarget, ReviewConversation, ReviewDecision } from "./types";

type Row = Record<string, unknown>;

export async function listReviewConversations(db: SupabaseClient, businessId: string): Promise<ReviewConversation[]> {
  const { data: outputs, error } = await db.from("voice_conversation_outputs")
    .select("id,voice_context_id,business_id,business_representation_id,canonical_version_id,agent_type,channel,conversation_status,transcript_trust_level,completed_at,transcript")
    .eq("business_id", businessId).order("completed_at", { ascending: false });
  if (error) throw error;
  if (!outputs?.length) return [];
  const ids = outputs.map((row) => row.id);
  const representationIds = Array.from(new Set(outputs.map((row) => row.business_representation_id)));
  const [{ data: candidates, error: candidateError }, { data: decisions, error: decisionError }, { data: promotions, error: promotionError }, { data: elements, error: elementError }, { data: evidence, error: evidenceError }] = await Promise.all([
    db.from("voice_conversation_candidates").select("*").in("conversation_output_id", ids).order("extraction_ordinal"),
    db.from("conversation_candidate_review_decisions").select("id,candidate_id,decision_type,decision_reason,decided_at").in("conversation_output_id", ids).order("decided_at"),
    db.from("conversation_candidate_promotions").select("id,candidate_id,target_type,evidence_id,observation_id,representation_proposal_id,promoted_at").in("conversation_output_id", ids),
    db.from("representation_elements").select("id,business_representation_id,element_key").in("business_representation_id", representationIds),
    db.from("evidence").select("id,source_public_experience_session_id,source_voice_conversation_output_id").in("source_voice_conversation_output_id", ids),
  ]);
  if (candidateError || decisionError || promotionError || elementError || evidenceError) throw candidateError ?? decisionError ?? promotionError ?? elementError ?? evidenceError;
  return outputs.map((output) => ({
    id: output.id, voiceContextId: output.voice_context_id, businessId: output.business_id,
    businessRepresentationId: output.business_representation_id, canonicalVersionId: output.canonical_version_id,
    agentType: output.agent_type, channel: output.channel, status: output.conversation_status,
    trustLevel: output.transcript_trust_level, completedAt: output.completed_at,
    publicExperienceSessionId: (evidence ?? []).find((row) => row.source_voice_conversation_output_id === output.id)?.source_public_experience_session_id ?? null,
    transcript: Array.isArray(output.transcript) ? output.transcript as ReviewConversation["transcript"] : [],
    candidates: (candidates ?? []).filter((candidate) => candidate.conversation_output_id === output.id).map((candidate) => {
      const promotion = (promotions ?? []).find((row) => row.candidate_id === candidate.id) as Row | undefined;
      return {
        id: candidate.id, conversationOutputId: candidate.conversation_output_id, sourceEvidenceId: candidate.source_evidence_id ?? null, candidateType: candidate.candidate_type,
        content: candidate.content, speakerRole: candidate.speaker_role, sourceReference: candidate.source_reference,
        relevantElementKeys: candidate.relevant_element_keys,
        relatedElements: (elements ?? []).filter((element) => element.business_representation_id === candidate.business_representation_id && candidate.relevant_element_keys.includes(element.element_key)).map((element) => ({ id: element.id, key: element.element_key })),
        confidence: Number(candidate.confidence),
        rationale: candidate.extraction_rationale, trustLevel: candidate.transcript_trust_level,
        extractionSchemaVersion: candidate.extraction_schema_version,
        decisions: (decisions ?? []).filter((row) => row.candidate_id === candidate.id).map((row) => ({
          id: row.id, decision: row.decision_type, reason: row.decision_reason, decidedAt: row.decided_at,
        })),
        promotion: promotion ? { id: String(promotion.id), targetType: promotion.target_type as PromotionTarget,
          targetId: String(promotion.evidence_id ?? promotion.observation_id ?? promotion.representation_proposal_id),
          promotedAt: String(promotion.promoted_at) } : null,
      };
    }),
  })) as ReviewConversation[];
}

export async function recordReviewDecision(db: SupabaseClient, input: { candidateId: string; decision: Exclude<ReviewDecision, "accepted_for_promotion">; requestKey: string; reason?: string }) {
  const { data, error } = await db.rpc("zeya_review_voice_conversation_candidate", {
    p_candidate_id: input.candidateId, p_decision: input.decision, p_request_key: input.requestKey, p_reason: input.reason ?? null,
  });
  if (error) throw error;
  return data as { reviewDecisionId: string; decision: ReviewDecision; idempotent: boolean };
}

export async function promoteCandidate(db: SupabaseClient, input: { candidateId: string; targetType: PromotionTarget; requestKey: string; confirmedContent: { statement: string; elementKey?: string }; reason?: string; relatedElementId?: string; evidenceSourceType?: string }) {
  const { data, error } = await db.rpc("zeya_promote_voice_conversation_candidate", {
    p_candidate_id: input.candidateId, p_target_type: input.targetType, p_request_key: input.requestKey,
    p_confirmed_content: input.confirmedContent, p_reason: input.reason ?? null,
    p_related_element_id: input.relatedElementId ?? null,
    p_evidence_source_type: input.evidenceSourceType ?? "conversation",
  });
  if (error) throw error;
  return data as { reviewDecisionId: string; promotionId: string; targetType: PromotionTarget; targetId: string; idempotent: boolean };
}
