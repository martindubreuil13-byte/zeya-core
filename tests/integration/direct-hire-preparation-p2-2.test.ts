import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { analyzeBriefEvidenceScope, buildBriefCitationLineage, buildFirstWorkingSessionBriefPrompt, buildFirstWorkingSessionBriefSchema, isFirstWorkingSessionBriefCurrent, synthesizeFirstWorkingSessionBrief } from "../../lib/onboarding/first-working-session-brief";

const migration = "supabase/migrations/20260813010000_direct_hire_first_working_session_preparation.sql";
const recoveryMigration = "supabase/migrations/20260813020000_direct_hire_first_working_session_preparation_recovery.sql";
const recoveryActorMigration = "supabase/migrations/20260813030000_direct_hire_first_working_session_preparation_recovery_actor.sql";

describe("P2.2 durable eligibility and leases", () => {
  it("requires scheduled, employed, induction-complete lineage", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("candidate.status = 'scheduled'");
    expect(sql).toContain("onboarding.onboarding_state = 'employment_accepted'");
    expect(sql).toContain("onboarding.induction_state = 'preparation_pending'");
  });
  it("serializes claims, recovers expired leases, and bounds attempts", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("FOR UPDATE OF candidate SKIP LOCKED");
    expect(sql).toContain("preparation_lease_expires_at <= now()");
    expect(sql).toContain("preparation_attempt_count < 3");
    expect(sql).toContain("preparation_attempt_count BETWEEN 0 AND 3");
    expect(sql).toContain("preparation_attempt_count=least(preparation_attempt_count + 1,3)");
    const worker = await readFile("lib/onboarding/first-working-session-preparation-worker.ts", "utf8");
    expect(worker).toContain("p_lease_seconds: 600");
  });
  it("supports existing P2.1 appointments and rejects current completed work", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("ADD COLUMN preparation_status text NOT NULL DEFAULT 'pending'");
    expect(sql).toContain("candidate.preparation_status IN ('pending', 'failed')");
    expect(sql).toContain("candidate.preparation_status = 'ready' AND candidate.preparation_contract_version IS DISTINCT FROM p_contract_version");
    expect(sql).toContain("direct_hire_induction_marks_working_session_preparation_stale");
    expect(sql).toContain("SET current=false");
  });
  it("keeps the appointment lifecycle independent from historical onboarding Preparation", async () => {
    const sql = await readFile(migration, "utf8");
    const claimBody = sql.slice(sql.indexOf("CREATE FUNCTION public.zeya_claim_first_working_session_preparation"), sql.indexOf("CREATE FUNCTION public.zeya_persist_first_working_session_website_research"));
    expect(claimBody).not.toContain("UPDATE public.direct_hire_onboarding_sessions");
    expect(sql).toContain("preparation_website_persisted_at");
  });
  it("makes finalize/fail replay safe and private", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("v_session.preparation_status = 'ready'");
    expect(sql).toContain("v_session.preparation_status = 'failed' AND v_session.preparation_lease_id IS NULL");
    expect(sql).toContain("REVOKE ALL ON TABLE public.direct_hire_first_working_session_briefs FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT ALL ON TABLE public.direct_hire_first_working_session_briefs TO service_role");
    expect(sql).toContain("preparation brief Evidence lineage invalid");
  });
});

