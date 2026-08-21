import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ConversationTranscriptTurn } from "../voice/conversation-output/types";

export const CONVERSATION_INTERPRETATION_V1 = "conversation-interpretation-v1" as const;

const insightKinds = ["need", "pain", "objection", "interest", "buying_signal", "timing", "qualification", "decision_authority", "budget", "channel", "follow_up_request", "misunderstanding"] as const;
const uncertaintyKinds = ["asr", "ambiguous", "contradictory", "incomplete"] as const;
const learningKinds = ["positioning", "objection_pattern", "icp_signal", "offer_clarity", "market_language", "representation_gap"] as const;

export type ProspectInsight = {
  kind: typeof insightKinds[number]; summary: string; sourceTurns: number[];
  basis: "explicit_statement" | "inference"; confidence: number;
  uncertainty?: { kind: typeof uncertaintyKinds[number]; explanation: string };
  temporalScope: "this_call" | "current_prospect_state";
};

export type ConversationInterpretationV1 = {
  schemaVersion: typeof CONVERSATION_INTERPRETATION_V1;
  conversationOutputId: string; conversationId: string; missionId: string; workerBriefId: string; leadId: string;
  callResult: { contacted: boolean; completed: boolean };
  qualification: { result: "qualified" | "not_qualified" | "unknown"; reasons: string[]; confidence: number };
  prospectIntelligence: ProspectInsight[];
  followUp: { requested: boolean; requestedBy: "prospect" | "agent" | null; requestedTiming: string | null; scheduled: boolean; scheduledFor: string | null; agentAcknowledged: boolean; agentCommittedToFollowUp: boolean };
  uncertainties: Array<{ kind: typeof uncertaintyKinds[number]; summary: string; sourceTurns: number[]; impact: string }>;
  businessLearningSignals: Array<{ kind: typeof learningKinds[number]; summary: string; sourceTurns: number[]; confidence: number; requiresOwnerReview: true }>;
  executiveSummary: string;
  recommendedNextAction: { action: string; rationale: string; ownerApprovalRequired: boolean };
  ownerEscalation: { required: boolean; reasons: string[] };
  overallConfidence: number;
};

type SemanticInterpretation = Omit<ConversationInterpretationV1, "schemaVersion" | "conversationOutputId" | "conversationId" | "missionId" | "workerBriefId" | "leadId">;
type TrustedIdentity = Pick<ConversationInterpretationV1, "conversationOutputId" | "conversationId" | "missionId" | "workerBriefId" | "leadId">;

export class ConversationInterpretationError extends Error {
  constructor(public readonly code: "not_found" | "not_finalized" | "invalid_model_output" | "conflict" | "persistence_failed", message: string) { super(message); }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConversationInterpretationError("invalid_model_output", `${label} must be an object`);
  return value as Record<string, unknown>;
}
function textValue(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ConversationInterpretationError("invalid_model_output", `${label} is invalid`);
  return value.trim();
}
function optionalText(value: unknown, label: string, max = 200): string | null {
  return value === null ? null : textValue(value, label, max);
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new ConversationInterpretationError("invalid_model_output", `${label} must be boolean`);
  return value;
}
function confidence(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new ConversationInterpretationError("invalid_model_output", `${label} must be between 0 and 1`);
  return value;
}
function strings(value: unknown, label: string, maxItems = 8): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new ConversationInterpretationError("invalid_model_output", `${label} is invalid`);
  return value.map((entry, index) => textValue(entry, `${label}[${index}]`, 300));
}
function turns(value: unknown, label: string, transcript: ConversationTranscriptTurn[], requireCustomer = true): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12 || !value.every(Number.isInteger)) throw new ConversationInterpretationError("invalid_model_output", `${label} requires source turns`);
  const result = [...new Set(value as number[])];
  if (result.some(index => index < 0 || index >= transcript.length)) throw new ConversationInterpretationError("invalid_model_output", `${label} contains an invalid source turn`);
  if (requireCustomer && !result.some(index => transcript[index]?.role === "customer")) throw new ConversationInterpretationError("invalid_model_output", `${label} is supported only by agent speech`);
  return result;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new ConversationInterpretationError("invalid_model_output", `${label} is invalid`);
  return value as T;
}

