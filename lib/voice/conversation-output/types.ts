export const CONVERSATION_OUTPUT_SCHEMA_VERSION = "1.0";
export const CONVERSATION_EXTRACTION_SCHEMA_VERSION = "1.0";

export const candidateTypes = [
  "customer_question", "objection", "commitment_made", "promised_follow_up",
  "unanswered_question", "qualification_signal", "customer_need",
  "customer_aspiration", "customer_language", "possible_representation_gap",
  "candidate_evidence", "candidate_observation", "possible_contradiction",
  "suggested_follow_up", "outcome_classification", "next_action_recommendation",
] as const;

export type ConversationCandidateType = typeof candidateTypes[number];
export type ConversationSpeakerRole = "customer" | "founder" | "staff" | "zeya" | "veya" | "unknown";
export type ConversationStatementKind = "question" | "assertion" | "objection" | "inference" | "request" | "commitment" | "classification";

export type ConversationTranscriptTurn = {
  role: "customer" | "agent";
  text: string;
  startedAtMs?: number;
  endedAtMs?: number;
};

export type ConversationCandidate = {
  candidateType: ConversationCandidateType;
  content: { summary: string; [key: string]: unknown };
  speakerRole: ConversationSpeakerRole;
  statementKind: ConversationStatementKind;
  sourceReference: { turnIndexes: number[]; startMs?: number; endMs?: number };
  relevantElementKeys: string[];
  confidence: number;
  rationale: string;
};

export type ConversationOutputCapture = {
  voiceContextId: string;
  conversationId: string;
  providerCallId?: string | null;
  provider: "openai_realtime" | "elevenlabs";
  channel: "zeya_realtime" | "veya_outbound";
  captureSource: "trusted_server" | "authenticated_client_relay" | "provider_callback" | "status_only";
  transcriptTrustLevel: "provider_attested" | "authenticated_client_relay" | "status_only";
  providerAttested: boolean;
  submittedBy?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  transcript: ConversationTranscriptTurn[];
  transcriptStatus: "missing" | "pending" | "unavailable" | "finalized";
  conversationStatus: string;
  completionReason?: string | null;
  safeMetadata?: Record<string, string | number | boolean | null>;
};

const speakerRoles = new Set<ConversationSpeakerRole>(["customer", "founder", "staff", "zeya", "veya", "unknown"]);
const statementKinds = new Set<ConversationStatementKind>(["question", "assertion", "objection", "inference", "request", "commitment", "classification"]);
const candidateTypeSet = new Set<string>(candidateTypes);

export function validateCandidates(value: unknown): ConversationCandidate[] {
  if (!Array.isArray(value)) throw new Error("Extraction response must be an array");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Invalid candidate at index ${index}`);
    const row = entry as Record<string, unknown>;
    const source = row.sourceReference as Record<string, unknown> | undefined;
    const content = row.content as Record<string, unknown> | undefined;
    if (!candidateTypeSet.has(String(row.candidateType))
      || !speakerRoles.has(row.speakerRole as ConversationSpeakerRole)
      || !statementKinds.has(row.statementKind as ConversationStatementKind)
      || !content || typeof content.summary !== "string" || content.summary.trim() === ""
      || !source || !Array.isArray(source.turnIndexes) || !source.turnIndexes.every(Number.isInteger)
      || !Array.isArray(row.relevantElementKeys) || !row.relevantElementKeys.every((key) => typeof key === "string")
      || typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1
      || typeof row.rationale !== "string" || row.rationale.trim() === "") {
      throw new Error(`Invalid candidate at index ${index}`);
    }
    return row as unknown as ConversationCandidate;
  });
}
