import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FixtureRegistry } from "./representation-state-test-fixtures";
import { cleanupFixtures } from "./representation-state-test-cleanup";
import { jsonRequest } from "./representation-state-test-client";
import { startTestServer } from "./representation-state-test-server";

type UserFixture = { id: string; token: string; client: SupabaseClient };
type Tenant = { user: UserFixture; businessId: string; representationId: string; versionId: string; elementId: string };
type PromotionResult = { reviewDecisionId: string; promotionId: string; targetType: string; targetId: string; idempotent: boolean };
type PromotionApiBody = { success: boolean; data?: PromotionResult; error?: string };

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Conversation Review Deployed: ${message}`);
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && publishable && serviceKey, "required environment unavailable");
  const server = await startTestServer();
  const registry = new FixtureRegistry();
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anonymous = createClient(url, publishable, { auth: { persistSession: false } });
  let cleanup: Awaited<ReturnType<typeof cleanupFixtures>> | undefined;

  async function createUser(label: string): Promise<UserFixture> {
    const email = `conversation-review-${label}-${registry.runId}@zeya.test`;
    const password = `T-${crypto.randomUUID()}!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    registry.registerAuthUser(created.data.user.id, email);
    const publicClient = createClient(url!, publishable!, { auth: { persistSession: false } });
    const signed = await publicClient.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw signed.error ?? new Error("authentication failed");
    return {
      id: created.data.user.id,
      token: signed.data.session.access_token,
      client: createClient(url!, publishable!, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${signed.data.session.access_token}` } },
      }),
    };
  }

  async function createTenant(label: string): Promise<Tenant> {
    const user = await createUser(label);
    const business = await user.client.from("businesses").insert({ business_name: `Conversation Review ${label} ${registry.runId}`, user_id: user.id }).select().single();
    if (business.error) throw business.error;
    registry.registerBusiness(business.data.id, user.id);
    const evidence = await jsonRequest<{ data: { businessRepresentationId: string; evidenceId: string; observationId: string; proposalId: string } }>(server.baseUrl, "/api/representation/evidence", {
      method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ businessId: business.data.id, statement: `conversation review fixture ${label}` }),
    });
    assert(evidence.status === 201, `${label} Representation initialization`);
    const representationId = evidence.body.data.businessRepresentationId;
    registry.registerBusinessRepresentation(representationId, business.data.id);
    registry.registerEvidence(evidence.body.data.evidenceId); registry.registerObservation(evidence.body.data.observationId); registry.registerProposal(evidence.body.data.proposalId);
    const version = await jsonRequest<{ data: { versionId: string; confidenceAssessmentId: string } }>(server.baseUrl, "/api/representation/versions", {
      method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ businessRepresentationId: representationId, proposalId: evidence.body.data.proposalId, elementValues: { approved_key: { value: `approved ${label}` } }, confidenceScore: 85 }),
    });
    assert(version.status === 201, `${label} canonical Version`);
    registry.registerVersion(version.body.data.versionId); registry.registerConfidenceAssessment(version.body.data.confidenceAssessmentId);
    const domain = await user.client.from("representation_domains").select("id").eq("business_representation_id", representationId).eq("domain_name", "customer").single();
    if (domain.error) throw domain.error;
    registry.registerDomain(domain.data.id);
    const element = await user.client.from("representation_elements").insert({ business_representation_id: representationId, representation_domain_id: domain.data.id, element_key: "approved_key", element_type: "fact", current_value_version_id: version.body.data.versionId, is_disputed: false, claim_eligibility: "approved_for_external_use", field_sensitivity: "strategic_positioning" }).select().single();
    if (element.error) throw element.error;
    registry.registerElement(element.data.id);
    return { user, businessId: business.data.id, representationId, versionId: version.body.data.versionId, elementId: element.data.id };
  }

  async function createConversation(tenant: Tenant, label: string, candidates: Array<Record<string, unknown>>) {
    const voiceContextId = crypto.randomUUID();
    const conversationId = `review-${label}-${registry.runId}`;
    const lineage = await service.rpc("zeya_create_voice_representation_lineage", {
      p_voice_context_id: voiceContextId, p_worker_brief_id: `brief-${label}-${registry.runId}`,
      p_mission_id: `mission-${label}-${registry.runId}`, p_conversation_id: conversationId,
      p_tenant_user_id: tenant.user.id, p_business_id: tenant.businessId,
      p_business_representation_id: tenant.representationId, p_canonical_version_id: tenant.versionId,
      p_context_generated_at: new Date().toISOString(), p_authorized_element_keys: ["approved_key"],
      p_provisional_mode: false, p_agent_id: "veya-caller", p_agent_type: "CALLER", p_agent_role: "test",
      p_context_schema_version: "1.0", p_prompt_assembly_version: "1.0",
    });
    if (lineage.error) throw lineage.error;
    registry.registerVoiceLineage(voiceContextId, tenant.representationId);
    const captured = await service.rpc("zeya_capture_voice_conversation_output", {
      p_voice_context_id: voiceContextId, p_conversation_id: conversationId, p_provider_call_id: null,
      p_provider: "elevenlabs", p_channel: "veya_outbound", p_capture_source: "provider_callback",
      p_transcript_trust_level: "provider_attested", p_provider_attested: true, p_submitted_by: null,
      p_started_at: "2026-07-16T01:00:00.000Z", p_completed_at: "2026-07-16T01:01:00.000Z",
      p_transcript: [{ role: "customer", text: "Customer source statement" }, { role: "agent", text: "Agent response" }],
      p_transcript_status: "finalized", p_transcript_schema_version: "1.0", p_conversation_status: "done",
      p_completion_reason: "provider_completed", p_extraction_schema_version: "1.0", p_safe_metadata: { turnCount: 2 },
    });
    if (captured.error || typeof captured.data !== "string") throw captured.error ?? new Error("capture failed");
    registry.registerVoiceOutput(captured.data, tenant.representationId);
    const stored = await service.rpc("zeya_store_voice_conversation_candidates", { p_conversation_output_id: captured.data, p_extraction_schema_version: "1.0", p_candidates: candidates });
    if (stored.error) throw stored.error;
    const rows = await service.from("voice_conversation_candidates").select("*").eq("conversation_output_id", captured.data).order("extraction_ordinal");
    if (rows.error) throw rows.error;
    rows.data.forEach((row) => registry.registerVoiceCandidate(row.id, tenant.representationId));
    return rows.data;
  }

  const candidate = (candidateType: string, overrides: Record<string, unknown> = {}) => ({
    candidateType, content: { summary: `${candidateType} content` }, speakerRole: "customer", statementKind: "assertion",
    sourceReference: { turnIndexes: [0] }, relevantElementKeys: ["approved_key"], confidence: 0.8,
    rationale: "supported by the provider-attested customer turn", ...overrides,
  });
  const promote = (client: SupabaseClient, candidateId: string, target: string, requestKey: string, statement: string, elementId: string | null = null, elementKey: string | null = null) => client.rpc("zeya_promote_voice_conversation_candidate", {
    p_candidate_id: candidateId, p_target_type: target, p_request_key: requestKey,
    p_confirmed_content: { statement, ...(elementKey ? { elementKey } : {}) }, p_reason: "Founder confirmed",
    p_related_element_id: elementId, p_evidence_source_type: "conversation",
  });

  let phase = "fixture setup";
  try {
    phase = "owner fixture";
    const owner = await createTenant("owner");
    phase = "foreign fixture";
    const foreign = await createTenant("foreign");
    phase = "conversation fixture";
    const canonicalBefore = await service.from("business_representations").select("current_version_id").eq("id", owner.representationId).single();
    const rows = await createConversation(owner, "main", [
      candidate("candidate_evidence"), candidate("customer_need"), candidate("possible_representation_gap"),
      candidate("customer_question"), candidate("objection"), candidate("qualification_signal"), candidate("candidate_evidence"),
    ]);
    const [evidenceCandidate, observationCandidate, proposalCandidate, deferredCandidate, rejectedCandidate, acknowledgedCandidate, concurrentCandidate] = rows;

    phase = "review behavior";
    const nullCases = [
      { p_candidate_id: null, p_decision: "deferred", p_request_key: crypto.randomUUID(), p_reason: null },
      { p_candidate_id: deferredCandidate.id, p_decision: null, p_request_key: crypto.randomUUID(), p_reason: null },
      { p_candidate_id: deferredCandidate.id, p_decision: "deferred", p_request_key: null, p_reason: null },
    ];
    for (const body of nullCases) {
      const result = await owner.user.client.rpc("zeya_review_voice_conversation_candidate", body);
      assert(result.error?.code === "22023", "review null validation is controlled");
    }
    assert((await owner.user.client.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: deferredCandidate.id, p_decision: "deferred", p_request_key: crypto.randomUUID(), p_reason: "x".repeat(2001) })).error?.code === "22023", "review reason length validation");
    assert((await owner.user.client.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: deferredCandidate.id, p_decision: "accepted_for_promotion", p_request_key: crypto.randomUUID(), p_reason: null })).error?.code === "22023", "review-only promotion decision blocked");
    assert((await foreign.user.client.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: deferredCandidate.id, p_decision: "deferred", p_request_key: crypto.randomUUID(), p_reason: null })).error?.code === "PZ404", "foreign review generic unavailable");
    assert((await anonymous.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: deferredCandidate.id, p_decision: "deferred", p_request_key: crypto.randomUUID(), p_reason: null })).error, "anon review RPC blocked");
    assert((await service.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: deferredCandidate.id, p_decision: "deferred", p_request_key: crypto.randomUUID(), p_reason: null })).error, "service review RPC blocked");
    const deferKey = crypto.randomUUID();
    const deferred = await owner.user.client.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: deferredCandidate.id, p_decision: "deferred", p_request_key: deferKey, p_reason: "Review later" });
    assert(!deferred.error && deferred.data.idempotent === false, "deferred review succeeds");
    registry.registerConversationReview(deferred.data.reviewDecisionId, owner.representationId);
    const replay = await owner.user.client.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: deferredCandidate.id, p_decision: "deferred", p_request_key: deferKey, p_reason: "Review later" });
    assert(!replay.error && replay.data.reviewDecisionId === deferred.data.reviewDecisionId && replay.data.idempotent, "review exact replay");
    assert((await owner.user.client.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: deferredCandidate.id, p_decision: "duplicate", p_request_key: deferKey, p_reason: "different" })).error?.code === "23505", "review request-key conflict");
    const terminal = await owner.user.client.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: deferredCandidate.id, p_decision: "duplicate", p_request_key: crypto.randomUUID(), p_reason: "Duplicate" });
    assert(!terminal.error, "deferred advances to terminal"); registry.registerConversationReview(terminal.data.reviewDecisionId, owner.representationId);
    assert((await owner.user.client.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: deferredCandidate.id, p_decision: "rejected", p_request_key: crypto.randomUUID(), p_reason: null })).error?.code === "23505", "terminal review cannot change");
    for (const [row, decision] of [[rejectedCandidate, "rejected"], [acknowledgedCandidate, "acknowledged"]] as const) {
      const result = await owner.user.client.rpc("zeya_review_voice_conversation_candidate", { p_candidate_id: row.id, p_decision: decision, p_request_key: crypto.randomUUID(), p_reason: null });
      if (result.error) throw result.error; registry.registerConversationReview(result.data.reviewDecisionId, owner.representationId);
    }

    phase = "Evidence promotion";
    const evidenceKey = crypto.randomUUID();
    const evidencePromotion = await promote(owner.user.client, evidenceCandidate.id, "evidence", evidenceKey, "Confirmed customer Evidence");
    if (evidencePromotion.error) throw evidencePromotion.error;
    const evidenceResult = evidencePromotion.data as PromotionResult;
    registry.registerConversationReview(evidenceResult.reviewDecisionId, owner.representationId); registry.registerConversationPromotion(evidenceResult.promotionId, owner.representationId);
    const evidenceRow = await service.from("evidence").select("*").eq("id", evidenceResult.targetId).single();
    assert(!evidenceRow.error && evidenceRow.data.business_representation_id === owner.representationId && evidenceRow.data.raw_statement === "Confirmed customer Evidence" && evidenceRow.data.source_type === "conversation", "Evidence promotion provenance");
    registry.registerEvidence(evidenceResult.targetId);
    const evidenceReplay = await promote(owner.user.client, evidenceCandidate.id, "evidence", evidenceKey, "Confirmed customer Evidence");
    assert(!evidenceReplay.error && evidenceReplay.data.promotionId === evidenceResult.promotionId && evidenceReplay.data.idempotent, "promotion same-key replay");
    assert((await promote(owner.user.client, evidenceCandidate.id, "evidence", evidenceKey, "Changed Evidence")).error?.code === "23505", "promotion same-key conflict");
    const converged = await promote(owner.user.client, evidenceCandidate.id, "evidence", crypto.randomUUID(), "Confirmed customer Evidence");
    assert(!converged.error && converged.data.promotionId === evidenceResult.promotionId && converged.data.idempotent, "different-key configuration convergence");
    assert((await promote(owner.user.client, evidenceCandidate.id, "evidence", crypto.randomUUID(), "Changed Evidence")).error?.code === "23505", "different configuration conflicts");

    phase = "Observation promotion";
    const observationRequestKey = crypto.randomUUID();
    const observationPromotion = await jsonRequest<PromotionApiBody>(server.baseUrl, "/api/voice/conversation-review", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${owner.user.token}` },
      body: JSON.stringify({
        action: "promote",
        candidateId: observationCandidate.id,
        requestKey: observationRequestKey,
        targetType: "observation",
        statement: "Confirmed Observation",
        reason: "Founder confirmed",
        relatedElementId: owner.elementId,
        evidenceSourceType: "conversation",
      }),
    });
    assert(
      observationPromotion.status === 201 && observationPromotion.body.success && observationPromotion.body.data,
      `Observation API status/body expected 201 success; actual status=${observationPromotion.status} body=${JSON.stringify(observationPromotion.body)}`,
    );
    const observationResult = observationPromotion.body.data;
    registry.registerConversationReview(observationResult.reviewDecisionId, owner.representationId); registry.registerConversationPromotion(observationResult.promotionId, owner.representationId); registry.registerObservation(observationResult.targetId);
    const [observation, promotion, review, element] = await Promise.all([
      service.from("observations").select("id,business_representation_id,evidence_id,interpreted_meaning,confidence_in_interpretation,affected_domains,affected_elements,created_by_actor").eq("id", observationResult.targetId).single(),
      service.from("conversation_candidate_promotions").select("id,review_decision_id,candidate_id,conversation_output_id,voice_context_id,tenant_user_id,business_id,business_representation_id,canonical_version_id,reviewer_user_id,target_type,request_key,request_hash,related_element_id,evidence_id,observation_id,representation_proposal_id").eq("id", observationResult.promotionId).single(),
      service.from("conversation_candidate_review_decisions").select("id,candidate_id,conversation_output_id,voice_context_id,tenant_user_id,business_id,business_representation_id,canonical_version_id,reviewer_user_id,decision_type,request_key").eq("id", observationResult.reviewDecisionId).single(),
      service.from("representation_elements").select("id,business_representation_id,element_key,current_value_version_id").eq("id", owner.elementId).single(),
    ]);
    assert(!observation.error && observation.data, `Observation row retrieval failed: ${JSON.stringify(observation.error)}`);
    const supportingEvidence = await service.from("evidence").select("id,business_representation_id,source_type,raw_statement,captured_by_actor").eq("id", observation.data.evidence_id).single();
    const observationGraph = {
      api: { status: observationPromotion.status, body: observationPromotion.body },
      returnedTargetId: observationResult.targetId,
      observation: observation.data,
      supportingEvidence: supportingEvidence.data,
      promotion: promotion.data,
      review: review.data,
      element: element.data,
      errors: {
        supportingEvidence: supportingEvidence.error?.code ?? null,
        promotion: promotion.error?.code ?? null,
        review: review.error?.code ?? null,
        element: element.error?.code ?? null,
      },
    };
    console.log(`Observation diagnostic — ${JSON.stringify(observationGraph)}`);
    assert(observationResult.targetType === "observation", `Observation targetType expected=observation actual=${observationResult.targetType}`);
    assert(observationResult.targetId === observation.data.id, `Observation targetId expected=${observation.data.id} actual=${observationResult.targetId}`);
    assert(observationResult.idempotent === false, `Observation initial idempotent expected=false actual=${observationResult.idempotent}`);
    assert(observation.data.business_representation_id === owner.representationId, `Observation Representation expected=${owner.representationId} actual=${observation.data.business_representation_id}`);
    assert(observation.data.interpreted_meaning === "Confirmed Observation", `Observation meaning expected=Confirmed Observation actual=${observation.data.interpreted_meaning}`);
    assert(observation.data.confidence_in_interpretation === 80, `Observation confidence expected=80 actual=${observation.data.confidence_in_interpretation}`);
    assert(Array.isArray(observation.data.affected_elements) && observation.data.affected_elements.includes(owner.elementId), `Observation affected_elements expected to contain=${owner.elementId} actual=${JSON.stringify(observation.data.affected_elements)}`);
    assert(observation.data.created_by_actor === owner.user.id, `Observation actor expected=${owner.user.id} actual=${observation.data.created_by_actor}`);
    assert(!supportingEvidence.error && supportingEvidence.data?.business_representation_id === owner.representationId, `Supporting Evidence graph expected Representation=${owner.representationId} actual=${JSON.stringify(supportingEvidence)}`);
    assert(!promotion.error && promotion.data?.target_type === "observation" && promotion.data.observation_id === observationResult.targetId, `Promotion Observation identity mismatch: ${JSON.stringify(promotion)}`);
    assert(promotion.data?.evidence_id === null && promotion.data?.representation_proposal_id === null, `Promotion exact-target columns mismatch: ${JSON.stringify(promotion.data)}`);
    assert(promotion.data?.related_element_id === owner.elementId, `Promotion related Element expected=${owner.elementId} actual=${promotion.data?.related_element_id}`);
    assert(!review.error && review.data?.decision_type === "accepted_for_promotion", `Review graph mismatch: ${JSON.stringify(review)}`);
    assert(!element.error && element.data?.business_representation_id === owner.representationId && element.data.element_key === "approved_key", `Element graph mismatch: ${JSON.stringify(element)}`);
    registry.registerEvidence(observation.data.evidence_id);
    const observationReplay = await jsonRequest<PromotionApiBody>(server.baseUrl, "/api/voice/conversation-review", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${owner.user.token}` },
      body: JSON.stringify({
        action: "promote", candidateId: observationCandidate.id, requestKey: observationRequestKey,
        targetType: "observation", statement: "Confirmed Observation", reason: "Founder confirmed",
        relatedElementId: owner.elementId, evidenceSourceType: "conversation",
      }),
    });
    assert(
      observationReplay.status === 201 && observationReplay.body.data?.targetId === observationResult.targetId && observationReplay.body.data.idempotent,
      `Observation replay expected same target and idempotent=true; actual status=${observationReplay.status} body=${JSON.stringify(observationReplay.body)}`,
    );

    phase = "Proposal promotion";
    assert((await promote(owner.user.client, proposalCandidate.id, "representation_proposal", crypto.randomUUID(), "Confirmed Proposal", foreign.elementId, "approved_key")).error?.code === "22023", "foreign Element rejected");
    assert((await promote(owner.user.client, proposalCandidate.id, "representation_proposal", crypto.randomUUID(), "Confirmed Proposal", owner.elementId, "wrong_key")).error?.code === "22023", "browser Element key mismatch rejected");
    const proposalRequestKey = crypto.randomUUID();
    const [proposalElementBefore, versionsBeforeProposal, confidenceBeforeProposal, auditsBeforeProposal] = await Promise.all([
      service.from("representation_elements").select("id,business_representation_id,element_key,field_sensitivity,current_value_version_id,is_disputed,claim_eligibility").eq("id", owner.elementId).single(),
      service.from("representation_versions").select("id", { count: "exact" }).eq("business_representation_id", owner.representationId),
      service.from("confidence_assessments").select("id", { count: "exact" }).eq("business_representation_id", owner.representationId),
      service.from("audit_events").select("id", { count: "exact" }).eq("business_representation_id", owner.representationId),
    ]);
    assert(!proposalElementBefore.error && proposalElementBefore.data, `Proposal Element before-state retrieval failed: ${JSON.stringify(proposalElementBefore.error)}`);
    const proposalPromotion = await jsonRequest<PromotionApiBody>(server.baseUrl, "/api/voice/conversation-review", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${owner.user.token}` },
      body: JSON.stringify({
        action: "promote", candidateId: proposalCandidate.id, requestKey: proposalRequestKey,
        targetType: "representation_proposal", statement: "Confirmed Proposal", reason: "Founder confirmed",
        relatedElementId: owner.elementId, elementKey: "approved_key", evidenceSourceType: "conversation",
      }),
    });
    assert(
      proposalPromotion.status === 201 && proposalPromotion.body.success && proposalPromotion.body.data,
      `Proposal API expected HTTP 201 success; actual status=${proposalPromotion.status} body=${JSON.stringify(proposalPromotion.body)}`,
    );
    const proposalResult = proposalPromotion.body.data;
    assert(proposalResult.targetType === "representation_proposal", `Proposal targetType expected=representation_proposal actual=${proposalResult.targetType}`);
    assert(Boolean(proposalResult.targetId), `Proposal targetId expected UUID actual=${proposalResult.targetId}`);
    assert(Boolean(proposalResult.promotionId), `Proposal promotionId expected UUID actual=${proposalResult.promotionId}`);
    assert(Boolean(proposalResult.reviewDecisionId), `Proposal reviewDecisionId expected UUID actual=${proposalResult.reviewDecisionId}`);
    assert(proposalResult.idempotent === false, `Proposal initial idempotent expected=false actual=${proposalResult.idempotent}`);
    registry.registerConversationReview(proposalResult.reviewDecisionId, owner.representationId); registry.registerConversationPromotion(proposalResult.promotionId, owner.representationId); registry.registerProposal(proposalResult.targetId);
    const [proposal, evidenceLinks, observationLinks, elementLinks, proposalProvenance] = await Promise.all([
      service.from("representation_proposals").select("id,business_representation_id,proposed_changes,risk_tier,highest_sensitivity_class,requires_approval,status,proposed_by_actor,rationale").eq("id", proposalResult.targetId).single(),
      service.from("proposal_evidence").select("proposal_id,evidence_id,business_representation_id").eq("proposal_id", proposalResult.targetId),
      service.from("proposal_observations").select("proposal_id,observation_id,business_representation_id").eq("proposal_id", proposalResult.targetId),
      service.from("proposal_elements").select("proposal_id,element_id,business_representation_id").eq("proposal_id", proposalResult.targetId),
      service.from("conversation_candidate_promotions").select("id,review_decision_id,candidate_id,conversation_output_id,voice_context_id,tenant_user_id,business_id,business_representation_id,canonical_version_id,reviewer_user_id,target_type,request_key,request_payload,request_hash,related_element_id,evidence_id,observation_id,representation_proposal_id,extracted_content,confirmed_content").eq("id", proposalResult.promotionId).single(),
    ]);
    assert(!proposal.error && proposal.data, `representation_proposals retrieval failed: ${JSON.stringify(proposal.error)}`);
    assert(proposal.data.id === proposalResult.targetId, `Proposal ID expected=${proposalResult.targetId} actual=${proposal.data.id}`);
    assert(proposal.data.business_representation_id === owner.representationId, `Proposal Representation expected=${owner.representationId} actual=${proposal.data.business_representation_id}`);
    assert(proposal.data.risk_tier === "high", `Proposal risk expected=high actual=${proposal.data.risk_tier}`);
    assert(proposal.data.highest_sensitivity_class === proposalElementBefore.data.field_sensitivity, `Proposal sensitivity expected=${proposalElementBefore.data.field_sensitivity} actual=${proposal.data.highest_sensitivity_class}`);
    assert(proposal.data.requires_approval === true, `Proposal requires_approval expected=true actual=${proposal.data.requires_approval}`);
    assert(proposal.data.status === "pending_approval", `Proposal status expected=pending_approval actual=${proposal.data.status}`);
    assert(proposal.data.proposed_by_actor === owner.user.id, `Proposal actor expected=${owner.user.id} actual=${proposal.data.proposed_by_actor}`);
    assert(proposal.data.rationale === "Founder confirmed", `Proposal rationale expected=Founder confirmed actual=${proposal.data.rationale}`);
    const proposedChange = proposal.data.proposed_changes?.approved_key;
    assert(proposedChange?.before === null, `Proposal before expected=null actual=${JSON.stringify(proposedChange?.before)}`);
    assert(proposedChange?.after === "Confirmed Proposal", `Proposal after expected=Confirmed Proposal actual=${JSON.stringify(proposedChange?.after)}`);
    assert(!evidenceLinks.error && evidenceLinks.data?.length === 1, `proposal_evidence expected exactly one row; error=${JSON.stringify(evidenceLinks.error)} actual=${JSON.stringify(evidenceLinks.data)}`);
    assert(!observationLinks.error && observationLinks.data?.length === 1, `proposal_observations expected exactly one row; error=${JSON.stringify(observationLinks.error)} actual=${JSON.stringify(observationLinks.data)}`);
    assert(!elementLinks.error && elementLinks.data?.length === 1, `proposal_elements expected exactly one row; error=${JSON.stringify(elementLinks.error)} actual=${JSON.stringify(elementLinks.data)}`);
    const evidenceLink = evidenceLinks.data[0];
    const observationLink = observationLinks.data[0];
    const elementLink = elementLinks.data[0];
    for (const [table, row] of [["proposal_evidence", evidenceLink], ["proposal_observations", observationLink], ["proposal_elements", elementLink]] as const) {
      assert(row.proposal_id === proposalResult.targetId, `${table}.proposal_id expected=${proposalResult.targetId} actual=${row.proposal_id}`);
      assert(row.business_representation_id === owner.representationId, `${table}.business_representation_id expected=${owner.representationId} actual=${row.business_representation_id}`);
    }
    assert(elementLink.element_id === owner.elementId, `proposal_elements.element_id expected=${owner.elementId} actual=${elementLink.element_id}`);
    registry.registerEvidence(evidenceLink.evidence_id); registry.registerObservation(observationLink.observation_id);
    const [proposalEvidence, proposalObservation] = await Promise.all([
      service.from("evidence").select("id,business_representation_id,source_type,raw_statement,statement_hash,captured_by_actor").eq("id", evidenceLink.evidence_id).single(),
      service.from("observations").select("id,business_representation_id,evidence_id,interpreted_meaning,confidence_in_interpretation,affected_elements,created_by_actor").eq("id", observationLink.observation_id).single(),
    ]);
    assert(!proposalEvidence.error && proposalEvidence.data, `Proposal supporting Evidence retrieval failed: ${JSON.stringify(proposalEvidence.error)}`);
    assert(proposalEvidence.data.business_representation_id === owner.representationId, `Supporting Evidence Representation expected=${owner.representationId} actual=${proposalEvidence.data.business_representation_id}`);
    assert(proposalEvidence.data.source_type === "conversation", `Supporting Evidence source expected=conversation actual=${proposalEvidence.data.source_type}`);
    assert(proposalEvidence.data.raw_statement === "Confirmed Proposal", `Supporting Evidence statement expected=Confirmed Proposal actual=${proposalEvidence.data.raw_statement}`);
    assert(Boolean(proposalEvidence.data.statement_hash), `Supporting Evidence generated hash expected non-empty actual=${proposalEvidence.data.statement_hash}`);
    assert(proposalEvidence.data.captured_by_actor === owner.user.id, `Supporting Evidence actor expected=${owner.user.id} actual=${proposalEvidence.data.captured_by_actor}`);
    assert(!proposalObservation.error && proposalObservation.data, `Proposal supporting Observation retrieval failed: ${JSON.stringify(proposalObservation.error)}`);
    assert(proposalObservation.data.business_representation_id === owner.representationId, `Supporting Observation Representation expected=${owner.representationId} actual=${proposalObservation.data.business_representation_id}`);
    assert(proposalObservation.data.evidence_id === proposalEvidence.data.id, `Supporting Observation Evidence expected=${proposalEvidence.data.id} actual=${proposalObservation.data.evidence_id}`);
    assert(proposalObservation.data.interpreted_meaning === "Confirmed Proposal", `Supporting Observation meaning expected=Confirmed Proposal actual=${proposalObservation.data.interpreted_meaning}`);
    assert(proposalObservation.data.confidence_in_interpretation === 80, `Supporting Observation confidence expected=80 actual=${proposalObservation.data.confidence_in_interpretation}`);
    assert(Array.isArray(proposalObservation.data.affected_elements) && proposalObservation.data.affected_elements.includes(owner.elementId), `Supporting Observation affected_elements expected to contain=${owner.elementId} actual=${JSON.stringify(proposalObservation.data.affected_elements)}`);
    assert(proposalObservation.data.created_by_actor === owner.user.id, `Supporting Observation actor expected=${owner.user.id} actual=${proposalObservation.data.created_by_actor}`);
    assert(!proposalProvenance.error && proposalProvenance.data, `conversation_candidate_promotions retrieval failed: ${JSON.stringify(proposalProvenance.error)}`);
    const provenance = proposalProvenance.data;
    assert(provenance.target_type === "representation_proposal" && provenance.representation_proposal_id === proposalResult.targetId, `Promotion Proposal target mismatch: ${JSON.stringify(provenance)}`);
    assert(provenance.evidence_id === null && provenance.observation_id === null, `Promotion exact-target columns expected null Evidence/Observation actual evidence=${provenance.evidence_id} observation=${provenance.observation_id}`);
    assert(provenance.related_element_id === owner.elementId, `Promotion related Element expected=${owner.elementId} actual=${provenance.related_element_id}`);
    assert(provenance.candidate_id === proposalCandidate.id, `Promotion candidate expected=${proposalCandidate.id} actual=${provenance.candidate_id}`);
    assert(provenance.conversation_output_id === proposalCandidate.conversation_output_id, `Promotion output expected=${proposalCandidate.conversation_output_id} actual=${provenance.conversation_output_id}`);
    assert(provenance.tenant_user_id === owner.user.id && provenance.business_id === owner.businessId && provenance.business_representation_id === owner.representationId, `Promotion tenant/Business identity mismatch: ${JSON.stringify(provenance)}`);
    assert(provenance.canonical_version_id === owner.versionId && provenance.reviewer_user_id === owner.user.id, `Promotion canonical/reviewer identity mismatch: ${JSON.stringify(provenance)}`);
    assert(provenance.request_key === proposalRequestKey && Boolean(provenance.request_hash) && Boolean(provenance.request_payload), `Promotion request identity mismatch: ${JSON.stringify(provenance)}`);
    assert(provenance.confirmed_content?.statement === "Confirmed Proposal" && Boolean(provenance.extracted_content), `Promotion content provenance mismatch: ${JSON.stringify(provenance)}`);
    const proposalReplay = await jsonRequest<PromotionApiBody>(server.baseUrl, "/api/voice/conversation-review", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${owner.user.token}` },
      body: JSON.stringify({
        action: "promote", candidateId: proposalCandidate.id, requestKey: proposalRequestKey,
        targetType: "representation_proposal", statement: "Confirmed Proposal", reason: "Founder confirmed",
        relatedElementId: owner.elementId, elementKey: "approved_key", evidenceSourceType: "conversation",
      }),
    });
    assert(
      proposalReplay.status === 201 && proposalReplay.body.data?.targetId === proposalResult.targetId &&
        proposalReplay.body.data.promotionId === proposalResult.promotionId && proposalReplay.body.data.idempotent,
      `Proposal replay expected same Proposal/promotion and idempotent=true; actual status=${proposalReplay.status} body=${JSON.stringify(proposalReplay.body)}`,
    );
    const [proposalElementAfter, versionsAfterProposal, confidenceAfterProposal, auditsAfterProposal, proposalApprovals] = await Promise.all([
      service.from("representation_elements").select("id,current_value_version_id,is_disputed,claim_eligibility").eq("id", owner.elementId).single(),
      service.from("representation_versions").select("id", { count: "exact" }).eq("business_representation_id", owner.representationId),
      service.from("confidence_assessments").select("id", { count: "exact" }).eq("business_representation_id", owner.representationId),
      service.from("audit_events").select("id", { count: "exact" }).eq("business_representation_id", owner.representationId),
      service.from("approval_decisions").select("id").eq("representation_proposal_id", proposalResult.targetId),
    ]);
    assert(!proposalApprovals.error && proposalApprovals.data.length === 0, `Proposal Approval Decisions expected=0 actual=${JSON.stringify(proposalApprovals)}`);
    assert(versionsAfterProposal.count === versionsBeforeProposal.count, `Proposal Version count expected=${versionsBeforeProposal.count} actual=${versionsAfterProposal.count}`);
    assert(confidenceAfterProposal.count === confidenceBeforeProposal.count, `Proposal Confidence count expected=${confidenceBeforeProposal.count} actual=${confidenceAfterProposal.count}`);
    assert(auditsAfterProposal.count === auditsBeforeProposal.count, `Proposal Audit count expected=${auditsBeforeProposal.count} actual=${auditsAfterProposal.count}`);
    assert(!proposalElementAfter.error && proposalElementAfter.data?.current_value_version_id === proposalElementBefore.data.current_value_version_id, `Proposal Element current Version expected=${proposalElementBefore.data.current_value_version_id} actual=${proposalElementAfter.data?.current_value_version_id}`);
    assert(proposalElementAfter.data?.is_disputed === proposalElementBefore.data.is_disputed && proposalElementAfter.data?.claim_eligibility === proposalElementBefore.data.claim_eligibility, `Proposal contradiction state changed: before=${JSON.stringify(proposalElementBefore.data)} after=${JSON.stringify(proposalElementAfter.data)}`);
    console.log(`Proposal diagnostic — ${JSON.stringify({ api: { status: proposalPromotion.status, body: proposalPromotion.body }, proposal: proposal.data, relationships: { proposalEvidence: evidenceLink, proposalObservation: observationLink, proposalElement: elementLink }, supportingEvidence: proposalEvidence.data, supportingObservation: proposalObservation.data, promotion: provenance })}`);

    phase = "promotion concurrency";
    const concurrentKeys = [crypto.randomUUID(), crypto.randomUUID()];
    const concurrent = await Promise.all(concurrentKeys.map((key) => promote(owner.user.client, concurrentCandidate.id, "evidence", key, "Concurrent Evidence")));
    assert(concurrent.every((result) => !result.error), "concurrent equivalent promotions converge");
    const concurrentIds = concurrent.map((result) => (result.data as PromotionResult).promotionId);
    assert(new Set(concurrentIds).size === 1, "concurrent promotion creates one promotion");
    const concurrentResult = concurrent[0].data as PromotionResult;
    registry.registerConversationReview(concurrentResult.reviewDecisionId, owner.representationId); registry.registerConversationPromotion(concurrentResult.promotionId, owner.representationId); registry.registerEvidence(concurrentResult.targetId);

    phase = "provenance and immutability";
    const phase3Rows = await service.from("conversation_candidate_promotions").select("*").eq("business_representation_id", owner.representationId);
    assert(!phase3Rows.error && phase3Rows.data.length === 4, "exact promotion count");
    assert(phase3Rows.data.every((row) => row.tenant_user_id === owner.user.id && row.business_id === owner.businessId && row.canonical_version_id === owner.versionId && row.reviewer_user_id === owner.user.id && row.request_hash && row.request_payload && row.extracted_content && row.confirmed_content), "promotion provenance chain");
    const decisions = await service.from("conversation_candidate_review_decisions").select("*").eq("business_representation_id", owner.representationId);
    assert(!decisions.error && decisions.data.length === registry.conversationReviews.filter(row => row.businessRepresentationId === owner.representationId).length, "review row count");
    for (const [label, client] of [["owner", owner.user.client], ["anonymous", anonymous], ["service", service]] as const) {
      assert((await client.from("conversation_candidate_review_decisions").insert({ id: crypto.randomUUID() })).error, `${label} review direct insert blocked`);
      assert((await client.from("conversation_candidate_review_decisions").update({ decision_reason: "changed" }).eq("id", deferred.data.reviewDecisionId)).error, `${label} review update blocked`);
      assert((await client.from("conversation_candidate_review_decisions").delete().eq("id", deferred.data.reviewDecisionId)).error, `${label} review delete blocked`);
      assert((await client.from("conversation_candidate_promotions").insert({ id: crypto.randomUUID() })).error, `${label} promotion direct insert blocked`);
      assert((await client.from("conversation_candidate_promotions").update({ decision_reason: "changed" }).eq("id", evidenceResult.promotionId)).error, `${label} promotion update blocked`);
      assert((await client.from("conversation_candidate_promotions").delete().eq("id", evidenceResult.promotionId)).error, `${label} promotion delete blocked`);
    }
    assert((await foreign.user.client.from("conversation_candidate_review_decisions").select("id").eq("business_representation_id", owner.representationId)).data?.length === 0, "foreign review SELECT isolated");
    assert((await foreign.user.client.from("conversation_candidate_promotions").select("id").eq("business_representation_id", owner.representationId)).data?.length === 0, "foreign promotion SELECT isolated");
    const canonicalAfter = await service.from("business_representations").select("current_version_id").eq("id", owner.representationId).single();
    assert(!canonicalBefore.error && !canonicalAfter.error && canonicalAfter.data.current_version_id === canonicalBefore.data.current_version_id, "promotions do not advance canonical Version");
    const approvals = await service.from("approval_decisions").select("id").eq("representation_proposal_id", proposalResult.targetId);
    assert(!approvals.error && approvals.data.length === 0, "Proposal promotion creates no Approval Decision");

    console.log("Conversation Review Deployed\n\nStatic authorization — PASS\nReview behavior — PASS\nEvidence promotion — PASS\nObservation promotion — PASS\nProposal promotion — PASS\nIdempotency and concurrency — PASS\nTenant isolation — PASS\nImmutability — PASS\nCanonical safety — PASS");
  } catch (error: unknown) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "unknown";
    const message = typeof error === "object" && error && "message" in error ? String((error as { message?: unknown }).message).replaceAll(/\s+/g, " ").slice(0, 300) : "assertion failed";
    throw new Error(`${phase} failed (${code}): ${message}`);
  } finally {
    cleanup = await cleanupFixtures(service, registry);
    console.log(`Phase 3 cleanup — ${cleanup.success ? "PASS" : "FAIL"}`);
    await server.stop();
    console.log("Server cleanup — PASS");
  }
  if (!cleanup?.success) throw new Error(cleanup?.failures.join(", "));
}

const keepAlive = setInterval(() => undefined, 1000);
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Conversation Review deployed test failed");
  process.exitCode = 1;
}).finally(() => clearInterval(keepAlive));
