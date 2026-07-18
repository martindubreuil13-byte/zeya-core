import type { ConversationCandidateType, ConversationSpeakerRole } from "@/lib/voice/conversation-output/types";

export const reviewDecisions = ["deferred", "rejected", "duplicate", "acknowledged", "accepted_for_promotion"] as const;
export const promotionTargets = ["evidence", "observation", "representation_proposal"] as const;
export type ReviewDecision = typeof reviewDecisions[number];
export type PromotionTarget = typeof promotionTargets[number];

export type ReviewCandidate = {
  id: string;
  conversationOutputId: string;
  sourceEvidenceId: string | null;
  candidateType: ConversationCandidateType;
  content: Record<string, unknown> & { summary?: string };
  speakerRole: ConversationSpeakerRole;
  sourceReference: { turnIndexes?: number[]; startMs?: number; endMs?: number };
  relevantElementKeys: string[];
  relatedElements: Array<{ id: string; key: string }>;
  confidence: number;
  rationale: string;
  trustLevel: "provider_attested" | "authenticated_client_relay" | "status_only";
  extractionSchemaVersion: string;
  decisions: Array<{ id: string; decision: ReviewDecision; reason: string | null; decidedAt: string }>;
  promotion: { id: string; targetType: PromotionTarget; targetId: string; promotedAt: string } | null;
};

export type ReviewConversation = {
  id: string;
  businessId: string;
  businessRepresentationId: string;
  voiceContextId: string;
  canonicalVersionId: string;
  agentType: string;
  channel: string;
  status: string;
  trustLevel: "provider_attested" | "authenticated_client_relay" | "status_only";
  completedAt: string | null;
  publicExperienceSessionId: string | null;
  transcript: Array<{ role: "customer" | "agent"; text: string }>;
  candidates: ReviewCandidate[];
};

export function effectiveReviewState(candidate: ReviewCandidate): "pending_review" | ReviewDecision {
  return candidate.decisions.at(-1)?.decision ?? "pending_review";
}

export function allowedPromotionTargets(type: ConversationCandidateType): PromotionTarget[] {
  if (type === "candidate_evidence") return ["evidence"];
  if (["candidate_observation", "qualification_signal", "customer_need", "customer_aspiration", "customer_language", "possible_representation_gap", "possible_contradiction"].includes(type)) {
    return type === "qualification_signal" ? ["observation"] : ["observation", "representation_proposal"];
  }
  return [];
}
