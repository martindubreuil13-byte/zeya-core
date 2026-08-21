import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { augustSemantics, augustTranscript, trustedIdentity } from "../fixtures/p2-8-august-conversation";
import { validateConversationInterpretationV1 } from "../../lib/work/conversation-interpretation";
import { ExecutiveBriefError, projectPostCallExecutiveBriefV1, type MissionOutcomeRow } from "../../lib/work/post-call-executive-brief";

const interpretation = validateConversationInterpretationV1(augustSemantics, trustedIdentity, augustTranscript);
const outcome: MissionOutcomeRow = {
  id: "6efe2d1a-e3bf-4eed-a81b-8291580bbf6a", mission_id: trustedIdentity.missionId,
  result_operation_id: "521ef6e3-62b3-4064-90e5-d06c0aca0b95", contact_result: "contacted",
  qualification_result: "unknown", meeting_result: "not_booked", owner_escalation_required: false,
  follow_up_required: true, summary: augustSemantics.executiveSummary,
  next_action: augustSemantics.recommendedNextAction.action,
  source_conversation_id: trustedIdentity.conversationId, source_job_id: trustedIdentity.workerBriefId,
};
const project = (next = outcome) => projectPostCallExecutiveBriefV1({ interpretationId: outcome.result_operation_id, interpretation, missionOutcomeId: outcome.id, outcome: next });

describe("P2.9A post-call executive intelligence", () => {
  it("projects the August brief deterministically from governed state", () => {
    const brief = project();
    expect(brief).toMatchObject({ schemaVersion: "post-call-executive-brief-v1", missionId: trustedIdentity.missionId,
      conversationOutputId: trustedIdentity.conversationOutputId, interpretationId: outcome.result_operation_id,
      missionOutcomeId: outcome.id, outcome: { contacted: true, qualification: "unknown", meetingBooked: false },
      followUp: { required: true, requestedByProspect: true, scheduled: false },
      ownerAttention: { level: "recommend", reasons: ["Callback requested but not scheduled."] }, reviewItems: [] });
    expect(brief.followUp.obligation).toBe("Arrange the requested follow-up; no time has been scheduled.");
    expect(brief.recommendedNextAction).toBe("Arrange the requested callback before drawing broader conclusions.");
  });

  it("keeps uncertainty under unknowns and out of confirmed prospect state", () => {
    const brief = project();
    expect(brief.whatWeDidNotLearn.join(" ")).toContain("People economics");
    expect(brief.whatWeDidNotLearn).toContain("Whether the prospect meets the mission's qualification criteria.");
    expect(brief.whatWeDidNotLearn).toContain("When the follow-up should happen.");
    expect(brief.prospectState.join(" ")).not.toContain("People economics");
    expect(brief.whatHappened).not.toContain("People economics");
    expect(brief.recommendedNextAction).not.toContain("People economics");
  });

  it("does not escalate routine callback, unknown qualification, or ASR uncertainty", () => {
    expect(project().ownerAttention.level).toBe("recommend");
  });

  it("requires exact mission, interpretation, conversation, brief, and outcome lineage", () => {
    for (const patch of [{ mission_id: crypto.randomUUID() }, { result_operation_id: crypto.randomUUID() }, { source_conversation_id: "other" }, { source_job_id: "other" }, { qualification_result: "qualified" }]) {
      expect(() => project({ ...outcome, ...patch })).toThrowError(ExecutiveBriefError);
    }
  });

  it("has no model or mutation path in the projection, route, or owner card", () => {
    const files = ["lib/work/post-call-executive-brief.ts", "app/api/work/missions/[missionId]/executive-brief/route.ts", "components/briefing-room/PostCallExecutiveBriefCard.tsx"];
    const source = files.map(file => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");
    expect(source).not.toMatch(/OpenAI|responses\.create|ElevenLabs/);
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
    expect(source).not.toMatch(/accepted_for_promotion|canonicalize|representation_versions|conversation_output_candidates/);
    expect(source).not.toMatch(/request\.json|method:\s*["']POST/);
  });
});