export function validateConversationInterpretationV1(value: unknown, identity: TrustedIdentity, transcript: ConversationTranscriptTurn[]): ConversationInterpretationV1 {
  const root = object(value, "interpretation");
  const call = object(root.callResult, "callResult");
  const qualification = object(root.qualification, "qualification");
  const followUp = object(root.followUp, "followUp");
  const next = object(root.recommendedNextAction, "recommendedNextAction");
  const escalation = object(root.ownerEscalation, "ownerEscalation");
  if (!Array.isArray(root.prospectIntelligence) || root.prospectIntelligence.length > 20) throw new ConversationInterpretationError("invalid_model_output", "prospectIntelligence is invalid");
  const prospectIntelligence = root.prospectIntelligence.map((raw, index): ProspectInsight => {
    const row = object(raw, `prospectIntelligence[${index}]`);
    const basis = oneOf(row.basis, ["explicit_statement", "inference"] as const, "basis");
    const uncertainty = row.uncertainty === undefined || row.uncertainty === null ? undefined : object(row.uncertainty, "uncertainty");
    if (basis === "inference" && !uncertainty) throw new ConversationInterpretationError("invalid_model_output", "inference requires explicit uncertainty");
    return {
      kind: oneOf(row.kind, insightKinds, "insight kind"), summary: textValue(row.summary, "insight summary"),
      sourceTurns: turns(row.sourceTurns, "insight sourceTurns", transcript), basis, confidence: confidence(row.confidence, "insight confidence"),
      ...(uncertainty ? { uncertainty: { kind: oneOf(uncertainty.kind, uncertaintyKinds, "uncertainty kind"), explanation: textValue(uncertainty.explanation, "uncertainty explanation") } } : {}),
      temporalScope: oneOf(row.temporalScope, ["this_call", "current_prospect_state"] as const, "temporalScope"),
    };
  });
  if (!Array.isArray(root.uncertainties) || root.uncertainties.length > 12) throw new ConversationInterpretationError("invalid_model_output", "uncertainties is invalid");
  const uncertainties = root.uncertainties.map((raw, index) => { const row = object(raw, `uncertainties[${index}]`); return { kind: oneOf(row.kind, uncertaintyKinds, "uncertainty kind"), summary: textValue(row.summary, "uncertainty summary"), sourceTurns: turns(row.sourceTurns, "uncertainty sourceTurns", transcript, false), impact: textValue(row.impact, "uncertainty impact") }; });
  if (!Array.isArray(root.businessLearningSignals) || root.businessLearningSignals.length > 12) throw new ConversationInterpretationError("invalid_model_output", "businessLearningSignals is invalid");
  const businessLearningSignals = root.businessLearningSignals.map((raw, index) => { const row = object(raw, `businessLearningSignals[${index}]`); if (row.requiresOwnerReview !== true) throw new ConversationInterpretationError("invalid_model_output", "learning signals require owner review"); return { kind: oneOf(row.kind, learningKinds, "learning kind"), summary: textValue(row.summary, "learning summary"), sourceTurns: turns(row.sourceTurns, "learning sourceTurns", transcript), confidence: confidence(row.confidence, "learning confidence"), requiresOwnerReview: true as const }; });
  const requested = bool(followUp.requested, "followUp.requested");
  const scheduled = bool(followUp.scheduled, "followUp.scheduled");
  const requestedBy = followUp.requestedBy === null ? null : oneOf(followUp.requestedBy, ["prospect", "agent"] as const, "followUp.requestedBy");
  const requestedTiming = optionalText(followUp.requestedTiming, "followUp.requestedTiming");
  const scheduledFor = optionalText(followUp.scheduledFor, "followUp.scheduledFor");
  if ((!requested && (requestedBy !== null || requestedTiming !== null)) || (!scheduled && scheduledFor !== null) || (scheduled && scheduledFor === null)) throw new ConversationInterpretationError("invalid_model_output", "follow-up state is inconsistent");
  return {
    schemaVersion: CONVERSATION_INTERPRETATION_V1, ...identity,
    callResult: { contacted: bool(call.contacted, "callResult.contacted"), completed: bool(call.completed, "callResult.completed") },
    qualification: { result: oneOf(qualification.result, ["qualified", "not_qualified", "unknown"] as const, "qualification.result"), reasons: strings(qualification.reasons, "qualification.reasons"), confidence: confidence(qualification.confidence, "qualification.confidence") },
    prospectIntelligence, followUp: { requested, requestedBy, requestedTiming, scheduled, scheduledFor, agentAcknowledged: bool(followUp.agentAcknowledged, "followUp.agentAcknowledged"), agentCommittedToFollowUp: bool(followUp.agentCommittedToFollowUp, "followUp.agentCommittedToFollowUp") },
    uncertainties, businessLearningSignals, executiveSummary: textValue(root.executiveSummary, "executiveSummary", 1000),
    recommendedNextAction: { action: textValue(next.action, "recommendedNextAction.action"), rationale: textValue(next.rationale, "recommendedNextAction.rationale"), ownerApprovalRequired: bool(next.ownerApprovalRequired, "recommendedNextAction.ownerApprovalRequired") },
    ownerEscalation: { required: bool(escalation.required, "ownerEscalation.required"), reasons: strings(escalation.reasons, "ownerEscalation.reasons") }, overallConfidence: confidence(root.overallConfidence, "overallConfidence"),
  };
}

