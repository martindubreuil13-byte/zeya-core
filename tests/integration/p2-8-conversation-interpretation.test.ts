import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CONVERSATION_INTERPRETATION_V1, projectMissionOutcome, validateConversationInterpretationV1 } from "../../lib/work/conversation-interpretation";
import { augustSemantics, augustTranscript, trustedIdentity } from "../fixtures/p2-8-august-conversation";

const validate = (value: unknown = augustSemantics) => validateConversationInterpretationV1(value, trustedIdentity, augustTranscript);

describe("P2.8 conversation interpretation", () => {
  it("derives a prospect-scoped August interpretation from a provider-neutral transcript", () => {
    const result = validate();
    expect(result.schemaVersion).toBe(CONVERSATION_INTERPRETATION_V1);
    expect(result.prospectIntelligence.map(item => item.kind)).toEqual(["pain", "channel", "misunderstanding", "follow_up_request"]);
    expect(result.qualification.result).toBe("unknown");
    expect(result.callResult.contacted).toBe(true);
  });

  it("injects exact trusted lineage instead of accepting model-generated IDs", () => {
    const result = validate({ ...augustSemantics, missionId: "model-invented", leadId: "model-invented" });
    expect(result).toMatchObject(trustedIdentity);
  });

  it("rejects malformed source turns", () => {
    const bad = structuredClone(augustSemantics); bad.prospectIntelligence[0].sourceTurns = [999];
    expect(() => validate(bad)).toThrow("invalid source turn");
  });

  it("rejects unsupported inference and agent-only support", () => {
    const noUncertainty = structuredClone(augustSemantics); delete (noUncertainty.prospectIntelligence[2] as { uncertainty?: unknown }).uncertainty;
    expect(() => validate(noUncertainty)).toThrow("inference requires explicit uncertainty");
    const agentOnly = structuredClone(augustSemantics); agentOnly.prospectIntelligence[0].sourceTurns = [1];
    expect(() => validate(agentOnly)).toThrow("agent speech");
  });

  it("keeps People economics uncertain and does not create business truth", () => {
    const result = validate();
    expect(result.uncertainties).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "asr", sourceTurns: [5, 6, 7] })]));
    expect(result.prospectIntelligence.find(item => item.sourceTurns.includes(5))).toMatchObject({ kind: "misunderstanding", basis: "inference" });
    expect(result.businessLearningSignals).toHaveLength(0);
    expect(JSON.stringify(result.businessLearningSignals)).not.toMatch(/People economics/i);
  });

  it("separates callback request, scheduling, acknowledgement, and commitment", () => {
    expect(validate().followUp).toEqual({ requested: true, requestedBy: "prospect", requestedTiming: null, scheduled: false, scheduledFor: null, agentAcknowledged: true, agentCommittedToFollowUp: true });
  });

  it("rejects manufactured scheduling state", () => {
    const bad = structuredClone(augustSemantics) as unknown as { followUp: { scheduledFor: string | null } }; bad.followUp.scheduledFor = "tomorrow";
    expect(() => validate(bad)).toThrow("follow-up state is inconsistent");
  });

  it("projects only supported mission outcome fields deterministically", () => {
    expect(projectMissionOutcome(validate())).toEqual({ contactResult: "contacted", qualificationResult: "unknown", meetingResult: "not_booked", ownerEscalationRequired: false, followUpRequired: true, summary: augustSemantics.executiveSummary, nextAction: "Arrange a callback time with the prospect.", sourceConversationId: trustedIdentity.conversationId, sourceJobId: trustedIdentity.workerBriefId });
  });

  it("requires owner review for every business-learning signal", () => {
    const bad = structuredClone(augustSemantics); bad.businessLearningSignals = [{ kind: "positioning", summary: "A prospect opinion", sourceTurns: [0], confidence: 0.5, requiresOwnerReview: false }] as never;
    expect(() => validate(bad)).toThrow("require owner review");
  });

  it("implements immutable versioned interpretation identity and exact replay/conflict", async () => {
    const sql = await readFile("supabase/migrations/20260822000000_p28_conversation_interpretation.sql", "utf8");
    expect(sql).toContain("UNIQUE(conversation_output_id,interpretation_schema_version)");
    expect(sql).toContain("interpretation version conflicts");
    expect(sql).toContain("RETURN QUERY SELECT v_existing.id,true");
    expect(sql).toContain("^conversation-interpretation-v[1-9][0-9]*$");
    expect(sql).toContain("BEFORE UPDATE OR DELETE");
  });

  it("requires finalized nonempty transcript and exact output/mission/brief lineage", async () => {
    const sql = await readFile("supabase/migrations/20260822000000_p28_conversation_interpretation.sql", "utf8");
    expect(sql).toContain("v_output.transcript_status<>'finalized'");
    expect(sql).toContain("jsonb_array_length(v_output.transcript)=0");
    expect(sql).toContain("conversation lineage does not match mission");
    expect(sql).toContain("p_interpretation->>'workerBriefId' IS DISTINCT FROM v_brief.id");
  });

  it("makes mission projection idempotent and model-independent", async () => {
    const sql = await readFile("supabase/migrations/20260822000000_p28_conversation_interpretation.sql", "utf8");
    expect(sql).toContain("mission outcome conflicts");
    expect(sql).toContain("RETURN QUERY SELECT v_existing.id,true");
    const projector = sql.slice(sql.indexOf("CREATE FUNCTION public.zeya_project_conversation_interpretation"));
    expect(projector).not.toMatch(/openai|model_name|voice_conversation_candidates/i);
  });

  it("does not mutate candidates, learning, representation, mandate, authority, or mission lifecycle", async () => {
    const sql = await readFile("supabase/migrations/20260822000000_p28_conversation_interpretation.sql", "utf8");
    for (const forbidden of ["voice_conversation_candidates", "conversation_candidate_reviews", "representation_proposals", "representation_evidence", "representation_observations", "representation_authority", "direct_hire_mandates"]) expect(sql).not.toContain(`INSERT INTO public.${forbidden}`);
    expect(sql).not.toMatch(/UPDATE public\.(operating_missions|voice_conversation_candidates|representation_versions)/);
    expect(sql).toMatch(/INSERT INTO public\.mission_execution_outcomes/);
  });

  it("uses conversation output rather than provider webhook structures or candidates", async () => {
    const service = await readFile("lib/work/conversation-interpretation.ts", "utf8");
    expect(service).toContain('.from("voice_conversation_outputs")');
    expect(service).not.toMatch(/ElevenLabs|webhook|voice_conversation_candidates/);
  });
});