describe("P2.2 orchestration", () => {
  it("runs registered sources, P1, hypotheses, then brief in order", async () => {
    const worker = await readFile("lib/onboarding/first-working-session-preparation-worker.ts", "utf8");
    const source = worker.lastIndexOf("acquirePendingRegisteredPublicSources(client");
    const research = worker.indexOf("executeDirectHirePreparation(claim.website_url");
    const intelligence = worker.indexOf("ensurePreparationIntelligence(client, scope)");
    const brief = worker.indexOf("buildFirstWorkingSessionBrief(client, scope)");
    expect(source).toBeLessThan(research);
    expect(research).toBeLessThan(intelligence);
    expect(intelligence).toBeLessThan(brief);
    expect(worker).toContain('sourceScope: claim.onboarding_session_id');
    expect(worker).toContain('rpc("zeya_persist_first_working_session_website_research"');
    expect(worker).not.toContain('rpc("zeya_finalize_direct_hire_preparation"');
  });
  it("uses a synchronous secret worker and no fire-and-forget promise", async () => {
    const route = await readFile("app/api/internal/direct-hire/first-working-session-preparation/route.ts", "utf8");
    expect(route).toContain("DIRECT_HIRE_PREPARATION_WORKER_SECRET");
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain("await executeOneFirstWorkingSessionPreparation");
    expect(route).not.toContain("void executeOne");
    expect(route).toContain("error: safeStage");
    expect(route).toContain("FirstWorkingSessionPreparationStageError");
  });
  it("reuses the website checkpoint and classifies finalization boundaries", async () => {
    const worker = await readFile("lib/onboarding/first-working-session-preparation-worker.ts", "utf8");
    expect(worker).toContain("if (!claim.website_persisted)");
    expect(worker).toContain("buildFirstWorkingSessionFinalizationPayload(");
    expect(worker).toContain('"brief_database_finalization_failed"');
    expect(worker).toContain('"brief_input_snapshot_invalid"');
    expect(worker.indexOf("buildFirstWorkingSessionFinalizationPayload(")).toBeLessThan(
      worker.indexOf('client.rpc("zeya_finalize_first_working_session_preparation"'),
    );
  });
  it("does not mutate Formation or canonical Representation", async () => {
    const worker = await readFile("lib/onboarding/first-working-session-preparation-worker.ts", "utf8");
    expect(worker).not.toContain("representation_versions");
    expect(worker).not.toContain("representation_formation_sessions");
    expect(worker).not.toContain("current_version_id");
  });
});