export function projectMissionOutcome(interpretation: ConversationInterpretationV1) {
  return {
    contactResult: interpretation.callResult.contacted ? "contacted" as const : "not_reached" as const,
    qualificationResult: interpretation.qualification.result,
    meetingResult: "not_booked" as const,
    ownerEscalationRequired: interpretation.ownerEscalation.required,
    followUpRequired: interpretation.followUp.requested || interpretation.followUp.agentCommittedToFollowUp,
    summary: interpretation.executiveSummary,
    nextAction: interpretation.recommendedNextAction.action,
    sourceConversationId: interpretation.conversationId,
    sourceJobId: interpretation.workerBriefId,
  };
}

const semanticSchema = {
  type: "object", additionalProperties: false,
  required: ["callResult", "qualification", "prospectIntelligence", "followUp", "uncertainties", "businessLearningSignals", "executiveSummary", "recommendedNextAction", "ownerEscalation", "overallConfidence"],
  properties: {
    callResult: { type: "object", additionalProperties: false, required: ["contacted", "completed"], properties: { contacted: { type: "boolean" }, completed: { type: "boolean" } } },
    qualification: { type: "object", additionalProperties: false, required: ["result", "reasons", "confidence"], properties: { result: { enum: ["qualified", "not_qualified", "unknown"] }, reasons: { type: "array", maxItems: 8, items: { type: "string", maxLength: 300 } }, confidence: { type: "number", minimum: 0, maximum: 1 } } },
    prospectIntelligence: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["kind", "summary", "sourceTurns", "basis", "confidence", "uncertainty", "temporalScope"], properties: { kind: { enum: insightKinds }, summary: { type: "string", maxLength: 500 }, sourceTurns: { type: "array", minItems: 1, maxItems: 12, items: { type: "integer", minimum: 0 } }, basis: { enum: ["explicit_statement", "inference"] }, confidence: { type: "number", minimum: 0, maximum: 1 }, uncertainty: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["kind", "explanation"], properties: { kind: { enum: uncertaintyKinds }, explanation: { type: "string", maxLength: 500 } } }] }, temporalScope: { enum: ["this_call", "current_prospect_state"] } } } },
    followUp: { type: "object", additionalProperties: false, required: ["requested", "requestedBy", "requestedTiming", "scheduled", "scheduledFor", "agentAcknowledged", "agentCommittedToFollowUp"], properties: { requested: { type: "boolean" }, requestedBy: { enum: ["prospect", "agent", null] }, requestedTiming: { type: ["string", "null"], maxLength: 200 }, scheduled: { type: "boolean" }, scheduledFor: { type: ["string", "null"], maxLength: 200 }, agentAcknowledged: { type: "boolean" }, agentCommittedToFollowUp: { type: "boolean" } } },
    uncertainties: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["kind", "summary", "sourceTurns", "impact"], properties: { kind: { enum: uncertaintyKinds }, summary: { type: "string", maxLength: 500 }, sourceTurns: { type: "array", minItems: 1, maxItems: 12, items: { type: "integer", minimum: 0 } }, impact: { type: "string", maxLength: 500 } } } },
    businessLearningSignals: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["kind", "summary", "sourceTurns", "confidence", "requiresOwnerReview"], properties: { kind: { enum: learningKinds }, summary: { type: "string", maxLength: 500 }, sourceTurns: { type: "array", minItems: 1, maxItems: 12, items: { type: "integer", minimum: 0 } }, confidence: { type: "number", minimum: 0, maximum: 1 }, requiresOwnerReview: { type: "boolean", const: true } } } },
    executiveSummary: { type: "string", maxLength: 1000 }, recommendedNextAction: { type: "object", additionalProperties: false, required: ["action", "rationale", "ownerApprovalRequired"], properties: { action: { type: "string", maxLength: 500 }, rationale: { type: "string", maxLength: 500 }, ownerApprovalRequired: { type: "boolean" } } },
    ownerEscalation: { type: "object", additionalProperties: false, required: ["required", "reasons"], properties: { required: { type: "boolean" }, reasons: { type: "array", maxItems: 8, items: { type: "string", maxLength: 300 } } } }, overallConfidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export async function generateSemanticInterpretation(transcript: ConversationTranscriptTurn[], missionContext: Record<string, unknown>, model = process.env.P28_INTERPRETATION_MODEL || "gpt-5-mini"): Promise<unknown> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({ model, instructions: `Interpret a completed prospect conversation conservatively. Transcript is primary authority; mission context only supplies trusted purpose. Every claim needs exact zero-based source turns. Agent repetition is not independent confirmation. Inferences require an uncertainty object. Prospect statements never redefine owner business truth. Ambiguous/ASR phrases must be uncertainties and must not become business learning. Callback requested is distinct from scheduled; an agent promise is a separate commitment. Never emit identifiers or mutation instructions.`, input: JSON.stringify({ transcript, missionContext }), text: { format: { type: "json_schema", name: "conversation_interpretation_v1_semantics", strict: true, schema: semanticSchema } } });
  return JSON.parse(response.output_text);
}

