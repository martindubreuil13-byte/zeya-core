import type { ConversationTranscriptTurn } from "../../lib/voice/conversation-output/types";

export const augustTranscript: ConversationTranscriptTurn[] = [
  { role: "customer", text: "I'm struggling to get investors to pay attention." },
  { role: "agent", text: "What makes that difficult?" },
  { role: "customer", text: "People don't read my emails and I don't get a chance to pitch." },
  { role: "customer", text: "I use cold email and LinkedIn messages, but engagement is low." },
  { role: "agent", text: "What is the service called?" },
  { role: "customer", text: "People economics." },
  { role: "agent", text: "People economics?" },
  { role: "customer", text: "No, a service." },
  { role: "customer", text: "I have to go. Can you call me back another time?" },
  { role: "agent", text: "I'll make a note to reach out again soon." },
];

export const trustedIdentity = {
  conversationOutputId: "082089d5-bb92-4f1a-9dd1-47f3a4395ae8",
  conversationId: "sanitized-conversation",
  missionId: "05cfbdd3-60d0-4a1b-bada-98b9629ff889",
  workerBriefId: "p25_brief_sanitized",
  leadId: "11111111-1111-4111-8111-111111111111",
};

export const augustSemantics = {
  callResult: { contacted: true, completed: true },
  qualification: { result: "unknown", reasons: ["The call ended before qualification was established."], confidence: 0.96 },
  prospectIntelligence: [
    { kind: "pain", summary: "Has difficulty securing investor attention and pitch opportunities.", sourceTurns: [0, 2], basis: "explicit_statement", confidence: 0.98, uncertainty: null, temporalScope: "current_prospect_state" },
    { kind: "channel", summary: "Uses cold email and LinkedIn outreach with low engagement.", sourceTurns: [3], basis: "explicit_statement", confidence: 0.99, uncertainty: null, temporalScope: "current_prospect_state" },
    { kind: "misunderstanding", summary: "An unclear phrase may refer to a service, but its name and meaning are not established.", sourceTurns: [5, 7], basis: "inference", confidence: 0.55, uncertainty: { kind: "asr", explanation: "The rendered phrase is contradicted by the prospect's correction and needs clarification." }, temporalScope: "this_call" },
    { kind: "follow_up_request", summary: "The prospect requested a callback at an unspecified time.", sourceTurns: [8], basis: "explicit_statement", confidence: 0.99, uncertainty: null, temporalScope: "this_call" },
  ],
  followUp: { requested: true, requestedBy: "prospect", requestedTiming: null, scheduled: false, scheduledFor: null, agentAcknowledged: true, agentCommittedToFollowUp: true },
  uncertainties: [{ kind: "asr", summary: "The phrase rendered as ‘People economics’ is unclear; the prospect appears to mean a service, whose identity remains unknown.", sourceTurns: [5, 6, 7], impact: "Do not treat it as a confirmed service name or business fact; ask for clarification." }],
  businessLearningSignals: [],
  executiveSummary: "The prospect was contacted and described difficulty gaining investor attention through cold email and LinkedIn. Qualification remains unknown because the prospect ended the call and requested a callback.",
  recommendedNextAction: { action: "Arrange a callback time with the prospect.", rationale: "A callback was requested but no time was scheduled.", ownerApprovalRequired: false },
  ownerEscalation: { required: false, reasons: [] },
  overallConfidence: 0.9,
};