describe("P2.2 private brief governance", () => {
  it("stores required lineage, fingerprints, version, and private JSON", async () => {
    const sql = await readFile(migration, "utf8");
    for (const marker of ["direct_hire_working_session_id", "direct_hire_onboarding_session_id", "business_representation_id", "source_snapshot_fingerprint", "hypothesis_trace_fingerprint", "preparation_contract_version", "generated_at"]) {
      expect(sql).toContain(marker);
    }
    const service = await readFile("lib/onboarding/first-working-session-brief.ts", "utf8");
    expect(service).toContain('"first-working-session-preparation-v3"');
  });
  it("independently synthesizes a specific, governed representative brief", async () => {
    const inputs = {
      evidence: [
        { id: "e1", sourceType: "public_website", rawStatement: "We use business architecture to redesign offers and operating systems, with client proof from Montreal, Nigeria, and the United Kingdom.", affected_domains: ["whatYouSell", "proposedDescription", "whoItIsFor"], authority_type: "first_party_company", authority_key: "first-party-site:modernbusinessarchitect.com" },
        { id: "e2", sourceType: "direct_hire_induction", rawStatement: "Business coaching and architecture for startups in English-speaking developed markets.", affected_domains: ["whatYouSell", "whoItIsFor"], authority_type: "owner", authority_key: "owner" },
      ],
      observations: [{ id: "o1", evidenceId: "e1", interpreted_meaning: "The offer is framed as architecture and operating-system design.", confidence_in_interpretation: 55, affected_domains: ["whatYouSell"] }],
      hypotheses: Array.from({ length: 7 }, (_, index) => ({ id: `h${index + 1}`, constitutionalDomain: ["whatYouSell","whoItIsFor","problemOrAspiration","whyCustomersShouldCare","proposedDescription","authorityBoundaries","clarificationsNeeded"][index], currentBelief: index === 5 ? null : "Business architecture and coaching for startup growth", sourceEvidenceIds: index === 5 ? [] : ["e1", "e2"], epistemicState: index === 5 ? "unknown" : "partial", confidence: index === 5 ? "unknown" : "medium", representationRisk: index === 5 ? "high" : "medium", ownerDecision: null, riskReason: index === 5 ? "Pricing promises negotiation commitments and escalation authority are unknown" : "Business positioning requires verification" })),
    } as any;
    const statement = (text: string, kind = "supported_finding") => ({ statement: text, kind, evidenceIds: ["e1", "e2"], hypothesisIds: ["h1"] });
    const fixture = {
      businessRead: statement("The business presents business architecture for startup growth."),
      offerRead: statement("The offer combines business architecture and coaching."), customerRead: statement("The stated customer is startups in developed markets."),
      problemOutcomeRead: statement("The public offer addresses business structure and operating systems."), positioningRead: statement("Business architecture is the explicit public positioning anchor."),
      commercialSignals: [statement("The offer language points to transformation of operating systems.")], contradictions: [],
      unknowns: [{ statement: "Pricing and negotiation authority are unknown.", kind: "unknown", evidenceIds: [], hypothesisIds: ["h6"] }],
      workingOpinions: [{ ...statement("My working interpretation is that the public business positioning is more architecture-led than coaching-led.", "working_opinion"), evidenceIds: ["e1", "e2"] }],
      formationPriorities: [
        { ...statement("Verify whether business architecture or coaching should lead the offer.", "interpretation"), evidenceIds: ["e1", "e2"] },
        { ...statement("Clarify whether startups in English-speaking developed markets are the commercial priority.", "interpretation"), evidenceIds: ["e1", "e2"], hypothesisIds: ["h2"] },
        { statement: "Establish pricing promises negotiation commitments and escalation authority.", kind: "unknown", evidenceIds: [], hypothesisIds: ["h6"] },
      ],
      openingInsights: [statement("The architecture-versus-coaching distinction is a productive opening for the session.", "interpretation")],
      questions: [{ statement: "Should startups in English-speaking developed markets remain the commercial priority when public client proof is geographically broader?", kind: "unknown", evidenceIds: ["e1", "e2"], hypothesisIds: ["h2"] }],
      authorityGaps: [{ statement: "Pricing promises negotiation commitments and escalation authority are not established.", kind: "unknown", evidenceIds: [], hypothesisIds: ["h6"] }],
      governance: { canonical: false, containsChainOfThought: false },
    };
    const prompt = buildFirstWorkingSessionBriefPrompt(inputs);
    expect(prompt).toContain("business architecture");
    const brief = await synthesizeFirstWorkingSessionBrief(inputs, async () => fixture);
    for (const key of ["businessRead","offerRead","customerRead","problemOutcomeRead","positioningRead","commercialSignals","contradictions","unknowns","workingOpinions","formationPriorities","openingInsights","questions","authorityGaps"]) expect(brief).toHaveProperty(key);
    expect(brief.workingOpinions[0].statement).toContain("more architecture-led than coaching-led");
    expect(brief.formationPriorities).toHaveLength(3);
    expect(brief.authorityGaps).not.toHaveLength(0);
    expect(brief.questions[0].statement).toContain("public client proof is geographically broader");
    expect(brief.workingOpinions.every(item => item.kind === "working_opinion")).toBe(true);
    expect(brief.governance).toEqual({ canonical: false, containsChainOfThought: false });
  });
  it("rejects empty risk agenda sections and untraceable generic questions", async () => {
    const inputs = {
      evidence: [{ id: "e1", sourceType: "public_website", rawStatement: "Business architecture for founders.", affected_domains: ["whatYouSell"] }],
      observations: [],
      hypotheses: [{ id: "authority", constitutionalDomain: "authorityBoundaries", epistemicState: "unknown", confidence: "unknown", representationRisk: "high", currentBelief: null, riskReason: "Authority is unknown", ownerDecision: null }],
    } as any;
    const base = { statement: "Business architecture for founders.", kind: "supported_finding", evidenceIds: ["e1"], hypothesisIds: [] };
    const invalid = {
      businessRead: base, offerRead: base, customerRead: base, problemOutcomeRead: base, positioningRead: base,
      commercialSignals: [], contradictions: [], unknowns: [], workingOpinions: [], formationPriorities: [], openingInsights: [],
      questions: [{ statement: "What specific techniques ensure scalable solution architecture across different markets?", kind: "unknown", evidenceIds: [], hypothesisIds: [] }],
      authorityGaps: [], governance: { canonical: false, containsChainOfThought: false },
    };
    await expect(synthesizeFirstWorkingSessionBrief(inputs, async () => invalid)).rejects.toThrow("brief_citation_scope_invalid");
  });
  it("rejects unsupported concrete facts while permitting governed synthesis", async () => {
    const inputs = {
      evidence: [
        { id: "e1", sourceType: "public_website", rawStatement: "We use business architecture to redesign offers and operating systems for founders.", affected_domains: ["whatYouSell"], logical_source_key: "site:home" },
        { id: "e2", sourceType: "direct_hire_induction", rawStatement: "Business coaching and architecture for startups in English-speaking developed markets.", affected_domains: ["whatYouSell", "whoItIsFor"], logical_source_key: "owner:induction" },
      ],
      observations: [],
      hypotheses: [
        { id: "h1", constitutionalDomain: "whatYouSell", epistemicState: "partial", currentBelief: "Architecture and coaching are both present", confidence: "medium", representationRisk: "medium", riskReason: "Positioning needs verification", ownerDecision: null },
        { id: "h2", constitutionalDomain: "whoItIsFor", epistemicState: "partial", currentBelief: "Startups in English-speaking developed markets are the stated target", confidence: "medium", representationRisk: "medium", riskReason: "Public proof is broader", ownerDecision: null },
        { id: "h6", constitutionalDomain: "authorityBoundaries", epistemicState: "unknown", currentBelief: null, confidence: "unknown", representationRisk: "high", riskReason: "Pricing promises negotiation commitments and escalation authority are unknown", ownerDecision: null },
      ],
    } as any;
    const cited = (statement: string, kind = "interpretation") => ({ statement, kind, evidenceIds: ["e1", "e2"], hypothesisIds: ["h1"] });
    const valid = {
      businessRead: cited("The business appears more architecture-led in positioning than coaching-led in delivery.", "working_opinion"),
      offerRead: cited("Architecture and coaching are both visible in the offer."),
      customerRead: { ...cited("Startups in English-speaking developed markets are the stated priority."), hypothesisIds: ["h2"] },
      problemOutcomeRead: cited("The offer appears focused on structural business decisions."),
      positioningRead: cited("Architecture appears to lead the public positioning."),
      commercialSignals: [], contradictions: [], unknowns: [], workingOpinions: [],
      formationPriorities: [
        cited("Clarify which of architecture and coaching should lead the commercial offer."),
        { ...cited("Clarify whether startups remain the priority despite broader public proof."), hypothesisIds: ["h2"] },
        { statement: "Clarify commercial target and authority boundaries.", kind: "unknown", evidenceIds: [], hypothesisIds: ["h2", "h6"] },
      ],
      openingInsights: [],
      questions: [{ statement: "Are startups in English-speaking developed markets still the priority despite broader public proof?", kind: "unknown", evidenceIds: ["e1", "e2"], hypothesisIds: ["h2"] }],
      authorityGaps: [{ statement: "Pricing, promises, negotiation, commitment, and escalation authority remain unknown.", kind: "unknown", evidenceIds: [], hypothesisIds: ["h6"] }],
      governance: { canonical: false, containsChainOfThought: false },
    } as any;
    await expect(synthesizeFirstWorkingSessionBrief(inputs, async () => valid)).resolves.toEqual(valid);

    const unsupported = [
      "The business serves a $5 billion market.",
      "The standard package costs $5,000.",
      "The service is GDPR compliant.",
      "The primary segment is Fortune 500 healthcare companies.",
      "The company guarantees revenue growth.",
      "The company is the leading business architecture consultancy.",
    ];
    for (const statement of unsupported) {
      const invalid = { ...valid, businessRead: cited(statement, "supported_finding") };
      await expect(synthesizeFirstWorkingSessionBrief(inputs, async () => invalid))
        .rejects.toThrow("brief_semantic_supported_finding_invalid");
    }

    const unsupportedContradiction = {
      ...valid,
      contradictions: [{ statement: "The offer descriptions conflict.", kind: "contradiction", evidenceIds: ["e1"], hypothesisIds: [] }],
    };
    await expect(synthesizeFirstWorkingSessionBrief(inputs, async () => unsupportedContradiction))
      .rejects.toThrow("brief_contradiction_invalid");
  });
  it("keeps live-shaped brief citations in the exact effective Evidence namespace", async () => {
    const effectiveIds = ["v2-home", "v2-qualify", "v2-contact", "owner-offer", "owner-target"];
    const inputs = {
      evidence: effectiveIds.map((id) => ({ id, sourceType: id.startsWith("owner") ? "direct_hire_induction" : "public_website", rawStatement: `${id} business architecture coaching startups pricing negotiation authority`, affected_domains: ["whatYouSell", "whoItIsFor", "authorityBoundaries"] })),
      observations: [],
      hypotheses: Array.from({ length: 7 }, (_, index) => ({
        id: `v5-h${index + 1}`, previousHypothesisId: `v4-h${index + 1}`,
        constitutionalDomain: ["whatYouSell","whoItIsFor","problemOrAspiration","whyCustomersShouldCare","proposedDescription","authorityBoundaries","clarificationsNeeded"][index],
        currentBelief: index === 5 ? null : "Business architecture coaching for startups",
        sourceEvidenceIds: index === 0 ? ["historical-v1-home"] : ["v2-home"],
        epistemicState: index === 5 ? "unknown" : "partial", confidence: index === 5 ? "unknown" : "medium",
        representationRisk: index === 5 ? "high" : "medium", ownerDecision: null,
        riskReason: "Pricing negotiation authority requires verification",
      })),
    } as any;
    const statement = (text: string, evidenceIds = ["v2-home"], hypothesisIds = ["v5-h1"], kind = "interpretation") => ({ statement: text, kind, evidenceIds, hypothesisIds });
    const brief = {
      businessRead: statement("Business architecture and coaching shape the current offer."),
      offerRead: statement("Business architecture and coaching shape the current offer."),
      customerRead: statement("Startups are the stated customer for business coaching.", ["owner-target", "v2-home"], ["v5-h2"]),
      problemOutcomeRead: statement("Business architecture and startup structure are the current problem focus."),
      positioningRead: statement("Business architecture leads the public positioning."),
      commercialSignals: [], contradictions: [], unknowns: [], workingOpinions: [],
      formationPriorities: [
        statement("Verify business architecture and coaching offer emphasis."),
        statement("Verify startups as the business coaching customer priority.", ["owner-target", "v2-home"], ["v5-h2"]),
        statement("Verify pricing negotiation authority boundaries.", [], ["v5-h6"], "unknown"),
      ],
      openingInsights: [],
      questions: [statement("Should startups remain the business coaching customer priority?", ["owner-target", "v2-home"], ["v5-h2"], "unknown")],
      authorityGaps: [statement("Pricing negotiation authority remains unknown.", [], ["v5-h6"], "unknown")],
      governance: { canonical: false, containsChainOfThought: false },
    };
    const generated = await synthesizeFirstWorkingSessionBrief(inputs, async (_prompt, schema) => {
      const properties = (schema as any).properties.businessRead.anyOf[0].properties;
      expect(properties.evidenceIds.items.enum).toEqual(effectiveIds);
      expect(properties.hypothesisIds.items.enum).toEqual(inputs.hypotheses.map((item: any) => item.id));
      return brief;
    });
    const lineage = buildBriefCitationLineage(generated, new Set(effectiveIds), new Set(inputs.hypotheses.map((item: any) => item.id)));
    expect(lineage.sourceEvidenceIds).toEqual(["owner-target", "v2-home"]);
    expect(lineage.sourceEvidenceIds).not.toContain("historical-v1-home");
    expect(analyzeBriefEvidenceScope(brief, inputs)).toMatchObject({ outOfScopeCount: 0, category: "none" });
  });

  it("classifies a hypothesis UUID placed in evidenceIds without weakening rejection", () => {
    const inputs = { evidence: [{ id: "current-evidence" }], observations: [], hypotheses: [{ id: "current-hypothesis", previousHypothesisId: "old-hypothesis", sourceEvidenceIds: ["historical-evidence"] }] } as never;
    const malformed = { businessRead: { statement: "x", kind: "unknown", evidenceIds: ["current-hypothesis"], hypothesisIds: [] } };
    expect(analyzeBriefEvidenceScope(malformed, inputs)).toMatchObject({ outOfScopeCount: 1, category: "hypothesis_id_as_evidence" });
    const schema = buildFirstWorkingSessionBriefSchema(inputs) as any;
    expect(schema.properties.businessRead.anyOf[0].properties.evidenceIds.items.enum).toEqual(["current-evidence"]);
  });
  it("never exposes private brief through the owner API", async () => {
    const route = await readFile("app/api/onboarding/direct-hire/working-session/route.ts", "utf8");
    expect(route).not.toContain("direct_hire_first_working_session_briefs");
    expect(route).not.toContain("sourceEvidenceIds");
    expect(route).toContain("preparationStatus");
  });
  it("rejects a stale brief when its governed snapshot changes", () => {
    expect(isFirstWorkingSessionBriefCurrent({ sourceSnapshotFingerprint: "a", preparationContractVersion: "first-working-session-preparation-v3" }, "a")).toBe(true);
    expect(isFirstWorkingSessionBriefCurrent({ sourceSnapshotFingerprint: "a", preparationContractVersion: "first-working-session-preparation-v3" }, "b")).toBe(false);
    expect(isFirstWorkingSessionBriefCurrent({ sourceSnapshotFingerprint: "a", preparationContractVersion: "old" }, "a")).toBe(false);
  });
});

