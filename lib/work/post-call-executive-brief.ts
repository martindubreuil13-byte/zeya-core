import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationInterpretationV1 } from "@/lib/work/conversation-interpretation";

export const POST_CALL_EXECUTIVE_BRIEF_V1 = "post-call-executive-brief-v1" as const;

export type BusinessLearningReviewItem = {
  kind: ConversationInterpretationV1["businessLearningSignals"][number]["kind"];
  summary: string;
  requiresOwnerReview: true;
};

export type PostCallExecutiveBriefV1 = {
  schemaVersion: typeof POST_CALL_EXECUTIVE_BRIEF_V1;
  missionId: string;
  conversationOutputId: string;
  interpretationId: string;
  missionOutcomeId: string;
  outcome: { contacted: boolean; qualification: "qualified" | "not_qualified" | "unknown"; meetingBooked: boolean };
  whatHappened: string;
  prospectState: string[];
  followUp: { required: boolean; requestedByProspect: boolean; scheduled: boolean; obligation: string | null };
  whatWeDidNotLearn: string[];
  recommendedNextAction: string;
  ownerAttention: { level: "remember" | "report" | "recommend" | "escalate" | "approval"; reasons: string[] };
  reviewItems: BusinessLearningReviewItem[];
};

export type MissionOutcomeRow = {
  id: string; mission_id: string; result_operation_id: string; contact_result: string;
  qualification_result: string; meeting_result: string; owner_escalation_required: boolean;
  follow_up_required: boolean; summary: string; next_action: string;
  source_conversation_id: string; source_job_id: string;
};

export class ExecutiveBriefError extends Error {
  constructor(public readonly code: "mission_not_found" | "not_ready" | "lineage_conflict" | "read_failed") { super(code); }
}

function safeProspectState(interpretation: ConversationInterpretationV1): string[] {
  return interpretation.prospectIntelligence
    .filter(item => !item.uncertainty && item.kind !== "qualification")
    .map(item => item.summary);
}

export function projectPostCallExecutiveBriefV1(input: {
  interpretationId: string; interpretation: ConversationInterpretationV1;
  missionOutcomeId: string; outcome: MissionOutcomeRow;
}): PostCallExecutiveBriefV1 {
  const { interpretation, outcome } = input;
  const expectedContact = interpretation.callResult.contacted ? "contacted" : "not_reached";
  if (outcome.mission_id !== interpretation.missionId || outcome.result_operation_id !== input.interpretationId ||
      outcome.source_conversation_id !== interpretation.conversationId || outcome.source_job_id !== interpretation.workerBriefId ||
      outcome.contact_result !== expectedContact || outcome.qualification_result !== interpretation.qualification.result ||
      outcome.follow_up_required !== (interpretation.followUp.requested || interpretation.followUp.agentCommittedToFollowUp) ||
      outcome.owner_escalation_required !== interpretation.ownerEscalation.required) {
    throw new ExecutiveBriefError("lineage_conflict");
  }

  const requestedByProspect = interpretation.followUp.requested && interpretation.followUp.requestedBy === "prospect";
  const scheduled = interpretation.followUp.scheduled;
  const required = outcome.follow_up_required;
  const obligation = required
    ? scheduled ? "Honor the scheduled follow-up." : requestedByProspect
      ? "Arrange the requested follow-up; no time has been scheduled."
      : "Arrange the committed follow-up; no time has been scheduled."
    : null;
  const recommendedNextAction = requestedByProspect && !scheduled
    ? "Arrange the requested callback before drawing broader conclusions."
    : required && !scheduled
      ? "Arrange the committed follow-up before drawing broader conclusions."
      : interpretation.uncertainties.length
        ? "Clarify the material unknowns before acting on broader conclusions."
        : outcome.next_action;
  const unknowns: string[] = [];
  if (interpretation.qualification.result === "unknown") unknowns.push("Whether the prospect meets the mission's qualification criteria.");
  if (required && !interpretation.followUp.requestedTiming && !scheduled) unknowns.push("When the follow-up should happen.");
  unknowns.push(...interpretation.uncertainties.map(item => `${item.summary} ${item.impact}`));

  const status = [
    interpretation.callResult.contacted ? "The prospect was reached." : "The prospect was not reached.",
    ...safeProspectState(interpretation).filter(summary => !/callback|follow-up/i.test(summary)),
    interpretation.qualification.result === "unknown" ? "Qualification remains unknown." : `The prospect was ${interpretation.qualification.result === "qualified" ? "qualified" : "not qualified"}.`,
    requestedByProspect && !scheduled ? "They requested a callback, but no time was scheduled." : "",
    interpretation.uncertainties.length ? "Material uncertainty was kept out of confirmed prospect state." : "",
  ].filter(Boolean);

  let level: PostCallExecutiveBriefV1["ownerAttention"]["level"] = "remember";
  let reasons: string[] = [];
  if (outcome.owner_escalation_required) { level = "escalate"; reasons = interpretation.ownerEscalation.reasons; }
  else if (required || interpretation.recommendedNextAction.action) {
    level = "recommend";
    reasons = requestedByProspect && !scheduled ? ["Callback requested but not scheduled."] : [interpretation.recommendedNextAction.rationale];
  } else if (interpretation.callResult.contacted || interpretation.businessLearningSignals.length) level = "report";

  return {
    schemaVersion: POST_CALL_EXECUTIVE_BRIEF_V1,
    missionId: interpretation.missionId,
    conversationOutputId: interpretation.conversationOutputId,
    interpretationId: input.interpretationId,
    missionOutcomeId: input.missionOutcomeId,
    outcome: { contacted: interpretation.callResult.contacted, qualification: interpretation.qualification.result, meetingBooked: outcome.meeting_result === "booked" },
    whatHappened: status.join(" "),
    prospectState: safeProspectState(interpretation),
    followUp: { required, requestedByProspect, scheduled, obligation },
    whatWeDidNotLearn: unknowns,
    recommendedNextAction,
    ownerAttention: { level, reasons },
    reviewItems: interpretation.businessLearningSignals.map(signal => ({ kind: signal.kind, summary: signal.summary, requiresOwnerReview: true })),
  };
}

