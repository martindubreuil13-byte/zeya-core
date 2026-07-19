import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { startTestServer, type TestServer } from "./representation-state-test-server";
import { FixtureRegistry } from "./representation-state-test-fixtures";
import { cleanupFixtures } from "./representation-state-test-cleanup";
import { createExperienceToken, hashExperiencePhone, hashExperienceToken } from "../../lib/experience/public-session-server";
import { saveVoiceRepresentationLineage, attachVoiceProviderIdentifiers } from "../../lib/voice/persistence/representation-lineage-repository";
import { captureAndExtractConversationOutput } from "../../lib/voice/conversation-output/service";
import { assembleVoiceRepresentationContext, buildVoiceProviderVariables } from "../../lib/voice/representation-context";

loadEnvConfig(process.cwd());

type JsonResult = { status: number; body: Record<string, unknown>; raw: string };
type Tenant = { userId: string; token: string; businessId: string; representationId: string; versionId: string };
type TenantIdentity = { userId: string; token: string; businessId: string; client: SupabaseClient };
type FinalizedSession = { token: string; id: string; zeyaVoiceContextId: string; zeyaOutputId: string; canonicalVersionId: string; createdAt: string };
type ProviderFixture = FinalizedSession & { dispatchId: string; voiceContextId: string; conversationId: string; callId: string; phoneHash: string };

function requireValue<T>(value: T | null | undefined, message: string): T {
  assert(value !== null && value !== undefined, message);
  return value;
}

async function json(base: string, path: string, init: RequestInit = {}): Promise<JsonResult> {
  const response = await fetch(base + path, init);
  const raw = await response.text();
  const type = response.headers.get("content-type") ?? "";
  assert(type.includes("application/json"), `non-JSON response from ${path}`);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error(`invalid JSON from ${path}`); }
  return { status: response.status, body, raw };
}