describe("P2.2 exhausted-job recovery", () => {
  it("is service-only, exact-scope, auditable, idempotent, and preserves governed artifacts", async () => {
    const sql = await readFile(recoveryMigration, "utf8");
    expect(sql).toContain("auth.role() <> 'service_role'");
    expect(sql).toContain("working_session.id = p_working_session_id");
    expect(sql).toContain("v_session.preparation_status <> 'failed'");
    expect(sql).toContain("v_session.preparation_attempt_count <> 3");
    expect(sql).toContain("v_session.preparation_contract_version IS DISTINCT FROM p_exhausted_contract_version");
    expect(sql).toContain("p_exhausted_contract_version <> 'first-working-session-preparation-v2'");
    expect(sql).toContain("p_recovery_contract_version <> 'first-working-session-preparation-v3'");
    expect(sql).toContain("v_session.preparation_lease_id IS NOT NULL");
    expect(sql).toContain("representation.current_version_id IS NULL");
    expect(sql).toContain("corrected_application_defect");
    expect(sql).toContain("direct_hire_first_working_session_preparation_recoveries");
    expect(sql).toContain("recovered_by_role");
    expect(sql).toContain("BEFORE UPDATE OR DELETE");
    expect(sql).toContain("IF EXISTS");
    expect(sql).toContain("RETURN true");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.zeya_recover_first_working_session_preparation(uuid,text,text,text)\n  TO service_role");
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM) public\.(?:evidence|observations|constitutional_hypotheses|direct_hire_first_working_session_briefs)/i);
    expect(sql).toContain("preparation_website_persisted_at");
    const update = sql.slice(sql.indexOf("UPDATE public.direct_hire_working_sessions"));
    expect(update).not.toContain("preparation_website_persisted_at =");
  });
  it("ships read-only catalog-driven recovery preflight and postcheck diagnostics", async () => {
    const files = await Promise.all([
      readFile("supabase/manual/20260813_direct_hire_first_working_session_preparation_recovery_preflight.sql", "utf8"),
      readFile("supabase/manual/20260813_direct_hire_first_working_session_preparation_recovery_postcheck.sql", "utf8"),
    ]);
    for (const sql of files) {
      expect(sql).toContain("PASS");
      expect(sql).toContain("pg_catalog");
      expect(sql).toContain("aclexplode(coalesce(");
      expect(sql).not.toContain("has_function_privilege('PUBLIC'");
      expect(sql).not.toMatch(/^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|ALTER\s+(?:TABLE|FUNCTION)|CREATE\s+(?:TABLE|FUNCTION)|DROP\s+(?:TABLE|FUNCTION)|TRUNCATE)\b/im);
    }
    expect(files[0]).toContain("recovery_objects_absent");
    expect(files[0]).not.toContain("715f4971-4d3f-4f53-9b89-a9dd703349d8");
    expect(files[1]).toContain("immutable_trigger");
    expect(files[1]).toContain("current_version_id is null");
  });
  it("corrects SQL Editor audit identity without broadening the API boundary", async () => {
    const sql = await readFile(recoveryActorMigration, "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.zeya_recover_first_working_session_preparation(");
    expect(sql).toContain("v_jwt_role text := auth.role()");
    expect(sql).toContain("v_database_role text := session_user::text");
    expect(sql).toContain("v_jwt_role IS DISTINCT FROM 'service_role'");
    expect(sql).toContain("v_database_role NOT IN ('postgres', 'service_role')");
    expect(sql).toContain("WHEN v_jwt_role = 'service_role' THEN 'service_role'");
    expect(sql).toContain("ELSE v_database_role");
    expect(sql).toContain("recovered_by_role IN ('service_role', 'postgres')");
    expect(sql).toContain("v_session.preparation_failure_code, v_recovery_actor");
    expect(sql).not.toContain("v_session.preparation_failure_code, auth.role()");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.zeya_recover_first_working_session_preparation(uuid,text,text,text)\n  FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.zeya_recover_first_working_session_preparation(uuid,text,text,text)\n  TO service_role");

    const ledgerInsert = sql.indexOf("INSERT INTO public.direct_hire_first_working_session_preparation_recoveries");
    const attemptReset = sql.indexOf("UPDATE public.direct_hire_working_sessions");
    expect(ledgerInsert).toBeGreaterThan(0);
    expect(attemptReset).toBeGreaterThan(ledgerInsert);
    for (const unchanged of [
      "FOR UPDATE", "IF EXISTS", "preparation_attempt_count <> 3",
      "preparation_lease_id IS NOT NULL", "representation.current_version_id IS NULL",
      "p_exhausted_contract_version <> 'first-working-session-preparation-v2'",
      "p_recovery_contract_version <> 'first-working-session-preparation-v3'",
    ]) expect(sql).toContain(unchanged);
  });
  it("ships read-only corrective-migration preflight and postcheck diagnostics", async () => {
    const files = await Promise.all([
      readFile("supabase/manual/20260813_direct_hire_first_working_session_preparation_recovery_actor_preflight.sql", "utf8"),
      readFile("supabase/manual/20260813_direct_hire_first_working_session_preparation_recovery_actor_postcheck.sql", "utf8"),
    ]);
    for (const sql of files) {
      expect(sql).toContain("PASS");
      expect(sql).toContain("aclexplode(");
      expect(sql).not.toContain("has_function_privilege('PUBLIC'");
      expect(sql).not.toMatch(/^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|ALTER\s+(?:TABLE|FUNCTION)|CREATE\s+(?:TABLE|FUNCTION)|DROP\s+(?:TABLE|FUNCTION)|TRUNCATE)\b/im);
    }
    expect(files[0]).toContain("failed_transaction_left_ledger_empty");
    expect(files[0]).not.toContain("715f4971-4d3f-4f53-9b89-a9dd703349d8");
    expect(files[1]).toContain("session_user::text");
    expect(files[1]).toContain("recovery_object_scope_unchanged");
  });
});

describe("P2.2 manual verification bundle", () => {
  it("is read-only and checks the predecessor/final state", async () => {
    const files = await Promise.all([
      readFile("supabase/manual/20260813_direct_hire_first_working_session_preparation_preflight.sql", "utf8"),
      readFile("supabase/manual/20260813_direct_hire_first_working_session_preparation_postcheck.sql", "utf8"),
    ]);
    for (const sql of files) {
      expect(sql).toContain("PASS");
      expect(sql).toContain("pg_catalog");
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\s+(TABLE|INTO|public\.)/i);
    }
    expect(files[0]).toContain("zeya_finalize_direct_hire_preparation");
    expect(files[1]).toContain("zeya_claim_first_working_session_preparation");
  });
});
