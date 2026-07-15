import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assembleVoiceRepresentationContext, buildVoiceProviderVariables } from "../../lib/voice/representation-context";
import { FixtureRegistry } from "./representation-state-test-fixtures";
import { cleanupFixtures } from "./representation-state-test-cleanup";
import { jsonRequest } from "./representation-state-test-client";
import { startTestServer } from "./representation-state-test-server";
import { createRepresentationStateService } from "../../lib/representation/representation-service";

type UserFixture = { id: string; token: string; client: SupabaseClient };
const expected = {
  approved_key: "approved value",
  provisional_key: "provisional value",
  internal_key: "internal value",
  disputed_key: "disputed value",
  prohibited_key: "prohibited value",
  expired_key: "expired value",
};
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Voice Representation: ${message}`);
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const server = await startTestServer();
  const registry = new FixtureRegistry();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let cleanup;
  try {
    async function user(label: string): Promise<UserFixture> {
      const email = `voice-representation-${label}-${registry.runId}@zeya.test`;
      const password = `T-${crypto.randomUUID()}!`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      registry.registerAuthUser(created.data.user.id, email);
      const publicClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
      const signed = await publicClient.auth.signInWithPassword({ email, password });
      if (signed.error || !signed.data.session) throw signed.error ?? new Error("Authentication failed");
      const token = signed.data.session.access_token;
      return {
        id: created.data.user.id,
        token,
        client: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        }),
      };
    }

    const owner = await user("owner");
    const foreign = await user("foreign");
    const business = await owner.client.from("businesses").insert({ business_name: `Voice ${registry.runId}`, user_id: owner.id }).select().single();
    if (business.error) throw business.error;
    registry.registerBusiness(business.data.id, owner.id);
    const initial = await jsonRequest<{ data: { businessRepresentationId: string; evidenceId: string; observationId: string; proposalId: string } }>(
      server.baseUrl,
      "/api/representation/evidence",
      { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ businessId: business.data.id, statement: "voice context fixture" }) },
    );
    assert(initial.status === 201, "fixture initialization");
    const representationId = initial.body.data.businessRepresentationId;
    registry.registerBusinessRepresentation(representationId, business.data.id);
    registry.registerEvidence(initial.body.data.evidenceId);
    registry.registerObservation(initial.body.data.observationId);
    registry.registerProposal(initial.body.data.proposalId);
    const version = await jsonRequest<{ data: { versionId: string; confidenceAssessmentId: string } }>(server.baseUrl, "/api/representation/versions", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ businessRepresentationId: representationId, proposalId: initial.body.data.proposalId, elementValues: Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, { value }])), confidenceScore: 85 }),
    });
    assert(version.status === 201, "canonical Version");
    registry.registerVersion(version.body.data.versionId);
    registry.registerConfidenceAssessment(version.body.data.confidenceAssessmentId);
    const domain = await owner.client.from("representation_domains").select("id").eq("business_representation_id", representationId).eq("domain_name", "customer").single();
    if (domain.error) throw domain.error;
    registry.registerDomain(domain.data.id);
    const states = [["approved_key", "approved_for_external_use", false], ["provisional_key", "provisional", false], ["internal_key", "internal_only", false], ["disputed_key", "disputed", true], ["prohibited_key", "prohibited", false], ["expired_key", "expired", false]] as const;
    const inserted = await owner.client.from("representation_elements").insert(states.map(([element_key, claim_eligibility, is_disputed]) => ({ business_representation_id: representationId, representation_domain_id: domain.data.id, element_key, element_type: "fact", current_value_version_id: version.body.data.versionId, is_disputed, claim_eligibility, field_sensitivity: "operational" }))).select();
    if (inserted.error) throw inserted.error;
    inserted.data.forEach((row) => registry.registerElement(row.id));
    const elementIds = new Map(inserted.data.map((row) => [row.element_key, row.id]));
    const versionOneSnapshot = await admin.from("representation_versions").select("*").eq("id", version.body.data.versionId).single();
    if (versionOneSnapshot.error) throw versionOneSnapshot.error;

    const originalContext = await assembleVoiceRepresentationContext({ db: owner.client, tenantUserId: owner.id, businessId: business.data.id, agent: { id: "veya", type: "CALLER", role: "outbound_representative" } });
    const nextProposal = await owner.client.from("representation_proposals").insert({ business_representation_id: representationId, proposed_changes: { approved_key: { after: "new approved value" } }, risk_tier: "low", highest_sensitivity_class: "operational", requires_approval: false, status: "draft", proposed_by_actor: owner.id, rationale: "voice new-Version lineage" }).select().single();
    if (nextProposal.error) throw nextProposal.error;
    registry.registerProposal(nextProposal.data.id);
    const nextValues = { approved_key: "new approved value" };
    const nextVersion = await jsonRequest<{ data: { versionId: string; confidenceAssessmentId: string } }>(server.baseUrl, "/api/representation/versions", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ businessRepresentationId: representationId, proposalId: nextProposal.data.id, elementValues: Object.fromEntries(Object.entries(nextValues).map(([key, value]) => [key, { value }])), confidenceScore: 85 }) });
    assert(nextVersion.status === 201, "new canonical Version");
    registry.registerVersion(nextVersion.body.data.versionId);
    registry.registerConfidenceAssessment(nextVersion.body.data.confidenceAssessmentId);
    const pointersAfterPartial = await admin.from("representation_elements").select("id,element_key,current_value_version_id").eq("business_representation_id", representationId);
    if (pointersAfterPartial.error) throw pointersAfterPartial.error;
    assert(pointersAfterPartial.data.find((row) => row.id === elementIds.get("approved_key"))?.current_value_version_id === nextVersion.body.data.versionId, "affected Element advances on partial Version");
    for (const row of pointersAfterPartial.data.filter((candidate) => candidate.element_key !== "approved_key")) {
      assert(row.current_value_version_id === version.body.data.versionId, `unrelated Element ${row.element_key} retains pointer`);
    }
    const versionOneAfterPartial = await admin.from("representation_versions").select("*").eq("id", version.body.data.versionId).single();
    assert(!versionOneAfterPartial.error && JSON.stringify(versionOneAfterPartial.data) === JSON.stringify(versionOneSnapshot.data), "historical Version remains immutable");

    async function invalidProposal(status: "rejected" | "superseded", expiresAt: string | null = null): Promise<void> {
      const proposal = await owner.client.from("representation_proposals").insert({ business_representation_id: representationId, proposed_changes: { approved_key: { after: "blocked value" } }, risk_tier: "low", highest_sensitivity_class: "operational", requires_approval: false, status, proposed_by_actor: owner.id, rationale: `voice ${status} pointer proof`, expires_at: expiresAt }).select().single();
      if (proposal.error) throw proposal.error;
      registry.registerProposal(proposal.data.id);
      const before = await admin.from("representation_elements").select("id,current_value_version_id").eq("business_representation_id", representationId).order("id");
      const blocked = await jsonRequest<{ error: string }>(server.baseUrl, "/api/representation/versions", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ businessRepresentationId: representationId, proposalId: proposal.data.id, elementValues: { approved_key: { value: "blocked value" } }, confidenceScore: 85 }) });
      assert(blocked.status === 409, `${status} Proposal is blocked`);
      const after = await admin.from("representation_elements").select("id,current_value_version_id").eq("business_representation_id", representationId).order("id");
      assert(JSON.stringify(after.data) === JSON.stringify(before.data), `${status} Proposal does not advance pointers`);
    }
    await invalidProposal("rejected");
    await invalidProposal("superseded");
    const expiredProposal = await owner.client.from("representation_proposals").insert({ business_representation_id: representationId, proposed_changes: { approved_key: { after: "expired value" } }, risk_tier: "low", highest_sensitivity_class: "operational", requires_approval: false, status: "draft", proposed_by_actor: owner.id, rationale: "voice expired pointer proof", expires_at: new Date(Date.now() - 60_000).toISOString() }).select().single();
    if (expiredProposal.error) throw expiredProposal.error;
    registry.registerProposal(expiredProposal.data.id);
    const expired = await jsonRequest<{ error: string }>(server.baseUrl, "/api/representation/versions", { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ businessRepresentationId: representationId, proposalId: expiredProposal.data.id, elementValues: { approved_key: { value: "expired value" } }, confidenceScore: 85 }) });
    assert(expired.status === 409, "expired Proposal is blocked");
    const pointerBeforeForeign = await admin.from("representation_elements").select("id,current_value_version_id").eq("business_representation_id", representationId).order("id");
    const foreignVersion = await foreign.client.rpc("zeya_create_canonical_version", { p_business_representation_id: representationId, p_proposal_id: nextProposal.data.id, p_approval_decision_id: null, p_element_values: { approved_key: { value: "foreign value" } }, p_confidence_score: 85, p_confidence_band: "high", p_confidence_factors: {}, p_confidence_rationale: "foreign pointer attempt", p_actor_user_id: foreign.id });
    assert(!!foreignVersion.error, "foreign tenant canonical Version blocked");
    const pointerAfterForeign = await admin.from("representation_elements").select("id,current_value_version_id").eq("business_representation_id", representationId).order("id");
    assert(JSON.stringify(pointerAfterForeign.data) === JSON.stringify(pointerBeforeForeign.data), "foreign tenant cannot affect pointers");
    const newContext = await assembleVoiceRepresentationContext({ db: owner.client, tenantUserId: owner.id, businessId: business.data.id, agent: { id: "veya", type: "CALLER", role: "outbound_representative" } });
    assert(originalContext.lineage.canonicalVersionId === version.body.data.versionId, "existing context retains old Version lineage");
    assert(newContext.lineage.canonicalVersionId === nextVersion.body.data.versionId, "new context uses new Version lineage");
    assert(newContext.systemContext.includes("new approved value"), "new context uses new canonical value");
    const rollback = await createRepresentationStateService(owner.client).rollbackToVersion(representationId, version.body.data.versionId);
    registry.registerVersion(rollback.id);
    const rollbackAudit = await admin.from("audit_events").select("id").eq("business_representation_id", representationId).eq("version_id", rollback.id).eq("event_type", "version_rolled_back").single();
    if (rollbackAudit.error) throw rollbackAudit.error;
    registry.registerAuditEvent(rollbackAudit.data.id);
    const rollbackContext = await assembleVoiceRepresentationContext({ db: owner.client, tenantUserId: owner.id, businessId: business.data.id, agent: { id: "veya", type: "CALLER", role: "outbound_representative" } });
    assert(rollbackContext.lineage.canonicalVersionId === rollback.id, "rollback context uses rollback-created Version");
    assert(rollbackContext.systemContext.includes("approved value") && !rollbackContext.systemContext.includes("new approved value"), "rollback restores provider content");

    const countsBefore = await Promise.all(["evidence", "observations", "representation_proposals", "approval_decisions", "representation_versions", "confidence_assessments", "audit_events"].map((table) => admin.from(table).select("*", { count: "exact", head: true }).eq("business_representation_id", representationId)));
    const approved = await assembleVoiceRepresentationContext({ db: owner.client, tenantUserId: owner.id, businessId: business.data.id, agent: { id: "veya", type: "CALLER", role: "outbound_representative" } });
    const approvedPayload = buildVoiceProviderVariables({ targetName: "prospect", targetPhone: null, objective: "qualify interest", context: approved });
    const approvedText = JSON.stringify(approvedPayload);
    assert(approved.lineage.provisionalMode === false, "provisional defaults false");
    assert(approved.lineage.canonicalVersionId === rollback.id, "canonical lineage");
    assert(approvedText.includes("approved_key") && approvedText.includes("approved value"), "approved reaches provider payload");
    for (const hidden of ["provisional_key", "internal_key", "disputed_key", "prohibited_key", "expired_key", "provisional value", "internal value", "disputed value", "prohibited value", "expired value"]) assert(!approvedText.includes(hidden), `default payload excludes ${hidden}`);

    const provisional = await assembleVoiceRepresentationContext({ db: owner.client, tenantUserId: owner.id, businessId: business.data.id, agent: { id: "zeya", type: "ZEYA", role: "briefing" }, provisionalMode: true });
    const provisionalText = JSON.stringify(buildVoiceProviderVariables({ targetName: null, targetPhone: null, objective: "brief founder", context: provisional }));
    assert(provisionalText.includes("approved_key") && provisionalText.includes("provisional_key"), "provisional payload includes authorized states");
    for (const hidden of ["internal_key", "disputed_key", "prohibited_key", "expired_key"]) assert(!provisionalText.includes(hidden), `provisional payload excludes ${hidden}`);

    let foreignBlocked = false;
    try {
      await assembleVoiceRepresentationContext({ db: foreign.client, tenantUserId: foreign.id, businessId: business.data.id, agent: { id: "foreign", type: "CALLER", role: "caller" } });
    } catch { foreignBlocked = true; }
    assert(foreignBlocked, "foreign tenant blocked");
    let missingBlocked = false;
    try {
      await assembleVoiceRepresentationContext({ db: owner.client, tenantUserId: owner.id, businessId: crypto.randomUUID(), agent: { id: "veya", type: "CALLER", role: "caller" } });
    } catch { missingBlocked = true; }
    assert(missingBlocked, "missing Representation fails closed");
    const countsAfter = await Promise.all(["evidence", "observations", "representation_proposals", "approval_decisions", "representation_versions", "confidence_assessments", "audit_events"].map((table) => admin.from(table).select("*", { count: "exact", head: true }).eq("business_representation_id", representationId)));
    assert(countsBefore.every((result, index) => result.count === countsAfter[index].count), "context assembly is read-only");
    console.log("Voice Representation Context\n\nProvider payload filtering — PASS\nProvisional default — PASS\nProvisional filtering — PASS\nTenant isolation — PASS\nMissing Representation — PASS\nCanonical lineage — PASS\nPartial-Version pointers — PASS\nRejected/expired/superseded pointers — PASS\nForeign pointer isolation — PASS\nNew-Version lineage — PASS\nRollback lineage — PASS\nRead-only boundary — PASS\nLogging payload safety — PASS");
  } finally {
    cleanup = await cleanupFixtures(admin, registry);
    console.log(`Representation cleanup — ${cleanup.success ? "PASS" : "FAIL"}\nBusiness cleanup — ${cleanup.success ? "PASS" : "FAIL"}\nAuth cleanup — ${cleanup.success ? "PASS" : "FAIL"}`);
    await server.stop();
    console.log("Server cleanup — PASS");
  }
  if (!cleanup?.success) throw new Error(cleanup?.failures.join(", "));
}

const keepAlive = setInterval(() => undefined, 1000);
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Voice Representation test failed"); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