async function createTenantIdentity(admin: SupabaseClient, registry: FixtureRegistry, label: string): Promise<TenantIdentity> {
  const email = `completion-${label}-${registry.runId}@zeya.test`;
  const password = `T-${crypto.randomUUID()}!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const userId = created.data.user.id;
  registry.registerAuthUser(userId, email);
  const browser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const signed = await browser.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const token = signed.data.session!.access_token;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const business = await client.from("businesses").insert({ business_name: `Completion ${label} ${registry.runId}`, user_id: userId }).select("id").single();
  if (business.error) throw business.error;
  registry.registerBusiness(business.data.id, userId);
  return { userId, token, businessId: business.data.id, client };
}

async function createTenant(admin: SupabaseClient, registry: FixtureRegistry, baseUrl: string, label: string, identity: TenantIdentity): Promise<Tenant> {
  const { userId, token, businessId, client } = identity;
  const evidence = await json(baseUrl, "/api/representation/evidence", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ businessId, statement: `Completion fixture ${label}`, sourceDescription: "Phase 4B.3 deployed matrix" }) });
  assert.equal(evidence.status, 201, `tenant ${label} Evidence`);
  const data = evidence.body.data as Record<string, unknown>;
  const representationId = String(data.businessRepresentationId);
  const proposalId = String(data.proposalId);
  registry.registerBusinessRepresentation(representationId, businessId);
  registry.registerEvidence(String(data.evidenceId));
  registry.registerObservation(String(data.observationId));
  registry.registerProposal(proposalId);
  if (data.requiresApproval === true) {
    const approval = await client.from("approval_decisions").insert({ business_representation_id: representationId, representation_proposal_id: proposalId, decision: "approved", approver_user_id: userId }).select("id").single();
    if (approval.error) throw approval.error;
    registry.registerApproval(approval.data.id);
  }
  const version = await json(baseUrl, "/api/representation/versions", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ businessRepresentationId: representationId, proposalId, elementValues: { offer: `Completion offer ${label}` }, confidenceScore: 80 }) });
  if (version.status !== 201) {
    const activeServer = currentTestServer;
    throw new Error(
      `tenant ${label} Version expected 201, received ${version.status}; `
      + `method=POST route=/api/representation/versions; `
      + `response=${JSON.stringify(version.body)}; `
      + `fixtures=${JSON.stringify({ businessId, representationId, proposalId, userId })}; `
      + `server=${JSON.stringify(activeServer?.recentLogs() ?? '')}`
    );
  }
  const versionData = version.body.data as Record<string, unknown>;
  const versionId = String(versionData.versionId);
  registry.registerVersion(versionId);
  registry.registerConfidenceAssessment(String(versionData.confidenceAssessmentId));
  // current_version_id is set atomically with Version creation by zeya_create_canonical_version_atomic RPC
  const domain = await client.from("representation_domains").select("id").eq("business_representation_id", representationId).limit(1).single();
  if (domain.error) throw domain.error;
  registry.registerDomain(domain.data.id);
  const element = await client.from("representation_elements").insert({ business_representation_id: representationId, representation_domain_id: domain.data.id, element_key: "offer", element_type: "fact", field_sensitivity: "operational", claim_eligibility: "approved_for_external_use", is_disputed: false, current_value_version_id: versionId }).select("id").single();
  if (element.error) throw element.error;
  registry.registerElement(element.data.id);
  return { userId, token, businessId, representationId, versionId };
}

async function createFinalizedSession(admin: SupabaseClient, registry: FixtureRegistry, server: TestServer, tenant: Tenant, createDirectly = false): Promise<FinalizedSession> {
  let token: string;
  if (createDirectly) {
    token = createExperienceToken();
    const voiceContextId = crypto.randomUUID();
    const conversationId = `public_zeya_${voiceContextId}`;
    const created = await admin.rpc("zeya_create_public_experience_session", { p_token_hash: hashExperienceToken(token), p_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), p_voice_context_id: voiceContextId, p_worker_brief_id: `matrix_zeya_${crypto.randomUUID()}`, p_conversation_id: conversationId, p_tenant_user_id: tenant.userId, p_business_id: tenant.businessId, p_business_representation_id: tenant.representationId, p_canonical_version_id: tenant.versionId, p_context_generated_at: new Date().toISOString(), p_authorized_element_keys: ["offer"], p_agent_id: "zeya-public-experience", p_context_schema_version: "1.0", p_prompt_assembly_version: "1.0" });
    if (created.error) throw new Error(`direct session fixture failed: ${created.error.code}`);
    registry.registerVoiceLineage(voiceContextId, tenant.representationId);
  } else {
    const created = await json(server.baseUrl, "/api/experience/session", { method: "POST" });
    assert.equal(created.status, 200, "session creation");
    token = String(created.body.experience_token);
  }
  const row = await admin.from("public_experience_sessions").select("id,zeya_voice_context_id,canonical_version_id,created_at").eq("token_hash", hashExperienceToken(token)).single();
  if (row.error) throw row.error;
  registry.registerPublicExperienceSession(row.data.id);
  registry.registerVoiceLineage(row.data.zeya_voice_context_id, tenant.representationId);
  const incomplete = await json(server.baseUrl, "/api/experience/session/finalize-zeya", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, transcript: [{ role: "assistant", text: "What is the best phone number to reach you on?" }] }) });
  assert.equal(incomplete.status, 409, "unanswered assistant phone question was finalized");
  assert.equal(incomplete.body.error, "incomplete_handoff", "incomplete handoff error contract");
  const finalized = await json(server.baseUrl, "/api/experience/session/finalize-zeya", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, transcript: [{ role: "assistant", text: "What are you selling?" }, { role: "user", text: "A bounded completion test service." }] }) });
  assert.equal(finalized.status, 200, "Zeya finalization");
  const stored = await admin.from("public_experience_sessions").select("zeya_conversation_output_id").eq("id", row.data.id).single();
  if (stored.error) throw stored.error;
  const zeyaOutputId = requireValue(stored.data.zeya_conversation_output_id, "Zeya output missing");
  registry.registerVoiceOutput(zeyaOutputId, tenant.representationId);
  return { token, id: row.data.id, zeyaVoiceContextId: row.data.zeya_voice_context_id, zeyaOutputId, canonicalVersionId: row.data.canonical_version_id, createdAt: row.data.created_at };
}

async function providerFixture(admin: SupabaseClient, registry: FixtureRegistry, server: TestServer, tenant: Tenant, state: "call_requested" | "call_correlation_pending" | "dispatch_resolution_pending", createSessionDirectly = false): Promise<ProviderFixture> {
  const session = await createFinalizedSession(admin, registry, server, tenant, createSessionDirectly);
  const sessionRecord = await admin.from("public_experience_sessions").select("canonical_version_id,business_id,business_representation_id").eq("id", session.id).single();
  if (sessionRecord.error) throw sessionRecord.error;
  const dispatchId = `matrix_${crypto.randomUUID()}`;
  registry.registerMission(dispatchId);
  const phoneHash = hashExperiencePhone(session.token, "+15550007777");
  const reserved = await admin.rpc("zeya_request_public_experience_call", { p_token_hash: hashExperienceToken(session.token), p_dispatch_id: dispatchId, p_phone_hash: phoneHash });
  assert(!reserved.error && reserved.data === "call_requested", "reservation acquisition failed");
  const voiceContextId = crypto.randomUUID();
  const conversationId = `matrix_conversation_${crypto.randomUUID()}`;
  const callId = `matrix_call_${crypto.randomUUID()}`;
  const currentVersion = await admin.from("business_representations").select("current_version_id").eq("id", tenant.representationId).single();
  if (currentVersion.error) throw currentVersion.error;
  console.log("Lineage snapshot timeline", {
    state,
    sessionId: session.id,
    sessionCreatedAt: session.createdAt,
    sessionCanonicalVersionId: sessionRecord.data.canonical_version_id,
    fixtureVersionId: tenant.versionId,
    currentVersionId: currentVersion.data.current_version_id,
    dispatchId,
  });
  await saveVoiceRepresentationLineage({ db: admin, voiceContextId, workerBriefId: `matrix_brief_${crypto.randomUUID()}`, missionId: dispatchId, conversationId, lineage: { tenantUserId: tenant.userId, businessId: tenant.businessId, businessRepresentationId: tenant.representationId, canonicalVersionId: sessionRecord.data.canonical_version_id, generatedAt: new Date().toISOString(), authorizedElementKeys: ["offer"], provisionalMode: false, agentId: "veya-matrix", agentType: "CALLER", agentRole: "outbound_representative", contextSchemaVersion: "1.0", promptAssemblyVersion: "1.0" } });
  await attachVoiceProviderIdentifiers({ db: admin, voiceContextId, conversationId, providerCallId: callId });
  registry.registerVoiceLineage(voiceContextId, tenant.representationId);
  if (state === "call_correlation_pending") {
    const accepted = await admin.rpc("zeya_record_public_experience_provider_acceptance", { p_token_hash: hashExperienceToken(session.token), p_dispatch_id: dispatchId, p_veya_voice_context_id: voiceContextId, p_provider_conversation_id: conversationId, p_provider_call_id: callId });
    if (accepted.error) throw new Error(`correlation-pending fixture failed: ${accepted.error.code} ${accepted.error.message} (session canonical_version_id: ${sessionRecord.data.canonical_version_id}, fixture versionId: ${tenant.versionId}, lineage mission_id: ${dispatchId})`);
    assert(accepted.data === state, `correlation-pending returned ${accepted.data} not ${state}`);
  } else if (state === "dispatch_resolution_pending") {
    const pending = await admin.rpc("zeya_mark_public_experience_dispatch_resolution_pending", { p_token_hash: hashExperienceToken(session.token), p_dispatch_id: dispatchId, p_phone_hash: phoneHash, p_expected_state: "call_requested" });
    if (pending.error) throw new Error(`resolution-pending fixture failed: ${pending.error.code} ${pending.error.message}`);
    assert(pending.data === state, `resolution-pending returned ${pending.data} not ${state}`);
  }
  return { ...session, dispatchId, voiceContextId, conversationId, callId, phoneHash };
}

async function signAndPost(baseUrl: string, payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return json(baseUrl, "/api/webhooks/elevenlabs", { method: "POST", headers: { "content-type": "application/json", "elevenlabs-signature": `t=${timestamp},v0=${signature}` }, body: payload });
}

async function stopOwnedServer(server: TestServer | null) {
  if (!server?.process || server.process.exitCode !== null) return;
  server.process.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    server.process!.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}

let currentTestServer: TestServer | null = null;

async function cleanupMatrix(admin: SupabaseClient, registry: FixtureRegistry) {
  const cleanup = await cleanupFixtures(admin, registry);
  const substantive = cleanup.failures.filter(message => !message.endsWith("output deletion count mismatch") && !message.endsWith("candidate deletion count mismatch"));
  for (const representation of registry.representations) {
    if ((await admin.from("business_representations").select("id").eq("id", representation.id).maybeSingle()).data) substantive.push(`representation ${representation.id} remains`);
  }
  for (const output of registry.voiceOutputs) {
    if ((await admin.from("voice_conversation_outputs").select("id").eq("id", output.id).maybeSingle()).data) substantive.push(`output ${output.id} remains`);
  }
  for (const candidate of registry.voiceCandidates) {
    if ((await admin.from("voice_conversation_candidates").select("id").eq("id", candidate.id).maybeSingle()).data) substantive.push(`candidate ${candidate.id} remains`);
  }
  if (registry.webhookReceiptIds.length > 0) {
    const receipts = await admin.from("voice_provider_webhook_receipts").select("id").in("id", registry.webhookReceiptIds);
    if (receipts.error) substantive.push(`receipt verification ${receipts.error.code}`);
    else if ((receipts.data?.length ?? 0) > 0) substantive.push("tracked webhook receipt remains");
  }
  if (registry.publicExperienceSessionIds.length > 0) {
    const sessions = await admin.from("public_experience_sessions").select("id").in("id", registry.publicExperienceSessionIds);
    if (sessions.error) substantive.push(`session verification ${sessions.error.code}`);
    else if ((sessions.data?.length ?? 0) > 0) substantive.push("tracked public experience session remains");
  }
  if (registry.missionIds.length > 0) {
    const lineages = await admin.from("voice_representation_lineage").select("voice_context_id").in("mission_id", registry.missionIds);
    if (lineages.error) substantive.push(`mission lineage verification ${lineages.error.code}`);
    else if ((lineages.data?.length ?? 0) > 0) substantive.push("tracked mission lineage remains");
  }
  for (const business of registry.businesses) {
    const row = await admin.from("businesses").select("user_id").eq("id", business.id).maybeSingle();
    if (row.data) {
      assert.equal(row.data.user_id, business.userId, "cleanup Business owner mismatch");
      const deletion = await admin.from("businesses").delete().eq("id", business.id).eq("user_id", business.userId);
      if (deletion.error) substantive.push(`business ${business.id}: ${deletion.error.code}`);
    }
  }
  for (const user of registry.authUsers) {
    const existing = await admin.auth.admin.getUserById(user.id);
    if (!existing.error && existing.data.user) {
      const deletion = await admin.auth.admin.deleteUser(user.id);
      if (deletion.error) substantive.push(`auth ${user.id}: deletion failed`);
    }
  }
  if (substantive.length) {
    await registry.writeRecovery(substantive);
    throw new Error(`cleanup failed: ${substantive.join(", ")}`);
  }
  await registry.clearRecovery();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && key, "Supabase test configuration missing");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const registry = new FixtureRegistry();
  const webhookSecret = crypto.randomBytes(32).toString("hex");
  process.env.PUBLIC_EXPERIENCE_PROVIDER = "MOCK";
  process.env.PUBLIC_EXPERIENCE_TEST_MODE = "true";
  process.env.ELEVENLABS_WEBHOOK_SECRET = webhookSecret;
  let server: TestServer | null = null;
  let realtimeMock: HttpServer | null = null;
  const realtimeRequests: Array<Record<string, unknown>> = [];
  let cleanupPassed = false;
  try {
    if (process.env.PUBLIC_EXPERIENCE_LIVE_LEARNING_TEST === "true") {
      realtimeMock = createHttpServer((request, response) => {
        let raw = "";
        request.on("data", chunk => { raw += String(chunk); });
        request.on("end", () => {
          try { realtimeRequests.push(JSON.parse(raw) as Record<string, unknown>); } catch { /* assertion below reports missing payload */ }
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ value: `mock_realtime_${crypto.randomUUID()}` }));
        });
      });
      await new Promise<void>((resolve, reject) => { realtimeMock!.once("error", reject); realtimeMock!.listen(0, "127.0.0.1", resolve); });
      const address = realtimeMock.address();
      assert(address && typeof address !== "string", "realtime mock address unavailable");
      process.env.OPENAI_REALTIME_SESSION_URL = `http://127.0.0.1:${address.port}/v1/realtime/client_secrets`;
    }
    const identityA = await createTenantIdentity(admin, registry, "a");
    const identityB = await createTenantIdentity(admin, registry, "b");
    server = await startTestServer({ envOverrides: { ZEYA_EXPERIENCE_BUSINESS_ID: identityA.businessId }, allowExternal: false });
    currentTestServer = server;
    const tenantA = await createTenant(admin, registry, server.baseUrl, "a", identityA);
    const tenantB = await createTenant(admin, registry, server.baseUrl, "b", identityB);
    const canonicalBeforeA = (await admin.from("business_representations").select("current_version_id").eq("id", tenantA.representationId).single()).data!.current_version_id;
    let canonicalExpectedA = canonicalBeforeA;
    const canonicalBeforeB = (await admin.from("business_representations").select("current_version_id").eq("id", tenantB.representationId).single()).data!.current_version_id;

    const receiptSession = await createFinalizedSession(admin, registry, server, tenantA);
    const eventKey = `matrix_receipt_${registry.runId}`;
    const beginArgs = { p_event_key: eventKey, p_event_type: "matrix_event", p_provider_conversation_id: `conv_${registry.runId}`, p_payload_hash: crypto.createHash("sha256").update("matrix").digest("hex"), p_public_experience_session_id: receiptSession.id };
    const first = await admin.rpc("zeya_begin_voice_webhook_receipt", beginArgs);
    assert(!first.error && first.data.status === "acquired" && first.data.attempt === 1, "receipt attempt 1");
    const receipt = await admin.from("voice_provider_webhook_receipts").select("id").eq("event_key", eventKey).single();
    if (receipt.error) throw receipt.error;
    registry.registerWebhookReceipt(receipt.data.id);
    const duplicate = await admin.rpc("zeya_begin_voice_webhook_receipt", beginArgs);
    assert(!duplicate.error && duplicate.data.status === "in_progress" && duplicate.data.attempt === 1, "active duplicate fencing");
    for (const conflict of [
      { ...beginArgs, p_event_type: "other" },
      { ...beginArgs, p_payload_hash: "f".repeat(64) },
      { ...beginArgs, p_provider_conversation_id: "other_conversation" },
    ]) assert((await admin.rpc("zeya_begin_voice_webhook_receipt", conflict)).error, "receipt identity conflict accepted");
    const failed = await admin.rpc("zeya_finish_voice_webhook_receipt", { p_event_key: eventKey, p_expected_attempt: 1, p_succeeded: false });
    assert(!failed.error && failed.data === "failed", "receipt failure");
    const reacquired = await admin.rpc("zeya_begin_voice_webhook_receipt", beginArgs);
    assert(!reacquired.error && reacquired.data.status === "acquired" && reacquired.data.attempt === 2, "receipt reacquisition");
    assert.equal((await admin.rpc("zeya_finish_voice_webhook_receipt", { p_event_key: eventKey, p_expected_attempt: 1, p_succeeded: true })).data, "stale_attempt");
    assert.equal((await admin.rpc("zeya_finish_voice_webhook_receipt", { p_event_key: eventKey, p_expected_attempt: 1, p_succeeded: false })).data, "stale_attempt");
    assert.equal((await admin.rpc("zeya_finish_voice_webhook_receipt", { p_event_key: eventKey, p_expected_attempt: 2, p_succeeded: true })).data, "completed");
    const completedDuplicate = await admin.rpc("zeya_begin_voice_webhook_receipt", beginArgs);
    assert(!completedDuplicate.error && completedDuplicate.data.status === "completed" && completedDuplicate.data.attempt === 2, "completed receipt reopened");
    console.log("Receipt acquisition and fencing ......... PASS");

    const unresolved = await createFinalizedSession(admin, registry, server, tenantA);
    const unresolvedDispatch = `matrix_unresolved_${crypto.randomUUID()}`;
    const unresolvedPhone = "+15550007777";
    const unresolvedPhoneHash = hashExperiencePhone(unresolved.token, unresolvedPhone);
    const unresolvedReservation = await admin.rpc("zeya_request_public_experience_call", { p_token_hash: hashExperienceToken(unresolved.token), p_dispatch_id: unresolvedDispatch, p_phone_hash: unresolvedPhoneHash });
    assert(!unresolvedReservation.error && unresolvedReservation.data === "call_requested", "unresolved reservation fixture");
    const beforeBriefs = (await admin.from("worker_briefs").select("id", { count: "exact", head: true }).eq("mission_id", unresolvedDispatch)).count ?? 0;
    const unresolvedReplay = await json(server.baseUrl, "/api/experience/delegate-call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ experienceToken: unresolved.token, phone: unresolvedPhone }) });
    assert.equal(unresolvedReplay.status, 202, "existing reservation response");
    assert.equal(unresolvedReplay.body.status, "dispatch_resolution_pending");
    const pendingRow = await admin.from("public_experience_sessions").select("state").eq("id", unresolved.id).single();
    assert.equal(pendingRow.data?.state, "dispatch_resolution_pending", "unresolved outcome not persisted");
    const secondReplay = await json(server.baseUrl, "/api/experience/delegate-call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ experienceToken: unresolved.token, phone: unresolvedPhone }) });
    assert.equal(secondReplay.status, 202, "pending replay response");
    assert.equal((await admin.from("worker_briefs").select("id", { count: "exact", head: true }).eq("mission_id", unresolvedDispatch)).count ?? 0, beforeBriefs, "existing reservation redispatched provider work");

    for (const sourceState of ["call_requested", "call_correlation_pending", "dispatch_resolution_pending"] as const) {
      const fixture = await providerFixture(admin, registry, server, tenantA, sourceState);
      const repair = await admin.rpc("zeya_repair_public_experience_dispatch", { p_veya_voice_context_id: fixture.voiceContextId, p_provider_conversation_id: fixture.conversationId, p_provider_call_id: fixture.callId });
      assert(!repair.error && repair.data === "call_dispatched", `${sourceState} repair`);
      const stored = await admin.from("public_experience_sessions").select("state,dispatch_id,veya_voice_context_id,provider_conversation_id,provider_call_id,business_id,business_representation_id,canonical_version_id").eq("id", fixture.id).single();
      assert(!stored.error && stored.data.state === "call_dispatched" && stored.data.dispatch_id === fixture.dispatchId && stored.data.veya_voice_context_id === fixture.voiceContextId && stored.data.provider_conversation_id === fixture.conversationId && stored.data.provider_call_id === fixture.callId && stored.data.business_id === tenantA.businessId && stored.data.business_representation_id === tenantA.representationId && stored.data.canonical_version_id === fixture.canonicalVersionId, "repair identity mismatch");
      assert((await admin.rpc("zeya_repair_public_experience_dispatch", { p_veya_voice_context_id: fixture.voiceContextId, p_provider_conversation_id: fixture.conversationId, p_provider_call_id: `${fixture.callId}_wrong` })).error, "conflicting repair accepted");
    }
    console.log("Dispatch reservation and repair ......... PASS");

    const success = await providerFixture(admin, registry, server, tenantA, "dispatch_resolution_pending");
    const preReflection = await json(server.baseUrl, "/api/experience/session/reflection", { headers: { Authorization: `Bearer ${success.token}` } });
    assert.equal(preReflection.status, 409, "premature reflection");
    const repaired = await admin.rpc("zeya_repair_public_experience_dispatch", { p_veya_voice_context_id: success.voiceContextId, p_provider_conversation_id: success.conversationId, p_provider_call_id: success.callId });
    assert(!repaired.error && repaired.data === "call_dispatched", "success repair");
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ type: "post_call_transcription", event_timestamp: timestamp, data: { conversation_id: success.conversationId, call_id: success.callId, agent_id: "matrix_agent", status: "done", transcript: [{ role: "agent", message: "Tell me what matters." }, { role: "user", message: "Contact me at person@example.com or +1 555 000 7777 and see https://example.com for a concise follow-up." }] } });
    const receiptsBefore = (await admin.from("voice_provider_webhook_receipts").select("id", { count: "exact", head: true }).eq("public_experience_session_id", success.id)).count ?? 0;
    const evidenceBefore = (await admin.from("evidence").select("id", { count: "exact", head: true }).eq("business_representation_id", tenantA.representationId)).count ?? 0;
    const candidatesBefore = (await admin.from("voice_conversation_candidates").select("id", { count: "exact", head: true }).eq("business_representation_id", tenantA.representationId)).count ?? 0;
    const versionsBefore = (await admin.from("representation_versions").select("id", { count: "exact", head: true }).eq("business_representation_id", tenantA.representationId)).count ?? 0;
    const currentBefore = (await admin.from("business_representations").select("current_version_id").eq("id", tenantA.representationId).single()).data?.current_version_id;
    assert.equal((await json(server.baseUrl, "/api/webhooks/elevenlabs", { method: "POST", headers: { "content-type": "application/json" }, body: payload })).status, 401);
    assert.equal((await json(server.baseUrl, "/api/webhooks/elevenlabs", { method: "POST", headers: { "content-type": "application/json", "elevenlabs-signature": "malformed" }, body: payload })).status, 401);
    const originalSignature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
    assert.equal((await json(server.baseUrl, "/api/webhooks/elevenlabs", { method: "POST", headers: { "content-type": "application/json", "elevenlabs-signature": `t=${timestamp},v0=${originalSignature}` }, body: payload + " " })).status, 401);
    assert.equal((await signAndPost(server.baseUrl, payload, webhookSecret, timestamp - 1801)).status, 401);
    assert.equal((await admin.from("voice_provider_webhook_receipts").select("id", { count: "exact", head: true }).eq("public_experience_session_id", success.id)).count ?? 0, receiptsBefore, "unauthenticated payload processed");
    const valid = await signAndPost(server.baseUrl, payload, webhookSecret, timestamp);
    assert.equal(valid.status, 200, `valid webhook failed: ${valid.raw}`);
    const validReplay = await signAndPost(server.baseUrl, payload, webhookSecret, timestamp);
    assert.equal(validReplay.status, 200, "signed duplicate failed");
    const storedSuccess = await admin.from("public_experience_sessions").select("state,veya_conversation_output_id,call_completed_at").eq("id", success.id).single();
    assert(!storedSuccess.error && storedSuccess.data.state === "reflection_ready" && storedSuccess.data.veya_conversation_output_id && storedSuccess.data.call_completed_at, "successful completion state");
    registry.registerVoiceOutput(storedSuccess.data.veya_conversation_output_id, tenantA.representationId);
    const candidates = await admin.from("voice_conversation_candidates").select("id,review_status,business_representation_id").eq("conversation_output_id", storedSuccess.data.veya_conversation_output_id);
    assert(!candidates.error && candidates.data.length <= 1 && candidates.data.every(row => row.review_status === "pending_review" && row.business_representation_id === tenantA.representationId), "candidate review scope");
    assert.equal(candidates.data.length, 1, "deterministic provider transcript produced no governed candidate");
    candidates.data.forEach(row => registry.registerVoiceCandidate(row.id, tenantA.representationId));
    const interactionEvidence = await admin.from("evidence").select("id,business_representation_id,source_type,raw_statement,statement_hash,source_public_experience_session_id,source_voice_conversation_output_id,source_voice_context_id,source_tenant_user_id,source_business_id,source_canonical_version_id,source_mission_id,source_provider_conversation_id,source_provider_call_id").eq("source_voice_conversation_output_id", storedSuccess.data.veya_conversation_output_id).single();
    assert(!interactionEvidence.error && interactionEvidence.data, "interaction Evidence missing");
    const evidenceRow = interactionEvidence.data;
    registry.registerEvidence(evidenceRow.id);
    assert.equal(evidenceRow.business_representation_id, tenantA.representationId);
    assert.equal(evidenceRow.source_type, "call_result");
    assert.equal(evidenceRow.source_public_experience_session_id, success.id);
    assert.equal(evidenceRow.source_voice_conversation_output_id, storedSuccess.data.veya_conversation_output_id);
    assert.equal(evidenceRow.source_voice_context_id, success.voiceContextId);
    assert.equal(evidenceRow.source_tenant_user_id, tenantA.userId);
    assert.equal(evidenceRow.source_business_id, tenantA.businessId);
    assert.equal(evidenceRow.source_canonical_version_id, success.canonicalVersionId);
    assert.equal(evidenceRow.source_mission_id, success.dispatchId);
    assert.equal(evidenceRow.source_provider_conversation_id, success.conversationId);
    assert.equal(evidenceRow.source_provider_call_id, success.callId);
    assert(evidenceRow.raw_statement && evidenceRow.statement_hash, "sanitized Evidence content/hash missing");
    assert(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(evidenceRow.raw_statement));
    assert(!/(?:\+?\d[\d\s().-]{6,}\d)/.test(evidenceRow.raw_statement));
    assert(!/https?:\/\/\S+/i.test(evidenceRow.raw_statement));
    const evidenceAudit = await admin.from("audit_events").select("id,event_type,actor_system,details").eq("evidence_id", evidenceRow.id).eq("event_type", "evidence_created").single();
    assert(!evidenceAudit.error && evidenceAudit.data?.actor_system === "public_experience_governed_learning" && (evidenceAudit.data.details as Record<string, unknown>)?.status === "pending_review", "governed Evidence audit missing");
    const governedCandidate = candidates.data[0];
    const candidateRow = await admin.from("voice_conversation_candidates").select("source_evidence_id,tenant_user_id,business_id,business_representation_id,canonical_version_id,relevant_element_keys,transcript_trust_level,review_status,content,source_reference,confidence,extraction_rationale").eq("id", governedCandidate.id).single();
    assert(!candidateRow.error && candidateRow.data?.source_evidence_id === evidenceRow.id && candidateRow.data.tenant_user_id === tenantA.userId && candidateRow.data.business_id === tenantA.businessId && candidateRow.data.business_representation_id === tenantA.representationId && candidateRow.data.canonical_version_id === success.canonicalVersionId && candidateRow.data.transcript_trust_level === "provider_attested" && candidateRow.data.review_status === "pending_review", "governed candidate provenance mismatch");
    assert(Array.isArray(candidateRow.data.relevant_element_keys) && candidateRow.data.relevant_element_keys.every((key: string) => key === "offer"), "candidate used unauthorized Element key");
    assert(candidateRow.data.content && candidateRow.data.source_reference && candidateRow.data.extraction_rationale && candidateRow.data.confidence !== null, "candidate structure incomplete");
    assert.equal((await admin.from("evidence").select("id", { count: "exact", head: true }).eq("business_representation_id", tenantA.representationId)).count, evidenceBefore + 1);
    assert.equal((await admin.from("voice_conversation_candidates").select("id", { count: "exact", head: true }).eq("business_representation_id", tenantA.representationId)).count, candidatesBefore + 1);
    assert.equal((await admin.from("representation_versions").select("id", { count: "exact", head: true }).eq("business_representation_id", tenantA.representationId)).count, versionsBefore);
    assert.equal((await admin.from("business_representations").select("current_version_id").eq("id", tenantA.representationId).single()).data?.current_version_id, currentBefore);
    const outputCount = await admin.from("voice_conversation_outputs").select("id", { count: "exact", head: true }).eq("voice_context_id", success.voiceContextId);
    assert.equal(outputCount.count, 1, "duplicate output");
    console.log("Signed webhook and completion ........... PASS");
    console.log("Interaction Evidence provenance ........ PASS");
    console.log("Governed candidate creation ............ PASS");
    console.log("Canonical state unchanged .............. PASS");

    if (process.env.PUBLIC_EXPERIENCE_LIVE_LEARNING_TEST === "true") {
      const approvedStatement = "Founder-approved live learning knowledge";
      const requestKey = crypto.randomUUID();
      const staleVoiceContextId = crypto.randomUUID();
      await saveVoiceRepresentationLineage({ db: admin, voiceContextId: staleVoiceContextId, workerBriefId: `stale-${registry.runId}`, missionId: `stale-${registry.runId}`, conversationId: `stale-${registry.runId}`, lineage: { tenantUserId: tenantA.userId, businessId: tenantA.businessId, businessRepresentationId: tenantA.representationId, canonicalVersionId: canonicalBeforeA, generatedAt: new Date().toISOString(), authorizedElementKeys: ["offer"], provisionalMode: false, agentId: "zeya-stale-test", agentType: "ZEYA", agentRole: "test", contextSchemaVersion: "1.0", promptAssemblyVersion: "1.0" } });
      registry.registerVoiceLineage(staleVoiceContextId, tenantA.representationId);
      const staleOutput = await captureAndExtractConversationOutput({ db: admin, capture: { voiceContextId: staleVoiceContextId, conversationId: `stale-${registry.runId}`, provider: "openai_realtime", channel: "zeya_realtime", captureSource: "authenticated_client_relay", transcriptTrustLevel: "authenticated_client_relay", providerAttested: false, submittedBy: tenantA.userId, completedAt: new Date().toISOString(), transcript: [{ role: "customer", text: "Stale baseline candidate" }], transcriptStatus: "finalized", conversationStatus: "completed", completionReason: "test" }, extractionModel: async () => [{ candidateType: "possible_representation_gap", content: { summary: "Stale baseline candidate" }, speakerRole: "customer", statementKind: "assertion", sourceReference: { turnIndexes: [0] }, relevantElementKeys: ["offer"], confidence: 0.8, rationale: "Deterministic stale route fixture" }] });
      registry.registerVoiceOutput(staleOutput.conversationOutputId, tenantA.representationId);
      const staleCandidateQuery = await admin.from("voice_conversation_candidates").select("id").eq("conversation_output_id", staleOutput.conversationOutputId).single();
      if (staleCandidateQuery.error) throw staleCandidateQuery.error;
      registry.registerVoiceCandidate(staleCandidateQuery.data.id, tenantA.representationId);
      const canonicalPayload = {
        action: "canonicalize", candidateId: governedCandidate.id, requestKey,
        statement: approvedStatement, reason: "Founder confirmed the completed call",
        approvalReason: "Approved for the canonical public Experience",
        relatedElementId: (await admin.from("representation_elements").select("id").eq("business_representation_id", tenantA.representationId).eq("element_key", "offer").single()).data?.id,
        elementKey: "offer", elementValues: { offer: { value: approvedStatement } }, overallConfidenceScore: 88,
      };
      const unauthenticated = await json(server.baseUrl, "/api/voice/conversation-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(canonicalPayload) });
      assert.equal(unauthenticated.status, 401, "canonicalization accepted without authentication");
      const malformed = await json(server.baseUrl, "/api/voice/conversation-review", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${tenantA.token}` }, body: JSON.stringify({ ...canonicalPayload, requestKey: "invalid" }) });
      assert.equal(malformed.status, 400, "malformed canonicalization accepted");
      const foreign = await json(server.baseUrl, "/api/voice/conversation-review", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${tenantB.token}` }, body: JSON.stringify(canonicalPayload) });
      assert.equal(foreign.status, 404, "foreign owner canonicalized Experience candidate");
      await stopOwnedServer(server);
      currentTestServer = null;
      const disabledServer = await startTestServer({ envOverrides: { ZEYA_EXPERIENCE_BUSINESS_ID: tenantA.businessId, ZEYA_VOICE_LEARNING_ENABLED: "false", OPENAI_REALTIME_SESSION_URL: process.env.OPENAI_REALTIME_SESSION_URL ?? "" }, allowExternal: false });
      try {
        const disabled = await json(disabledServer.baseUrl, "/api/voice/conversation-review", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${tenantA.token}` }, body: JSON.stringify(canonicalPayload) });
        assert.equal(disabled.status, 404, "disabled canonicalization action remained available");
      } finally { await disabledServer.stop(); }
      server = await startTestServer({ envOverrides: { ZEYA_EXPERIENCE_BUSINESS_ID: tenantA.businessId, ZEYA_VOICE_LEARNING_ENABLED: "true", OPENAI_REALTIME_SESSION_URL: process.env.OPENAI_REALTIME_SESSION_URL ?? "" }, allowExternal: false });
      currentTestServer = server;
      const canonicalized = await json(server.baseUrl, "/api/voice/conversation-review", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${tenantA.token}` },
        body: JSON.stringify(canonicalPayload),
      });
      assert.equal(canonicalized.status, 201, `live-learning route failed: ${canonicalized.raw}`);
      const learned = canonicalized.body.data as Record<string, unknown>;
      for (const key of ["reviewDecisionId", "promotionId", "proposalId", "approvalDecisionId", "canonicalVersionId", "confidenceAssessmentId", "canonicalizationId"]) assert(typeof learned[key] === "string", `canonicalization result missing ${key}`);
      registry.registerConversationReview(String(learned.reviewDecisionId), tenantA.representationId);
      registry.registerConversationPromotion(String(learned.promotionId), tenantA.representationId);
      registry.registerProposal(String(learned.proposalId)); registry.registerApproval(String(learned.approvalDecisionId));
      registry.registerVersion(String(learned.canonicalVersionId)); registry.registerConfidenceAssessment(String(learned.confidenceAssessmentId));
      registry.registerConversationCanonicalization(String(learned.canonicalizationId), tenantA.representationId);
      canonicalExpectedA = String(learned.canonicalVersionId);
      assert.equal((await admin.from("business_representations").select("current_version_id").eq("id", tenantA.representationId).single()).data?.current_version_id, canonicalExpectedA, "canonical pointer did not advance");
      const refreshed = await assembleVoiceRepresentationContext({ db: admin, tenantUserId: tenantA.userId, businessId: tenantA.businessId, agent: { id: "veya-live-learning-b", type: "CALLER", role: "outbound_representative" }, provisionalMode: false });
      assert.equal(refreshed.lineage.canonicalVersionId, canonicalExpectedA, "Conversation B context uses old Version");
      assert(Object.values(refreshed.claims).some(value => value === approvedStatement || (typeof value === "object" && value !== null && (value as Record<string, unknown>).value === approvedStatement)), "approved knowledge absent from claims");
      assert(refreshed.systemContext.includes(approvedStatement), "approved knowledge absent from systemContext");
      const conversationBVoiceContextId = crypto.randomUUID();
      await saveVoiceRepresentationLineage({ db: admin, voiceContextId: conversationBVoiceContextId, workerBriefId: `live-learning-b-${registry.runId}`, missionId: `live-learning-b-${registry.runId}`, conversationId: `live-learning-b-${registry.runId}`, lineage: refreshed.lineage });
      registry.registerVoiceLineage(conversationBVoiceContextId, tenantA.representationId);
      const conversationB = await admin.from("voice_representation_lineage").select("canonical_version_id").eq("voice_context_id", conversationBVoiceContextId).single();
      assert.equal(conversationB.data?.canonical_version_id, canonicalExpectedA, "Conversation B lineage uses old Version");
      const providerVariables = buildVoiceProviderVariables({ context: refreshed, targetName: "Live learning prospect", targetPhone: "+15550001111", objective: "live learning proof" });
      assert(String(providerVariables.authorizedBusinessContext).includes(approvedStatement), "provider variables omit approved knowledge");
      assert.equal(success.canonicalVersionId, canonicalBeforeA, "Conversation A frozen Version changed");
      const instructionsBefore = String(((realtimeRequests[0]?.session as Record<string, unknown> | undefined)?.instructions) ?? "");
      assert(instructionsBefore.includes("--- GOVERNED REPRESENTATION CONTEXT ---") && !instructionsBefore.includes(approvedStatement), "Conversation A realtime instructions were not frozen");
      const realtimeCountBeforeB = realtimeRequests.length;
      await createFinalizedSession(admin, registry, server, tenantA);
      const instructionsForB = String(((realtimeRequests.at(-1)?.session as Record<string, unknown> | undefined)?.instructions) ?? "");
      assert(realtimeRequests.length === realtimeCountBeforeB + 1 && instructionsForB.includes("--- GOVERNED REPRESENTATION CONTEXT ---") && instructionsForB.includes(approvedStatement), "new public Zeya session omitted governed canonical context");
      const replay = await json(server.baseUrl, "/api/voice/conversation-review", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${tenantA.token}` }, body: JSON.stringify(canonicalPayload) });
      assert.equal(replay.status, 201); assert.equal((replay.body.data as Record<string, unknown>).canonicalizationId, learned.canonicalizationId); assert.equal((replay.body.data as Record<string, unknown>).idempotent, true);
      const changed = await json(server.baseUrl, "/api/voice/conversation-review", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${tenantA.token}` }, body: JSON.stringify({ ...canonicalPayload, statement: "Changed replay", elementValues: { offer: { value: "Changed replay" } } }) });
      assert.equal(changed.status, 409, "changed canonicalization payload did not conflict");
      const stale = await json(server.baseUrl, "/api/voice/conversation-review", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${tenantA.token}` }, body: JSON.stringify({ ...canonicalPayload, candidateId: staleCandidateQuery.data.id, requestKey: crypto.randomUUID() }) });
      assert.equal(stale.status, 409); assert.equal(stale.body.error, "canonical_baseline_changed");
      console.log(`LIVE_LEARNING_PROOF ${JSON.stringify({ conversationOutputId: storedSuccess.data.veya_conversation_output_id, candidateId: governedCandidate.id, reviewDecisionId: learned.reviewDecisionId, promotionId: learned.promotionId, proposalId: learned.proposalId, approvalDecisionId: learned.approvalDecisionId, oldVersionId: canonicalBeforeA, newVersionId: learned.canonicalVersionId, confidenceAssessmentId: learned.confidenceAssessmentId, canonicalizationId: learned.canonicalizationId, conversationBVoiceContextId })}`);
      console.log("Phase 5B-C deployed vertical slice ...... PASS");
    }

    const expiringToken = createExperienceToken();
    const expiringZeyaVoice = crypto.randomUUID();
    const expiringZeyaConversation = `public_zeya_${expiringZeyaVoice}`;
    const expiresAt = new Date(Date.now() + 4_000).toISOString();
    const expiringCreate = await admin.rpc("zeya_create_public_experience_session", { p_token_hash: hashExperienceToken(expiringToken), p_expires_at: expiresAt, p_voice_context_id: expiringZeyaVoice, p_worker_brief_id: `expiry_zeya_${crypto.randomUUID()}`, p_conversation_id: expiringZeyaConversation, p_tenant_user_id: tenantA.userId, p_business_id: tenantA.businessId, p_business_representation_id: tenantA.representationId, p_canonical_version_id: canonicalExpectedA, p_context_generated_at: new Date().toISOString(), p_authorized_element_keys: ["offer"], p_agent_id: "zeya-expiry", p_context_schema_version: "1.0", p_prompt_assembly_version: "1.0" });
    assert(!expiringCreate.error, "expiring session creation");
    registry.registerVoiceLineage(expiringZeyaVoice, tenantA.representationId);
    const expiringSessionId = String(expiringCreate.data);
    registry.registerPublicExperienceSession(expiringSessionId);
    const zeyaCapture = await captureAndExtractConversationOutput({ db: admin, capture: { voiceContextId: expiringZeyaVoice, conversationId: expiringZeyaConversation, provider: "openai_realtime", channel: "zeya_realtime", captureSource: "authenticated_client_relay", transcriptTrustLevel: "authenticated_client_relay", providerAttested: false, submittedBy: tenantA.userId, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), transcript: [{ role: "customer", text: "A bounded expiry fixture." }], transcriptStatus: "finalized", conversationStatus: "completed", completionReason: "public_experience_handoff", safeMetadata: { publicExperience: true } }, extractionModel: async () => [] });
    registry.registerVoiceOutput(zeyaCapture.conversationOutputId, tenantA.representationId);
    const zeyaFinalize = await admin.rpc("zeya_finalize_public_experience_zeya", { p_token_hash: hashExperienceToken(expiringToken), p_conversation_output_id: zeyaCapture.conversationOutputId });
    assert(!zeyaFinalize.error, "expiring Zeya finalization");
    const expiryDispatch = `matrix_expiry_${crypto.randomUUID()}`;
    const expiryPhoneHash = hashExperiencePhone(expiringToken, "+15550008888");
    assert(!(await admin.rpc("zeya_request_public_experience_call", { p_token_hash: hashExperienceToken(expiringToken), p_dispatch_id: expiryDispatch, p_phone_hash: expiryPhoneHash })).error, "expiry reservation");
    const expiryVoice = crypto.randomUUID();
    const expiryConversation = `expiry_conversation_${crypto.randomUUID()}`;
    const expiryCall = `expiry_call_${crypto.randomUUID()}`;
    await saveVoiceRepresentationLineage({ db: admin, voiceContextId: expiryVoice, workerBriefId: `expiry_brief_${crypto.randomUUID()}`, missionId: expiryDispatch, conversationId: expiryConversation, lineage: { tenantUserId: tenantA.userId, businessId: tenantA.businessId, businessRepresentationId: tenantA.representationId, canonicalVersionId: canonicalExpectedA, generatedAt: new Date().toISOString(), authorizedElementKeys: ["offer"], provisionalMode: false, agentId: "veya-expiry", agentType: "CALLER", agentRole: "outbound_representative", contextSchemaVersion: "1.0", promptAssemblyVersion: "1.0" } });
    await attachVoiceProviderIdentifiers({ db: admin, voiceContextId: expiryVoice, conversationId: expiryConversation, providerCallId: expiryCall });
    registry.registerVoiceLineage(expiryVoice, tenantA.representationId);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(expiresAt) - Date.now() + 250)));
    const expiryRepair = await admin.rpc("zeya_repair_public_experience_dispatch", { p_veya_voice_context_id: expiryVoice, p_provider_conversation_id: expiryConversation, p_provider_call_id: expiryCall });
    assert(!expiryRepair.error && expiryRepair.data === "call_dispatched", "pre-expiry lineage did not repair after expiry");
    const expiryOutput = await captureAndExtractConversationOutput({ db: admin, capture: { voiceContextId: expiryVoice, conversationId: expiryConversation, providerCallId: expiryCall, provider: "elevenlabs", channel: "veya_outbound", captureSource: "provider_callback", transcriptTrustLevel: "provider_attested", providerAttested: true, completedAt: new Date().toISOString(), transcript: [{ role: "customer", text: "Expiry completion remains bounded." }], transcriptStatus: "finalized", conversationStatus: "done", completionReason: "provider_completed" }, extractionModel: async () => [] });
    registry.registerVoiceOutput(expiryOutput.conversationOutputId, tenantA.representationId);
    const expiryComplete = await admin.rpc("zeya_complete_public_experience_call", { p_veya_voice_context_id: expiryVoice, p_conversation_output_id: expiryOutput.conversationOutputId });
    assert(!expiryComplete.error && expiryComplete.data === "reflection_ready", "completion after expiry");
    assert((await admin.rpc("zeya_request_public_experience_call", { p_token_hash: hashExperienceToken(expiringToken), p_dispatch_id: `new_${crypto.randomUUID()}`, p_phone_hash: "a".repeat(64) })).error, "new dispatch after expiry accepted");
    assert.equal((await admin.from("public_experience_sessions").select("state").eq("id", expiringSessionId).single()).data?.state, "reflection_ready");
    console.log("Completion after expiry ................. PASS");

    const reflection = await json(server.baseUrl, "/api/experience/session/reflection", { headers: { Authorization: `Bearer ${success.token}` } });
    assert.equal(reflection.status, 200, "reflection unavailable");
    assert.equal((await json(server.baseUrl, "/api/experience/session/reflection", { headers: { Authorization: "Bearer invalid" } })).status, 404);
    const reflectionRaw = reflection.raw.toLowerCase();
    assert(reflectionRaw.includes("reviewed before becoming part") && !reflectionRaw.includes("person@example.com") && !reflectionRaw.includes("555 000 7777") && !reflectionRaw.includes("https://example.com") && !reflectionRaw.includes(success.id) && !reflectionRaw.includes(success.callId), "reflection safety");
    console.log("Provider-derived reflection ............ PASS");

    for (const [outcome, expected] of [["failed", "call_failed"], ["unanswered", "call_unanswered"], ["rejected", "call_rejected"], ["completed_without_transcript", "call_completed_without_transcript"], ["completion_processing_failed", "completion_processing_failed"]] as const) {
      const fixture = await providerFixture(admin, registry, server, tenantA, "call_correlation_pending");
      const repair = await admin.rpc("zeya_repair_public_experience_dispatch", { p_veya_voice_context_id: fixture.voiceContextId, p_provider_conversation_id: fixture.conversationId, p_provider_call_id: fixture.callId });
      assert(!repair.error, `${outcome} repair`);
      const result = await admin.rpc("zeya_record_public_experience_call_failure", { p_veya_voice_context_id: fixture.voiceContextId, p_provider_conversation_id: fixture.conversationId, p_provider_call_id: fixture.callId, p_outcome: outcome });
      assert(!result.error && result.data === expected, `${outcome} persistence`);
      const replay = await admin.rpc("zeya_record_public_experience_call_failure", { p_veya_voice_context_id: fixture.voiceContextId, p_provider_conversation_id: fixture.conversationId, p_provider_call_id: fixture.callId, p_outcome: outcome });
      assert(!replay.error && replay.data === expected, `${outcome} replay`);
      const status = await json(server.baseUrl, "/api/experience/session/status", { headers: { Authorization: `Bearer ${fixture.token}` } });
      assert.equal(status.status, 200);
      assert.deepEqual(Object.keys(status.body).sort(), ["expiresAt", "status"]);
      assert(!status.raw.includes(fixture.id) && !status.raw.includes(fixture.callId) && !status.raw.includes(fixture.dispatchId), `${outcome} status leaked identity`);
    }
    const postSuccessFailure = await admin.rpc("zeya_record_public_experience_call_failure", { p_veya_voice_context_id: success.voiceContextId, p_provider_conversation_id: success.conversationId, p_provider_call_id: success.callId, p_outcome: "failed" });
    assert(!postSuccessFailure.error && postSuccessFailure.data === "reflection_ready", "success overwritten by failure");
    console.log("Provider terminal outcomes .............. PASS");

    const tenantBProvider = await providerFixture(admin, registry, server, tenantB, "call_correlation_pending", true);
    assert(!(await admin.rpc("zeya_repair_public_experience_dispatch", { p_veya_voice_context_id: tenantBProvider.voiceContextId, p_provider_conversation_id: tenantBProvider.conversationId, p_provider_call_id: tenantBProvider.callId })).error, "tenant B repair");
    const crossTenantCompletion = await admin.rpc("zeya_complete_public_experience_call", { p_veya_voice_context_id: tenantBProvider.voiceContextId, p_conversation_output_id: storedSuccess.data.veya_conversation_output_id });
    assert(crossTenantCompletion.error, "Business A output completed Business B session");
    assert.equal((await admin.from("public_experience_sessions").select("state").eq("id", tenantBProvider.id).single()).data?.state, "call_dispatched", "cross-tenant attempt mutated session");

    assert.equal((await admin.from("business_representations").select("current_version_id").eq("id", tenantA.representationId).single()).data!.current_version_id, canonicalExpectedA);
    assert.equal((await admin.from("business_representations").select("current_version_id").eq("id", tenantB.representationId).single()).data!.current_version_id, canonicalBeforeB);
    const completionReplay = await admin.rpc("zeya_complete_public_experience_call", { p_veya_voice_context_id: success.voiceContextId, p_conversation_output_id: storedSuccess.data.veya_conversation_output_id });
    assert(!completionReplay.error && completionReplay.data === "reflection_ready", "completion replay should remain idempotent");
    const persisted = JSON.stringify(await admin.from("public_experience_sessions").select("phone_hash").eq("id", success.id).single());
    assert(!persisted.includes("+15550007777") && !JSON.stringify(await admin.from("voice_representation_lineage").select("*").eq("voice_context_id", success.voiceContextId)).includes("+15550007777"), "raw phone persisted");
    assert(!(await admin.from("public_experience_sessions").select("token_hash").eq("id", success.id).single()).data!.token_hash.includes(success.token), "plaintext token persisted");
    console.log("Privacy, tenant, canonical integrity .... PASS");

    console.log("Public Experience completion deployed behavioral matrix — PASS");
  } catch (error) {
    console.error(error instanceof Error ? `Matrix assertion failed: ${error.message}` : "Matrix assertion failed");
    throw error;
  } finally {
    await stopOwnedServer(server);
    if (realtimeMock) await new Promise<void>(resolve => realtimeMock!.close(() => resolve()));
    currentTestServer = null;
    await cleanupMatrix(admin, registry);
    cleanupPassed = true;
    delete process.env.ELEVENLABS_WEBHOOK_SECRET;
    delete process.env.PUBLIC_EXPERIENCE_TEST_MODE;
    delete process.env.PUBLIC_EXPERIENCE_TEST_ELEMENT_KEY;
    delete process.env.PUBLIC_EXPERIENCE_PROVIDER;
    delete process.env.ZEYA_EXPERIENCE_BUSINESS_ID;
    delete process.env.OPENAI_REALTIME_SESSION_URL;
  }
  assert(cleanupPassed, "fixture cleanup failed");
  console.log("Fixture cleanup ......................... PASS");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Public Experience completion deployed matrix failed");
  process.exitCode = 1;
});