export async function getPostCallExecutiveBrief(db: SupabaseClient, ownerId: string, missionId: string): Promise<PostCallExecutiveBriefV1> {
  const mission = await db.from("operating_missions").select("id,business_id,business_representation_id,representation_version_id").eq("id", missionId).eq("owner_id", ownerId).maybeSingle();
  if (mission.error) throw new ExecutiveBriefError("read_failed");
  if (!mission.data) throw new ExecutiveBriefError("mission_not_found");
  const outcomeResult = await db.from("mission_execution_outcomes").select("id,mission_id,result_operation_id,contact_result,qualification_result,meeting_result,owner_escalation_required,follow_up_required,summary,next_action,source_conversation_id,source_job_id").eq("mission_id", missionId).eq("owner_id", ownerId).maybeSingle();
  if (outcomeResult.error) throw new ExecutiveBriefError("read_failed");
  if (!outcomeResult.data) throw new ExecutiveBriefError("not_ready");
  const outcome = outcomeResult.data as MissionOutcomeRow;
  const interpretationResult = await db.from("conversation_interpretations").select("id,interpretation,mission_id,tenant_user_id,business_id,business_representation_id,canonical_version_id,conversation_output_id,worker_brief_id").eq("id", outcome.result_operation_id).eq("mission_id", missionId).eq("tenant_user_id", ownerId).maybeSingle();
  if (interpretationResult.error) throw new ExecutiveBriefError("read_failed");
  if (!interpretationResult.data) throw new ExecutiveBriefError("not_ready");
  const row = interpretationResult.data;
  const interpretation = row.interpretation as ConversationInterpretationV1;
  if (interpretation.schemaVersion !== "conversation-interpretation-v1" || row.conversation_output_id !== interpretation.conversationOutputId || row.worker_brief_id !== interpretation.workerBriefId ||
      row.business_id !== mission.data.business_id || row.business_representation_id !== mission.data.business_representation_id || row.canonical_version_id !== mission.data.representation_version_id) throw new ExecutiveBriefError("lineage_conflict");
  return projectPostCallExecutiveBriefV1({ interpretationId: row.id, interpretation, missionOutcomeId: outcome.id, outcome });
}
