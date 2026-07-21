import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FixtureRegistry } from "./representation-state-test-fixtures";
import { cleanupFixtures } from "./representation-state-test-cleanup";
import { jsonRequest } from "./representation-state-test-client";
import { startTestServer } from "./representation-state-test-server";
import { NextRequest } from "next/server";
import { createZeyaConversationOutputHandler } from "../../app/api/voice/conversation-output/zeya/route";
import { captureAndExtractConversationOutput } from "../../lib/voice/conversation-output/service";

type UserFixture = { id: string; token: string; client: SupabaseClient };
type TenantFixture = { user: UserFixture; businessId: string; representationId: string; versionId: string; elementId: string };
type CaptureOverrides = Partial<{
  conversationId: string; providerCallId: string | null; provider: string; channel: string;
  captureSource: string; trust: string; attested: boolean; submittedBy: string | null;
  startedAt: string | null; completedAt: string | null; transcript: unknown[];
  transcriptStatus: string; transcriptSchema: string; conversationStatus: string;
  completionReason: string | null; extractionSchema: string; safeMetadata: Record<string, unknown>;
}>;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Voice Conversation Deployed: ${message}`);
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
    const email = `voice-output-${label}-${registry.runId}@zeya.test`;
    const password = `T-${crypto.randomUUID()}!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    registry.registerAuthUser(created.data.user.id, email);
    const publicClient = createClient(url!, publishable!, { auth: { persistSession: false } });
    const signed = await publicClient.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw signed.error ?? new Error("Authentication failed");
    return {
      id: created.data.user.id,
      token: signed.data.session.access_token,
      client: createClient(url!, publishable!, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${signed.data.session.access_token}` } },
      }),
    };
  }

  async function createTenant(label: string): Promise<TenantFixture> {
    const user = await createUser(label);
    const business = await user.client.from("businesses")
      .insert({ business_name: `Voice Output ${label} ${registry.runId}`, user_id: user.id }).select().single();
    if (business.error) throw business.error;
    registry.registerBusiness(business.data.id, user.id);
    const evidence = await jsonRequest<{ data: { businessRepresentationId: string; evidenceId: string; observationId: string; proposalId: string } }>(
      server.baseUrl, "/api/representation/evidence", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ businessId: business.data.id, statement: `voice output fixture ${label}` }),
      },
    );
    assert(evidence.status === 201, `${label} Representation initialization`);
    const representationId = evidence.body.data.businessRepresentationId;
    registry.registerBusinessRepresentation(representationId, business.data.id);
    registry.registerEvidence(evidence.body.data.evidenceId);
    registry.registerObservation(evidence.body.data.observationId);
    registry.registerProposal(evidence.body.data.proposalId);
    const version = await jsonRequest<{ data: { versionId: string; confidenceAssessmentId: string } }>(
      server.baseUrl, "/api/representation/versions", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({
          businessRepresentationId: representationId,
          proposalId: evidence.body.data.proposalId,
          elementValues: { approved_key: { value: `approved ${label}` } },
          confidenceScore: 85,
        }),
      },
    );
    assert(version.status === 201, `${label} canonical Version`);
    registry.registerVersion(version.body.data.versionId);
    registry.registerConfidenceAssessment(version.body.data.confidenceAssessmentId);
    const domain = await user.client.from("representation_domains").select("id")
      .eq("business_representation_id", representationId).eq("domain_name", "customer").single();
    if (domain.error) throw domain.error;
    registry.registerDomain(domain.data.id);
    const element = await user.client.from("representation_elements").insert({
      business_representation_id: representationId,
      representation_domain_id: domain.data.id,
      element_key: "approved_key",
      element_type: "fact",
      current_value_version_id: version.body.data.versionId,
      is_disputed: false,
      claim_eligibility: "approved_for_external_use",
      field_sensitivity: "operational",
    }).select().single();
    if (element.error) throw element.error;
    registry.registerElement(element.data.id);
    return { user, businessId: business.data.id, representationId, versionId: version.body.data.versionId, elementId: element.data.id };
  }

  async function createLineage(tenant: TenantFixture, label: string, providerCallId: string | null = null) {
    const voiceContextId = crypto.randomUUID();
    const conversationId = `conversation-${label}-${registry.runId}`;
    const result = await service.rpc("zeya_create_voice_representation_lineage", {
      p_voice_context_id: voiceContextId,
      p_worker_brief_id: `brief-${label}-${registry.runId}`,
      p_mission_id: `mission-${label}-${registry.runId}`,
      p_conversation_id: conversationId,
      p_tenant_user_id: tenant.user.id,
      p_business_id: tenant.businessId,
      p_business_representation_id: tenant.representationId,
      p_canonical_version_id: tenant.versionId,
      p_context_generated_at: new Date().toISOString(),
      p_authorized_element_keys: ["approved_key"],
      p_provisional_mode: false,
      p_agent_id: label.startsWith("zeya") ? "zeya-realtime" : "veya-caller",
      p_agent_type: label.startsWith("zeya") ? "ZEYA" : "CALLER",
      p_agent_role: "test",
      p_context_schema_version: "1.0",
      p_prompt_assembly_version: "1.0",
    });
    if (result.error) throw result.error;
    registry.registerVoiceLineage(voiceContextId, tenant.representationId);
    if (providerCallId) {
      const attached = await service.rpc("zeya_attach_voice_provider_ids", {
        p_voice_context_id: voiceContextId,
        p_conversation_id: conversationId,
        p_provider_call_id: providerCallId,
      });
      if (attached.error) throw attached.error;
    }
    return { voiceContextId, conversationId, providerCallId };
  }

  async function capture(tenant: TenantFixture, lineage: Awaited<ReturnType<typeof createLineage>>, overrides: CaptureOverrides = {}) {
    const defaults = {
      conversationId: lineage.conversationId,
      providerCallId: lineage.providerCallId,
      provider: "elevenlabs",
      channel: "veya_outbound",
      captureSource: "provider_callback",
      trust: "provider_attested",
      attested: true,
      submittedBy: null,
      startedAt: "2026-07-15T10:00:00.000Z",
      completedAt: "2026-07-15T10:01:00.000Z",
      transcript: [{ role: "customer", text: "deployed verification statement" }],
      transcriptStatus: "finalized",
      transcriptSchema: "1.0",
      conversationStatus: "done",
      completionReason: "provider_completed",
      extractionSchema: "1.0",
      safeMetadata: { turnCount: 1, hasAudio: false },
      ...overrides,
    };
    const result = await service.rpc("zeya_capture_voice_conversation_output", {
      p_voice_context_id: lineage.voiceContextId,
      p_conversation_id: defaults.conversationId,
      p_provider_call_id: defaults.providerCallId,
      p_provider: defaults.provider,
      p_channel: defaults.channel,
      p_capture_source: defaults.captureSource,
      p_transcript_trust_level: defaults.trust,
      p_provider_attested: defaults.attested,
      p_submitted_by: defaults.submittedBy,
      p_started_at: defaults.startedAt,
      p_completed_at: defaults.completedAt,
      p_transcript: defaults.transcript,
      p_transcript_status: defaults.transcriptStatus,
      p_transcript_schema_version: defaults.transcriptSchema,
      p_conversation_status: defaults.conversationStatus,
      p_completion_reason: defaults.completionReason,
      p_extraction_schema_version: defaults.extractionSchema,
      p_safe_metadata: defaults.safeMetadata,
    });
    if (!result.error && typeof result.data === "string" && !registry.voiceOutputs.some((row) => row.id === result.data)) {
      registry.registerVoiceOutput(result.data, tenant.representationId);
    }
    return result;
  }

  const candidate = (overrides: Record<string, unknown> = {}) => ({
    candidateType: "customer_question",
    content: { summary: "safe summary" },
    speakerRole: "customer",
    statementKind: "question",
    sourceReference: { turnIndexes: [0] },
    relevantElementKeys: ["approved_key"],
    confidence: 0.8,
    rationale: "supported by the referenced customer turn",
    ...overrides,
  });

  async function store(outputId: string, candidates: unknown[], schema = "1.0") {
    return service.rpc("zeya_store_voice_conversation_candidates", {
      p_conversation_output_id: outputId,
      p_extraction_schema_version: schema,
      p_candidates: candidates,
    });
  }

  try {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");
    const canonicalTables = ["evidence", "observations", "representation_proposals", "approval_decisions", "representation_versions", "confidence_assessments", "audit_events", "representation_elements"];
    async function canonicalSnapshot(representationId: string) {
      const results = await Promise.all(canonicalTables.map((table) => service.from(table).select("*", { count: "exact", head: true }).eq("business_representation_id", representationId)));
      assert(results.every((result) => !result.error), "canonical snapshot readable");
      const representation = await service.from("business_representations").select("current_version_id").eq("id", representationId).single();
      if (representation.error) throw representation.error;
      return { counts: results.map((result) => result.count), currentVersionId: representation.data.current_version_id };
    }
    const canonicalBeforeA = await canonicalSnapshot(tenantA.representationId);
    const canonicalBeforeB = await canonicalSnapshot(tenantB.representationId);

    const openApi = await fetch(`${url}/rest/v1/`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    const schema = await openApi.json() as { definitions?: Record<string, { properties?: Record<string, unknown> }> };
    for (const table of ["voice_conversation_outputs", "voice_conversation_candidates"]) {
      assert(schema.definitions?.[table], `OpenAPI exposes ${table}`);
    }
    for (const column of ["completed_extraction_schema_version", "extraction_result_hash", "extracted_candidate_count"]) {
      assert(schema.definitions?.voice_conversation_outputs?.properties?.[column], `deployed output column ${column}`);
    }

    const authLineage = await createLineage(tenantA, "authorization", `call-auth-${registry.runId}`);
    const authOutput = await capture(tenantA, authLineage);
    assert(!authOutput.error && typeof authOutput.data === "string", "service capture RPC permitted");
    const authOutputId = authOutput.data as string;
    const authStored = await store(authOutputId, [candidate()]);
    assert(!authStored.error && authStored.data === 1, "service candidate RPC permitted");
    const authCandidateRows = await service.from("voice_conversation_candidates").select("id").eq("conversation_output_id", authOutputId);
    assert(!authCandidateRows.error && authCandidateRows.data.length === 1, "service candidate SELECT permitted");
    authCandidateRows.data.forEach((row) => registry.registerVoiceCandidate(row.id, tenantA.representationId));
    assert((await anonymous.from("voice_conversation_outputs").select("id")).error, "anonymous output SELECT blocked");
    assert((await anonymous.from("voice_conversation_candidates").select("id")).error, "anonymous candidate SELECT blocked");
    assert((await tenantA.user.client.from("voice_conversation_outputs").select("id").eq("id", authOutputId)).data?.length === 1, "tenant reads own output");
    assert((await tenantB.user.client.from("voice_conversation_outputs").select("id").eq("id", authOutputId)).data?.length === 0, "foreign tenant cannot read output");
    assert((await tenantB.user.client.from("voice_conversation_candidates").select("id").eq("conversation_output_id", authOutputId)).data?.length === 0, "foreign tenant cannot read candidates");

    const fabricatedOutput = { id: crypto.randomUUID(), voice_context_id: crypto.randomUUID() };
    for (const [label, client] of [["anonymous", anonymous], ["authenticated", tenantA.user.client], ["service", service]] as const) {
      assert((await client.from("voice_conversation_outputs").insert(fabricatedOutput)).error, `${label} output INSERT blocked`);
      assert((await client.from("voice_conversation_outputs").update({ conversation_status: "changed" }).eq("id", authOutputId)).error, `${label} output UPDATE blocked`);
      assert((await client.from("voice_conversation_outputs").delete().eq("id", authOutputId)).error, `${label} output DELETE blocked`);
      assert((await client.from("voice_conversation_candidates").insert({ id: crypto.randomUUID() })).error, `${label} candidate INSERT blocked`);
      assert((await client.from("voice_conversation_candidates").update({ confidence: 0.1 }).eq("conversation_output_id", authOutputId)).error, `${label} candidate UPDATE blocked`);
      assert((await client.from("voice_conversation_candidates").delete().eq("conversation_output_id", authOutputId)).error, `${label} candidate DELETE blocked`);
    }
    for (const [label, client] of [["anonymous", anonymous], ["authenticated", tenantA.user.client]] as const) {
      assert((await client.rpc("zeya_capture_voice_conversation_output", { p_voice_context_id: crypto.randomUUID() })).error, `${label} capture RPC blocked`);
      assert((await client.rpc("zeya_finalize_voice_conversation_transcript", { p_voice_context_id: crypto.randomUUID() })).error, `${label} finalization RPC blocked`);
      assert((await client.rpc("zeya_set_voice_conversation_processing_status", { p_conversation_output_id: crypto.randomUUID(), p_processing_status: "failed" })).error, `${label} processing RPC blocked`);
      assert((await client.rpc("zeya_store_voice_conversation_candidates", { p_conversation_output_id: crypto.randomUUID(), p_extraction_schema_version: "1.0", p_candidates: [] })).error, `${label} candidate RPC blocked`);
      assert((await client.rpc("zeya_purge_business_representation", { p_business_representation_id: tenantA.representationId, p_expected_business_id: tenantA.businessId })).error, `${label} purge RPC blocked`);
    }
    assert((await service.rpc("zeya_enforce_voice_output_immutability")).error, "trigger function direct execution blocked");

    const zeyaConversationId = `zeya-output-${registry.runId}`;
    const zeyaSession = await jsonRequest<{ voice_context_id: string }>(server.baseUrl, "/api/openai/realtime/briefing-session", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tenantA.user.token}` },
      body: JSON.stringify({ businessId: tenantA.businessId, conversationId: zeyaConversationId }),
    });
    assert(zeyaSession.status === 200, "Zeya briefing session creates stored lineage");
    registry.registerVoiceLineage(zeyaSession.body.voice_context_id, tenantA.representationId);
    const zeyaBody = {
      voiceContextId: zeyaSession.body.voice_context_id,
      conversationId: zeyaConversationId,
      transcript: [{ role: "customer", text: "What should happen next?" }, { role: "agent", text: "A human can review the conversation output." }],
      startedAt: "2026-07-15T10:10:00.000Z",
      completedAt: "2026-07-15T10:11:00.000Z",
      completionReason: "user_disconnect",
      tenantUserId: tenantB.user.id,
      businessId: tenantB.businessId,
      businessRepresentationId: tenantB.representationId,
      canonicalVersionId: tenantB.versionId,
      agentId: "browser-override",
      provider: "browser-override",
    };
    const zeyaHandler = createZeyaConversationOutputHandler(async () => [candidate()]);
    async function invokeZeya(body: unknown) {
      const response = await zeyaHandler(new NextRequest(`${server.baseUrl}/api/voice/conversation-output/zeya`, {
        method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${tenantA.user.token}` }, body: JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json() as { conversationOutputId?: string; candidateCount?: number; error?: string } };
    }
    const zeyaCapture = await invokeZeya(zeyaBody);
    assert(zeyaCapture.status === 201 && typeof zeyaCapture.body.conversationOutputId === "string", `Zeya authenticated completion (${zeyaCapture.status})`);
    registry.registerVoiceOutput(zeyaCapture.body.conversationOutputId, tenantA.representationId);
    const zeyaStoredOutput = await service.from("voice_conversation_outputs").select("tenant_user_id,business_id,business_representation_id,canonical_version_id,agent_id,provider,capture_source,transcript_trust_level,provider_attested,submitted_by").eq("id", zeyaCapture.body.conversationOutputId).single();
    assert(!zeyaStoredOutput.error && zeyaStoredOutput.data.tenant_user_id === tenantA.user.id && zeyaStoredOutput.data.business_id === tenantA.businessId && zeyaStoredOutput.data.business_representation_id === tenantA.representationId && zeyaStoredOutput.data.canonical_version_id === tenantA.versionId && zeyaStoredOutput.data.agent_id === "zeya-realtime" && zeyaStoredOutput.data.provider === "openai_realtime" && zeyaStoredOutput.data.capture_source === "authenticated_client_relay" && zeyaStoredOutput.data.transcript_trust_level === "authenticated_client_relay" && zeyaStoredOutput.data.provider_attested === false && zeyaStoredOutput.data.submitted_by === tenantA.user.id, "Zeya route ignores browser provenance overrides");
    const zeyaCandidates = await service.from("voice_conversation_candidates").select("id,candidate_type").eq("conversation_output_id", zeyaCapture.body.conversationOutputId);
    if (zeyaCandidates.error) throw zeyaCandidates.error;
    zeyaCandidates.data.forEach((row) => registry.registerVoiceCandidate(row.id, tenantA.representationId));
    assert(!zeyaCandidates.data.some((row) => row.candidate_type === "candidate_evidence"), "client-relayed extraction creates no candidate Evidence");
    const zeyaReplay = await invokeZeya(zeyaBody);
    assert(zeyaReplay.status === 201 && zeyaReplay.body.conversationOutputId === zeyaCapture.body.conversationOutputId, "Zeya identical completion replay");
    const zeyaConflict = await invokeZeya({ ...zeyaBody, completionReason: "different" });
    assert(zeyaConflict.status === 409, `Zeya conflicting completion maps to 409 (${zeyaConflict.status})`);
    const zeyaAfterConflict = await service.from("voice_conversation_outputs")
      .select("id,completion_reason").eq("voice_context_id", zeyaBody.voiceContextId);
    assert(
      !zeyaAfterConflict.error
        && zeyaAfterConflict.data.length === 1
        && zeyaAfterConflict.data[0].id === zeyaCapture.body.conversationOutputId
        && zeyaAfterConflict.data[0].completion_reason === zeyaBody.completionReason,
      "Zeya conflict preserves the single immutable original completion",
    );
    assert((await invokeZeya({ ...zeyaBody, voiceContextId: crypto.randomUUID(), transcript: [{ role: "system", text: "invalid" }] })).status === 400, "Zeya transcript role validation");
    assert((await invokeZeya({ ...zeyaBody, voiceContextId: crypto.randomUUID(), transcript: Array.from({ length: 501 }, () => ({ role: "customer", text: "bounded" })) })).status === 400, "Zeya transcript turn limit");
    assert((await invokeZeya({ ...zeyaBody, voiceContextId: crypto.randomUUID(), transcript: [{ role: "customer", text: "x".repeat(20_001) }] })).status === 400, "Zeya transcript size limit");

    const veyaProviderCallId = `veya-service-call-${registry.runId}`;
    const veyaServiceLineage = await createLineage(tenantA, "veya-service", veyaProviderCallId);
    const veyaServiceResult = await captureAndExtractConversationOutput({
      db: service,
      capture: {
        voiceContextId: veyaServiceLineage.voiceContextId,
        conversationId: veyaServiceLineage.conversationId,
        providerCallId: null,
        provider: "elevenlabs",
        channel: "veya_outbound",
        captureSource: "provider_callback",
        transcriptTrustLevel: "provider_attested",
        providerAttested: true,
        startedAt: "2026-07-15T10:20:00.000Z",
        completedAt: "2026-07-15T10:21:00.000Z",
        transcript: [{ role: "customer", text: "Provider-attested synthetic verification turn" }],
        transcriptStatus: "finalized",
        conversationStatus: "done",
        completionReason: "provider_completed",
        safeMetadata: { turnCount: 1, hasAudio: false },
      },
      extractionModel: async () => [candidate({ candidateType: "customer_need", statementKind: "assertion" })],
    });
    registry.registerVoiceOutput(veyaServiceResult.conversationOutputId, tenantA.representationId);
    const veyaServiceOutput = await service.from("voice_conversation_outputs").select("provider_call_id,capture_source,transcript_trust_level,provider_attested").eq("id", veyaServiceResult.conversationOutputId).single();
    assert(!veyaServiceOutput.error && veyaServiceOutput.data.provider_call_id === veyaProviderCallId && veyaServiceOutput.data.capture_source === "provider_callback" && veyaServiceOutput.data.transcript_trust_level === "provider_attested" && veyaServiceOutput.data.provider_attested === true, "Veya service derives provider provenance from lineage");
    const veyaServiceCandidates = await service.from("voice_conversation_candidates").select("id").eq("conversation_output_id", veyaServiceResult.conversationOutputId);
    if (veyaServiceCandidates.error) throw veyaServiceCandidates.error;
    assert(veyaServiceCandidates.data.length === 1, "Veya shared extraction persists candidate");
    veyaServiceCandidates.data.forEach((row) => registry.registerVoiceCandidate(row.id, tenantA.representationId));

    const idempotencyLineage = await createLineage(tenantA, "idempotency", `call-idempotency-${registry.runId}`);
    const firstCapture = await capture(tenantA, idempotencyLineage);
    assert(!firstCapture.error && typeof firstCapture.data === "string", "initial provider capture succeeds");
    const firstOutputId = firstCapture.data as string;
    const exactReplay = await capture(tenantA, idempotencyLineage, { safeMetadata: { hasAudio: false, turnCount: 1 } });
    assert(!exactReplay.error && exactReplay.data === firstOutputId, "JSONB-reordered exact capture replay is idempotent");
    const captureConflicts: Array<[string, CaptureOverrides]> = [
      ["conversation", { conversationId: `${idempotencyLineage.conversationId}-other` }],
      ["provider call", { providerCallId: `other-${registry.runId}` }],
      ["provider", { provider: "openai_realtime" }],
      ["channel", { channel: "zeya_realtime" }],
      ["capture source", { captureSource: "status_only", trust: "status_only", attested: false, transcript: [], transcriptStatus: "unavailable" }],
      ["trust", { trust: "status_only" }],
      ["attestation", { attested: false }],
      ["submitter", { submittedBy: tenantA.user.id }],
      ["start", { startedAt: "2026-07-15T09:59:59.000Z" }],
      ["completion", { completedAt: "2026-07-15T10:01:01.000Z" }],
      ["transcript", { transcript: [{ role: "customer", text: "different" }] }],
      ["transcript status", { transcriptStatus: "pending", transcript: [] }],
      ["transcript schema", { transcriptSchema: "2.0" }],
      ["conversation status", { conversationStatus: "failed" }],
      ["completion reason", { completionReason: "different" }],
      ["extraction schema", { extractionSchema: "2.0" }],
      ["safe metadata", { safeMetadata: { turnCount: 2, hasAudio: false } }],
    ];
    for (const [label, overrides] of captureConflicts) assert((await capture(tenantA, idempotencyLineage, overrides)).error, `${label} capture conflict rejected`);

    const delayedLineage = await createLineage(tenantA, "delayed", `call-delayed-${registry.runId}`);
    const statusOnly = await capture(tenantA, delayedLineage, {
      captureSource: "status_only", trust: "status_only", attested: false,
      transcript: [], transcriptStatus: "unavailable", conversationStatus: "failed",
      completionReason: "provider_failed", safeMetadata: { failureCategory: "provider_unavailable" },
    });
    assert(!statusOnly.error && typeof statusOnly.data === "string", "status-only failure capture succeeds");
    const delayedOutputId = statusOnly.data as string;
    const delayedTranscript = [{ role: "customer", text: "delayed provider transcript" }];
    const finalized = await service.rpc("zeya_finalize_voice_conversation_transcript", {
      p_voice_context_id: delayedLineage.voiceContextId,
      p_transcript: delayedTranscript,
      p_completed_at: "2026-07-15T10:02:00.000Z",
      p_conversation_status: "done",
      p_completion_reason: "provider_completed",
    });
    assert(!finalized.error && finalized.data === delayedOutputId, "delayed transcript finalizes once");
    const finalizedReplay = await service.rpc("zeya_finalize_voice_conversation_transcript", {
      p_voice_context_id: delayedLineage.voiceContextId, p_transcript: delayedTranscript,
      p_completed_at: "2026-07-15T10:02:00.000Z", p_conversation_status: "done", p_completion_reason: "provider_completed",
    });
    assert(!finalizedReplay.error && finalizedReplay.data === delayedOutputId, "delayed finalization exact replay");
    for (const [label, body] of [
      ["transcript", { p_transcript: [{ role: "customer", text: "different" }], p_completed_at: "2026-07-15T10:02:00.000Z", p_conversation_status: "done", p_completion_reason: "provider_completed" }],
      ["completion time", { p_transcript: delayedTranscript, p_completed_at: "2026-07-15T10:02:01.000Z", p_conversation_status: "done", p_completion_reason: "provider_completed" }],
      ["status", { p_transcript: delayedTranscript, p_completed_at: "2026-07-15T10:02:00.000Z", p_conversation_status: "failed", p_completion_reason: "provider_completed" }],
      ["reason", { p_transcript: delayedTranscript, p_completed_at: "2026-07-15T10:02:00.000Z", p_conversation_status: "done", p_completion_reason: "different" }],
    ] as const) {
      assert((await service.rpc("zeya_finalize_voice_conversation_transcript", { p_voice_context_id: delayedLineage.voiceContextId, ...body })).error, `delayed ${label} conflict rejected`);
    }
    const delayedRow = await service.from("voice_conversation_outputs").select("*").eq("id", delayedOutputId).single();
    assert(!delayedRow.error && delayedRow.data.transcript_status === "finalized" && delayedRow.data.transcript_trust_level === "provider_attested" && delayedRow.data.provider_attested === true, "delayed final state persisted");

    const clientLineage = await createLineage(tenantA, "zeya-client");
    const clientCapture = await capture(tenantA, clientLineage, {
      provider: "openai_realtime", channel: "zeya_realtime", captureSource: "authenticated_client_relay",
      trust: "authenticated_client_relay", attested: false, submittedBy: tenantA.user.id,
    });
    assert(!clientCapture.error && typeof clientCapture.data === "string", "client-relayed capture succeeds");
    assert((await service.rpc("zeya_finalize_voice_conversation_transcript", {
      p_voice_context_id: clientLineage.voiceContextId, p_transcript: [{ role: "customer", text: "replacement" }],
      p_completed_at: "2026-07-15T10:02:00.000Z", p_conversation_status: "done", p_completion_reason: "provider_completed",
    })).error, "client-relayed output cannot delayed-finalize");
    assert((await store(clientCapture.data as string, [candidate({ candidateType: "candidate_evidence" })])).error, "client-relayed candidate Evidence blocked");

    const extractionLineage = await createLineage(tenantA, "extraction", `call-extraction-${registry.runId}`);
    const extractionCapture = await capture(tenantA, extractionLineage);
    assert(!extractionCapture.error && typeof extractionCapture.data === "string", "extraction capture");
    const extractionOutputId = extractionCapture.data as string;
    const candidates = [
      candidate(), candidate({ candidateType: "objection", statementKind: "objection" }),
      candidate({ candidateType: "qualification_signal", statementKind: "classification" }),
      candidate({ candidateType: "promised_follow_up", statementKind: "commitment" }),
      candidate({ candidateType: "customer_need", statementKind: "assertion" }),
      candidate({ candidateType: "customer_language", statementKind: "assertion" }),
      candidate({ candidateType: "possible_representation_gap", statementKind: "inference" }),
      candidate({ candidateType: "possible_contradiction", statementKind: "inference" }),
      candidate({ candidateType: "suggested_follow_up", statementKind: "request" }),
      candidate({ candidateType: "outcome_classification", statementKind: "classification" }),
    ];
    const storedCandidates = await store(extractionOutputId, candidates);
    assert(!storedCandidates.error && storedCandidates.data === candidates.length, "nonempty extraction stored");
    assert((await store(extractionOutputId, candidates)).data === candidates.length, "identical candidate replay");
    const extractedRows = await service.from("voice_conversation_candidates").select("*").eq("conversation_output_id", extractionOutputId).order("extraction_ordinal");
    assert(!extractedRows.error && extractedRows.data.length === candidates.length, "candidate rows and ordinals persisted");
    extractedRows.data.forEach((row) => registry.registerVoiceCandidate(row.id, tenantA.representationId));
    assert(extractedRows.data.every((row, index) => row.review_status === "pending_review" && row.extraction_ordinal === index && row.transcript_trust_level === "provider_attested" && row.business_representation_id === tenantA.representationId), "candidate provenance and pending review");
    const extractionRow = await service.from("voice_conversation_outputs").select("*").eq("id", extractionOutputId).single();
    assert(!extractionRow.error && extractionRow.data.extracted_candidate_count === candidates.length && extractionRow.data.completed_extraction_schema_version === "1.0" && typeof extractionRow.data.extraction_result_hash === "string" && extractionRow.data.processing_status === "completed", "durable extraction markers");
    for (const [label, changed, schemaVersion] of [
      ["content", candidates.map((item, i) => i ? item : candidate({ content: { summary: "changed" } })), "1.0"],
      ["order", [...candidates].reverse(), "1.0"],
      ["rationale", candidates.map((item, i) => i ? item : candidate({ rationale: "changed rationale" })), "1.0"],
      ["confidence", candidates.map((item, i) => i ? item : candidate({ confidence: 0.7 })), "1.0"],
      ["keys", candidates.map((item, i) => i ? item : candidate({ relevantElementKeys: [] })), "1.0"],
      ["type", candidates.map((item, i) => i ? item : candidate({ candidateType: "unanswered_question" })), "1.0"],
      ["schema", candidates, "2.0"],
    ] as const) assert((await store(extractionOutputId, [...changed], schemaVersion)).error, `candidate ${label} replay conflict`);
    assert((await service.rpc("zeya_set_voice_conversation_processing_status", { p_conversation_output_id: extractionOutputId, p_processing_status: "failed" })).error, "completed extraction cannot reopen");

    const zeroLineage = await createLineage(tenantA, "zero", `call-zero-${registry.runId}`);
    const zeroCapture = await capture(tenantA, zeroLineage);
    assert(!zeroCapture.error && typeof zeroCapture.data === "string", "zero extraction capture");
    const zeroOutputId = zeroCapture.data as string;
    const zeroFirst = await store(zeroOutputId, []);
    assert(!zeroFirst.error && zeroFirst.data === 0, "zero extraction stored");
    assert((await store(zeroOutputId, [])).data === 0, "zero extraction replay");
    assert((await store(zeroOutputId, [candidate()])).error, "nonempty replay after zero rejected");
    assert((await store(zeroOutputId, [], "2.0")).error, "alternate schema after zero rejected");
    const zeroRow = await service.from("voice_conversation_outputs").select("*").eq("id", zeroOutputId).single();
    const zeroRows = await service.from("voice_conversation_candidates").select("id").eq("conversation_output_id", zeroOutputId);
    assert(!zeroRow.error && zeroRow.data.extracted_candidate_count === 0 && zeroRow.data.completed_extraction_schema_version === "1.0" && zeroRow.data.extraction_result_hash === "d751713988987e9331980363e24189ce" && zeroRow.data.processing_status === "completed", "zero extraction markers and normalized hash");
    assert(!zeroRows.error && zeroRows.data.length === 0, "zero extraction has no candidate rows");

    const safetyLineage = await createLineage(tenantA, "safety", `call-safety-${registry.runId}`);
    const safetyCapture = await capture(tenantA, safetyLineage);
    assert(!safetyCapture.error && typeof safetyCapture.data === "string", "safety capture");
    const safetyOutputId = safetyCapture.data as string;
    const invalidCandidates: Array<[string, unknown[]]> = [
      ["unsupported type", [candidate({ candidateType: "unsupported" })]],
      ["content", [candidate({ content: null })]], ["source", [candidate({ sourceReference: null })]],
      ["speaker", [candidate({ speakerRole: "unsupported" })]], ["statement", [candidate({ statementKind: "unsupported" })]],
      ["keys type", [candidate({ relevantElementKeys: "approved_key" })]], ["blank key", [candidate({ relevantElementKeys: [""] })]],
      ["unauthorized key", [candidate({ relevantElementKeys: ["foreign_key"] })]],
      ["mixed keys", [candidate({ relevantElementKeys: ["approved_key", "foreign_key"] })]],
      ["low confidence", [candidate({ confidence: -0.1 })]], ["high confidence", [candidate({ confidence: 1.1 })]],
      ["rationale", [candidate({ rationale: " " })]],
      ["Zeya Evidence", [candidate({ candidateType: "candidate_evidence", speakerRole: "zeya", statementKind: "assertion" })]],
      ["Veya Evidence", [candidate({ candidateType: "candidate_evidence", speakerRole: "veya", statementKind: "assertion" })]],
    ];
    for (const [label, payload] of invalidCandidates) {
      assert((await store(safetyOutputId, payload)).error, `${label} rejected`);
      const partial = await service.from("voice_conversation_candidates").select("id").eq("conversation_output_id", safetyOutputId);
      const markers = await service.from("voice_conversation_outputs").select("completed_extraction_schema_version,extraction_result_hash,extracted_candidate_count,processing_status").eq("id", safetyOutputId).single();
      assert(!partial.error && partial.data.length === 0, `${label} leaves no partial candidates`);
      assert(!markers.error && markers.data.completed_extraction_schema_version === null && markers.data.extraction_result_hash === null && markers.data.extracted_candidate_count === null && markers.data.processing_status === "captured", `${label} leaves no result markers`);
    }
    const validEvidence = await store(safetyOutputId, [candidate({ candidateType: "candidate_evidence", statementKind: "assertion" })]);
    assert(!validEvidence.error && validEvidence.data === 1, "provider-attested customer Evidence candidate permitted");
    const evidenceRows = await service.from("voice_conversation_candidates").select("id").eq("conversation_output_id", safetyOutputId);
    if (evidenceRows.error) throw evidenceRows.error;
    evidenceRows.data.forEach((row) => registry.registerVoiceCandidate(row.id, tenantA.representationId));

    const processingLineages = await Promise.all(["captured-failed", "captured-extracting-failed", "failed-retry"].map((label) => createLineage(tenantA, label, `call-${label}-${registry.runId}`)));
    const processingOutputs: string[] = [];
    for (const lineage of processingLineages) {
      const output = await capture(tenantA, lineage);
      assert(!output.error && typeof output.data === "string", "processing fixture capture");
      processingOutputs.push(output.data as string);
    }
    assert((await service.rpc("zeya_set_voice_conversation_processing_status", { p_conversation_output_id: processingOutputs[0], p_processing_status: "completed" })).error, "captured to completed through status RPC blocked");
    assert(!(await service.rpc("zeya_set_voice_conversation_processing_status", { p_conversation_output_id: processingOutputs[0], p_processing_status: "failed" })).error, "captured to failed");
    assert((await service.rpc("zeya_set_voice_conversation_processing_status", { p_conversation_output_id: processingOutputs[0], p_processing_status: "captured" })).error, "failed to captured blocked");
    assert(!(await service.rpc("zeya_set_voice_conversation_processing_status", { p_conversation_output_id: processingOutputs[1], p_processing_status: "extracting" })).error, "captured to extracting");
    assert(!(await service.rpc("zeya_set_voice_conversation_processing_status", { p_conversation_output_id: processingOutputs[1], p_processing_status: "failed" })).error, "extracting to failed");
    assert(!(await service.rpc("zeya_set_voice_conversation_processing_status", { p_conversation_output_id: processingOutputs[2], p_processing_status: "failed" })).error, "captured to failed retry fixture");
    assert(!(await service.rpc("zeya_set_voice_conversation_processing_status", { p_conversation_output_id: processingOutputs[2], p_processing_status: "extracting" })).error, "failed to extracting");

    const tenantBLineage = await createLineage(tenantB, "tenant-b", `call-tenant-b-${registry.runId}`);
    const tenantBOutput = await capture(tenantB, tenantBLineage);
    assert(!tenantBOutput.error && typeof tenantBOutput.data === "string", "Tenant B output");
    const tenantBCandidates = await store(tenantBOutput.data as string, [candidate()]);
    assert(!tenantBCandidates.error && tenantBCandidates.data === 1, "Tenant B candidate");
    const tenantBRows = await service.from("voice_conversation_candidates").select("id").eq("conversation_output_id", tenantBOutput.data as string);
    if (tenantBRows.error) throw tenantBRows.error;
    tenantBRows.data.forEach((row) => registry.registerVoiceCandidate(row.id, tenantB.representationId));
    assert((await tenantA.user.client.from("voice_conversation_outputs").select("id").eq("id", tenantBOutput.data as string)).data?.length === 0, "Tenant A cannot read Tenant B output");
    assert((await tenantA.user.client.from("voice_conversation_candidates").select("id").eq("conversation_output_id", tenantBOutput.data as string)).data?.length === 0, "Tenant A cannot read Tenant B candidates");
    const wrongPurge = await service.rpc("zeya_purge_business_representation", { p_business_representation_id: tenantA.representationId, p_expected_business_id: tenantB.businessId });
    assert(wrongPurge.error, "wrong expected Business purge rejected");
    assert((await service.from("voice_conversation_outputs").select("id").eq("id", firstOutputId).single()).data?.id === firstOutputId, "failed purge preserves output");
    assert((await service.from("voice_conversation_outputs").select("id").eq("id", tenantBOutput.data as string).single()).data?.id === tenantBOutput.data, "failed Tenant A purge preserves Tenant B");

    assert(JSON.stringify(await canonicalSnapshot(tenantA.representationId)) === JSON.stringify(canonicalBeforeA), "Tenant A Canonical State unchanged by Phase 2");
    assert(JSON.stringify(await canonicalSnapshot(tenantB.representationId)) === JSON.stringify(canonicalBeforeB), "Tenant B Canonical State unchanged by Phase 2");

    const disabledAudit = await fetch(`${server.baseUrl}/api/elevenlabs/variables-audit`, { method: "POST" });
    assert(disabledAudit.status === 410, "ElevenLabs variables audit permanently disabled");

    console.log("Voice Conversation Deployed\n\nCatalog surface — PASS\nAuthorization — PASS\nZeya authenticated capture — PASS\nZeya replay and conflict — PASS\nVeya shared capture and extraction — PASS\nCapture idempotency — PASS\nProvider provenance — PASS\nStatus-only finalization — PASS\nCandidate extraction — PASS\nZero-candidate extraction — PASS\nCandidate RPC safety — PASS\nProcessing state machine — PASS\nTenant isolation — PASS\nWrong-Business purge safety — PASS\nCanonical safety — PASS\nLogging endpoint safety — PASS");
  } finally {
    const lineageIds = registry.voiceLineages.map((row) => row.id);
    if (lineageIds.length > 0) {
      const untrackedOutputs = await service.from("voice_conversation_outputs").select("id,business_representation_id").in("voice_context_id", lineageIds);
      if (!untrackedOutputs.error) {
        for (const output of untrackedOutputs.data) {
          if (!registry.voiceOutputs.some((row) => row.id === output.id)) registry.registerVoiceOutput(output.id, output.business_representation_id);
        }
        const outputIds = untrackedOutputs.data.map((row) => row.id);
        if (outputIds.length > 0) {
          const untrackedCandidates = await service.from("voice_conversation_candidates").select("id,business_representation_id").in("conversation_output_id", outputIds);
          if (!untrackedCandidates.error) for (const candidateRow of untrackedCandidates.data) {
            if (!registry.voiceCandidates.some((row) => row.id === candidateRow.id)) registry.registerVoiceCandidate(candidateRow.id, candidateRow.business_representation_id);
          }
        }
      }
    }
    cleanup = await cleanupFixtures(service, registry);
    console.log(`Phase 2 cleanup — ${cleanup.success ? "PASS" : "FAIL"}`);
    await server.stop();
    console.log("Server cleanup — PASS");
  }
  if (!cleanup?.success) throw new Error(cleanup?.failures.join(", "));
}

const keepAlive = setInterval(() => undefined, 1000);
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Voice Conversation deployed test failed");
  process.exitCode = 1;
}).finally(() => clearInterval(keepAlive));