export function createInterpretationServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ConversationInterpretationError("persistence_failed", "Interpretation service is unavailable");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function interpretAndProjectConversationOutput(params: { db: SupabaseClient; ownerId: string; conversationOutputId: string; generate?: typeof generateSemanticInterpretation }) {
  const { db, ownerId, conversationOutputId } = params;
  const existing = await db.from("conversation_interpretations").select("id,interpretation").eq("conversation_output_id", conversationOutputId).eq("tenant_user_id", ownerId).eq("interpretation_schema_version", CONVERSATION_INTERPRETATION_V1).maybeSingle();
  if (existing.error) throw new ConversationInterpretationError("persistence_failed", "Could not inspect interpretation state");
  let interpretationId: string; let interpretation: ConversationInterpretationV1; let interpretationReplayed: boolean;
  if (existing.data) {
    interpretationId = String(existing.data.id); interpretation = existing.data.interpretation as ConversationInterpretationV1; interpretationReplayed = true;
  } else {
    const outputResult = await db.from("voice_conversation_outputs").select("id,tenant_user_id,conversation_id,mission_id,worker_brief_id,transcript,transcript_status").eq("id", conversationOutputId).eq("tenant_user_id", ownerId).maybeSingle();
    if (outputResult.error || !outputResult.data) throw new ConversationInterpretationError("not_found", "Conversation output not found");
    const output = outputResult.data;
    if (output.transcript_status !== "finalized" || !Array.isArray(output.transcript) || output.transcript.length === 0) throw new ConversationInterpretationError("not_finalized", "Conversation transcript is not finalized");
    const missionResult = await db.from("operating_missions").select("id,lead_id,objective,qualification_goal,desired_next_step").eq("id", output.mission_id).eq("owner_id", ownerId).maybeSingle();
    const briefResult = await db.from("worker_briefs").select("id,mission_id,objective,desired_outcome,success_criteria").eq("id", output.worker_brief_id).maybeSingle();
    if (missionResult.error || briefResult.error || !missionResult.data || !briefResult.data || String(briefResult.data.mission_id) !== String(output.mission_id)) throw new ConversationInterpretationError("not_found", "Trusted mission lineage not found");
    const transcript = output.transcript as ConversationTranscriptTurn[];
    const semantic = await (params.generate || generateSemanticInterpretation)(transcript, { mission: missionResult.data, workerBrief: briefResult.data });
    interpretation = validateConversationInterpretationV1(semantic, { conversationOutputId, conversationId: String(output.conversation_id), missionId: String(output.mission_id), workerBriefId: String(output.worker_brief_id), leadId: String(missionResult.data.lead_id) }, transcript);
    const persisted = await db.rpc("zeya_persist_conversation_interpretation", { p_owner_id: ownerId, p_conversation_output_id: conversationOutputId, p_schema_version: CONVERSATION_INTERPRETATION_V1, p_interpretation: interpretation, p_model_provider: "openai", p_model_name: process.env.P28_INTERPRETATION_MODEL || "gpt-5-mini", p_model_metadata: {} });
    if (persisted.error) throw new ConversationInterpretationError(persisted.error.code === "PZ409" ? "conflict" : "persistence_failed", "Could not persist interpretation");
    const row = Array.isArray(persisted.data) ? persisted.data[0] : persisted.data;
    interpretationId = String(row.interpretation_id); interpretationReplayed = Boolean(row.replayed);
  }
  const projected = await db.rpc("zeya_project_conversation_interpretation", { p_owner_id: ownerId, p_interpretation_id: interpretationId });
  if (projected.error) throw new ConversationInterpretationError(projected.error.code === "PZ409" ? "conflict" : "persistence_failed", "Could not project mission outcome");
  const projection = Array.isArray(projected.data) ? projected.data[0] : projected.data;
  return { interpretationId, interpretation, interpretationReplayed, outcomeId: String(projection.outcome_id), outcomeReplayed: Boolean(projection.replayed) };
}
